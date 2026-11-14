/**
 * Привязка правок к DOM, который построил docx-preview, в том же порядке, что DocxExporter:
 * - правка с границами (start_offset/end_offset) ставится в свой абзац: блок находится по
 *   смещению, абзац DOM — по номеру среди непустых абзацев (DocxParser пустые не делает
 *   блоками). Номер сверяется с текстом блока; при расхождении берётся абзац с тем же
 *   текстом того же порядкового номера, а если нет и его — правка ищется как без границ;
 * - правка без границ ищется по `original_text`: первое вхождение внутри одного абзаца
 *   (`DocxExporter` тоже не меняет текст через границу абзаца).
 * Найденный фрагмент оборачивается в `<span data-suggestion-id>`, даже если он пересекает
 * несколько ранов с разным форматированием: обход DOM и оборачивание общие с просмотром
 * источника и живут в lib/docx/domText.
 */
import type { DocumentBlock } from '@/domain/editor/block';
import { codePointToUtf16, spansInUtf16 } from '@/domain/editor/offsets';
import { verifiedSpan, type DocumentSection } from '@/domain/editor/projection';
import type { EditorSuggestion } from '@/domain/editor/suggestion';
import {
  collectParagraphs,
  flatten,
  nonEmptyParagraphs,
  normalizeDomText as normalize,
  rangeFor,
  wrapRange,
  type FlatBlock,
} from '@/lib/docx/domText';

export const ANCHOR_ATTR = 'data-suggestion-id';
const ANCHOR_SELECTOR = `[${ANCHOR_ATTR}]`;

export type AnchorMiss = 'not_found' | 'overlap' | 'not_applicable';

export interface AnchorReport {
  anchored: Map<string, HTMLElement>;
  missed: Map<string, AnchorMiss>;
  /** Исходное содержимое каждого якоря — чтобы отрисовка могла вернуть его при любом решении. */
  originals: WeakMap<HTMLElement, DocumentFragment>;
}

export interface AnchorInput {
  suggestions: readonly EditorSuggestion[];
  sections: readonly DocumentSection[];
  /** plain_text сервера: по нему проверяются границы правок. */
  plainText: string;
  /** EditorContent.blocks; без них все правки ищутся по тексту. */
  blocks?: readonly DocumentBlock[];
}

function collectBlocks(root: HTMLElement): FlatBlock[] {
  return collectParagraphs(root, ANCHOR_SELECTOR);
}

function intersectsAnchor(block: FlatBlock, range: Range): boolean {
  return Array.from(block.element.querySelectorAll(ANCHOR_SELECTOR)).some((anchor) =>
    range.intersectsNode(anchor),
  );
}

function wrap(range: Range, id: string): HTMLElement {
  return wrapRange(range, ANCHOR_ATTR, id);
}

/** Та же нормализация, что у SyncBack normalize_text; DOM при поиске не меняем. */
function normalizeAddAnchor(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/[\u00a0\u202f\u2007\u2009]/g, ' ')
    .replace(/[\u200b\ufeff]/g, '');
}

/** Как DocxExporter: первый абзац с original_text, без fallback на раздел или конец. */
function paragraphForAdd(blocks: FlatBlock[], suggestion: EditorSuggestion): HTMLElement | null {
  const needle = normalizeAddAnchor(suggestion.original_text ?? '').trim();
  if (!needle) return null;
  return blocks.find((block) => normalizeAddAnchor(block.text).includes(needle))?.element ?? null;
}

/** Абзац DOM для блока и смещение начала текста блока внутри него. */
interface BlockTarget {
  element: HTMLElement;
  lead: number;
}

/**
 * Сопоставление блоков сервера с абзацами DOM. Строится один раз: обёртки правок текст
 * абзаца не меняют, поэтому номера и тексты остаются верными до конца привязки.
 */
function blockLocator(root: HTMLElement, plainText: string, blocks: readonly DocumentBlock[]) {
  const spans = spansInUtf16(blocks, codePointToUtf16(plainText));
  const paragraphs = nonEmptyParagraphs(root, ANCHOR_SELECTOR);
  const blockTexts = spans.map((block) => plainText.slice(block.start_offset, block.end_offset));
  let byText: Map<string, FlatBlock[]> | null = null;

  const target = (paragraph: FlatBlock): BlockTarget => ({
    element: paragraph.element,
    lead: paragraph.text.length - paragraph.text.trimStart().length,
  });

  const paragraphOf = (index: number): BlockTarget | null => {
    const text = blockTexts[index] ?? '';
    const direct = paragraphs[index];
    if (direct && direct.text.trim() === text) return target(direct);
    // Нумерация разошлась (например, docx-preview отрисовал абзац иначе): ищем абзац
    // с тем же текстом и тем же порядковым номером среди одинаковых.
    if (!byText) {
      byText = new Map();
      for (const paragraph of paragraphs) {
        const key = paragraph.text.trim();
        byText.set(key, [...(byText.get(key) ?? []), paragraph]);
      }
    }
    let rank = 0;
    for (let i = 0; i < index; i += 1) if (blockTexts[i] === text) rank += 1;
    const same = byText.get(text)?.[rank];
    return same ? target(same) : null;
  };

  /** Блок, целиком содержащий [start, end), — двоичным поиском по началам. */
  const blockAt = (start: number, end: number): { index: number; start: number } | null => {
    let low = 0;
    let high = spans.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if ((spans[mid]?.start_offset ?? 0) <= start) {
        found = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    const block = spans[found];
    return block && end <= block.end_offset ? { index: found, start: block.start_offset } : null;
  };

  return { paragraphOf, blockAt };
}

interface AnchoredItem {
  suggestion: EditorSuggestion;
  target: BlockTarget;
  /** Смещение фрагмента внутри текста блока. */
  start: number;
  length: number;
}

export function anchorSuggestions(root: HTMLElement, input: AnchorInput): AnchorReport {
  const anchored = new Map<string, HTMLElement>();
  const missed = new Map<string, AnchorMiss>();
  const originals = new WeakMap<HTMLElement, DocumentFragment>();
  const adds: EditorSuggestion[] = [];
  const spanned: AnchoredItem[] = [];
  const rest: EditorSuggestion[] = [];

  const serverBlocks = input.blocks ?? [];
  const locator =
    serverBlocks.length > 0 ? blockLocator(root, input.plainText, serverBlocks) : null;
  const toUtf16 = codePointToUtf16(input.plainText);
  for (const suggestion of input.suggestions) {
    const span = locator ? verifiedSpan(suggestion, input.plainText, true, toUtf16) : null;
    const block = span && locator ? locator.blockAt(span.start, span.end) : null;
    const target = block && locator ? locator.paragraphOf(block.index) : null;
    if (span && block && target) {
      spanned.push({
        suggestion,
        target,
        start: span.start - block.start,
        length: span.end - span.start,
      });
    } else {
      rest.push(suggestion);
    }
  }

  // Как text_edits.apply_edits: по началу, при равенстве — в порядке выдачи.
  spanned.sort((a, b) => a.start - b.start);
  const lastAdded = new Map<HTMLElement, HTMLElement>();
  const spannedAdds: AnchoredItem[] = [];
  for (const item of spanned) {
    if (item.suggestion.change_type === 'add') {
      spannedAdds.push(item);
      continue;
    }
    // Ран заново: предыдущая обёртка в этом абзаце уже изменила его узлы.
    const block = flatten(item.target.element);
    const range = rangeFor(block, item.target.lead + item.start, item.length);
    if (intersectsAnchor(block, range)) {
      missed.set(item.suggestion.id, 'overlap');
      continue;
    }
    const span = wrap(range, item.suggestion.id);
    originals.set(span, cloneChildren(span));
    anchored.set(item.suggestion.id, span);
  }

  for (const suggestion of rest) {
    if (suggestion.change_type === 'add') {
      if (suggestion.suggested_text) adds.push(suggestion);
      else missed.set(suggestion.id, 'not_applicable');
      continue;
    }
    const needle = normalize(suggestion.original_text ?? '');
    if (!needle || needle.includes('\n')) {
      missed.set(suggestion.id, 'not_applicable');
      continue;
    }
    // Блоки собираем заново: предыдущая обёртка уже изменила DOM.
    const blocks = collectBlocks(root);
    let placed = false;
    for (const block of blocks) {
      const index = block.text.indexOf(needle);
      if (index === -1) continue;
      const range = rangeFor(block, index, needle.length);
      if (intersectsAnchor(block, range)) {
        missed.set(suggestion.id, 'overlap');
      } else {
        const span = wrap(range, suggestion.id);
        originals.set(span, cloneChildren(span));
        anchored.set(suggestion.id, span);
      }
      placed = true;
      break;
    }
    if (!placed) missed.set(suggestion.id, 'not_found');
  }

  // addnext в экспорте ставит каждый следующий абзац за предыдущим добавленным — порядок выдачи.
  for (const item of spannedAdds) {
    const after = lastAdded.get(item.target.element) ?? item.target.element;
    const paragraph = root.ownerDocument.createElement('p');
    paragraph.setAttribute(ANCHOR_ATTR, item.suggestion.id);
    after.insertAdjacentElement('afterend', paragraph);
    lastAdded.set(item.target.element, paragraph);
    originals.set(paragraph, root.ownerDocument.createDocumentFragment());
    anchored.set(item.suggestion.id, paragraph);
  }

  // Добавления без границ встают сразу за абзацем, перед добавленными по границам, — как
  // _place_addition, который вызывается в экспорте после них.
  const blocks = collectBlocks(root);
  for (const suggestion of adds) {
    const after = paragraphForAdd(blocks, suggestion);
    if (!after) {
      missed.set(suggestion.id, 'not_found');
      continue;
    }
    const paragraph = root.ownerDocument.createElement('p');
    paragraph.setAttribute(ANCHOR_ATTR, suggestion.id);
    after.insertAdjacentElement('afterend', paragraph);
    originals.set(paragraph, root.ownerDocument.createDocumentFragment());
    anchored.set(suggestion.id, paragraph);
  }

  return { anchored, missed, originals };
}

export function cloneChildren(element: HTMLElement): DocumentFragment {
  const fragment = element.ownerDocument.createDocumentFragment();
  for (const child of Array.from(element.childNodes)) fragment.appendChild(child.cloneNode(true));
  return fragment;
}

export const FLAG_ATTR = 'data-flag-id';

export interface FlagAnchorInput {
  flags: readonly { id: string; block_id: string; original_text: string }[];
  plainText: string;
  blocks: readonly DocumentBlock[];
}

/**
 * Помечает абзацы с флагами атрибутом `data-flag-id`. Абзац ищется так же, как для правок
 * с границами: блок по ref, абзац DOM по номеру с проверкой текста; если блок не найден —
 * первый абзац, содержащий original_text флага. На один абзац — один флаг: второй остаётся
 * только в панели, чтобы клик по абзацу был однозначным.
 * Вызывается до отрисовки правок: тогда тексты абзацев совпадают с исходными.
 */
export function anchorFlags(root: HTMLElement, input: FlagAnchorInput): Map<string, HTMLElement> {
  const marked = new Map<string, HTMLElement>();
  if (input.flags.length === 0) return marked;
  const indexByRef = new Map(input.blocks.map((block, index) => [block.ref, index]));
  const locator =
    input.blocks.length > 0 ? blockLocator(root, input.plainText, input.blocks) : null;
  let paragraphs: FlatBlock[] | null = null;
  const taken = new Set<HTMLElement>();
  for (const flag of input.flags) {
    const index = indexByRef.get(flag.block_id);
    let element =
      index !== undefined && locator ? (locator.paragraphOf(index)?.element ?? null) : null;
    if (!element) {
      const needle = normalizeAddAnchor(flag.original_text).trim();
      paragraphs ??= collectBlocks(root);
      element = needle
        ? (paragraphs.find((block) => normalizeAddAnchor(block.text).includes(needle))?.element ??
          null)
        : null;
    }
    if (!element || taken.has(element)) continue;
    taken.add(element);
    element.setAttribute(FLAG_ATTR, flag.id);
    marked.set(flag.id, element);
  }
  return marked;
}
