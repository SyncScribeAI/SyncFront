/**
 * Текст абзацев DOM, который построил docx-preview, и оборачивание фрагмента абзаца.
 *
 * Общая часть привязки правок в редакторе и подсветки оснований в просмотре источника.
 * Абзац сводится к плоскому тексту с картой текстовых узлов, фрагмент плоского текста
 * переводится в Range и оборачивается элементом. Range.extractContents клонирует
 * частичные обёртки, поэтому жирный и курсив внутри фрагмента сохраняются.
 */

/** Абзацы docx-preview: `p` в теле и в ячейках таблиц; заголовки Word тоже `p` со стилем. */
const PARAGRAPH_SELECTOR = 'p, h1, h2, h3, h4, h5, h6';

interface TextRun {
  node: Text;
  start: number;
}

export interface FlatBlock {
  element: HTMLElement;
  text: string;
  runs: TextRun[];
}

/** Нормализация 1:1 по длине, чтобы смещения в нормализованном тексте совпадали с DOM. */
export function normalizeDomText(text: string): string {
  return text.replace(/\u00a0/g, ' ');
}

export function flatten(element: HTMLElement): FlatBlock {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const runs: TextRun[] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    runs.push({ node: textNode, start: text.length });
    text += normalizeDomText(textNode.data);
  }
  return { element, text, runs };
}

/** Абзацы в порядке документа; абзацы внутри `skipInside` (например, вставленные правки) пропускаются. */
export function collectParagraphs(root: HTMLElement, skipInside?: string): FlatBlock[] {
  return Array.from(root.querySelectorAll<HTMLElement>(PARAGRAPH_SELECTOR))
    .filter((element) => !skipInside || element.closest(skipInside) === null)
    .map(flatten);
}

/**
 * Непустые абзацы: их порядковые номера совпадают с номерами DocxParser, который пустые
 * абзацы не считает ни блоками документа, ни фрагментами источника.
 */
export function nonEmptyParagraphs(root: HTMLElement, skipInside?: string): FlatBlock[] {
  return collectParagraphs(root, skipInside).filter((block) => block.text.trim() !== '');
}

/**
 * Точка (узел, смещение) для смещения в плоском тексте. Для начала берём последний ран,
 * начинающийся не позже смещения; для конца последний ран, начинающийся строго раньше,
 * чтобы граница легла в конец узла, а не в начало следующего.
 */
function pointAt(runs: TextRun[], offset: number, isEnd: boolean): { node: Text; offset: number } {
  let chosen = runs[0];
  if (!chosen) throw new Error('empty block');
  for (const run of runs) {
    if (run.start < offset || (!isEnd && run.start === offset)) chosen = run;
    else break;
  }
  return { node: chosen.node, offset: offset - chosen.start };
}

export function rangeFor(block: FlatBlock, start: number, length: number): Range {
  const range = block.element.ownerDocument.createRange();
  const from = pointAt(block.runs, start, false);
  const to = pointAt(block.runs, start + length, true);
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/** Оборачивает содержимое Range в span с атрибутом и возвращает обёртку. */
export function wrapRange(range: Range, attribute: string, value: string): HTMLElement {
  const doc = range.startContainer.ownerDocument ?? document;
  const span = doc.createElement('span');
  span.setAttribute(attribute, value);
  span.appendChild(range.extractContents());
  range.insertNode(span);
  return span;
}

/**
 * Буквы и цифры текста в нижнем регистре и для каждого символа результата его смещение
 * в исходной строке. По такой подписи текст снимка сверяется с абзацем DOM: разметка
 * снимка («#», «-», «|»), пробелы, кавычки и тире на сверку не влияют.
 */
export function letterSignature(text: string): { value: string; origins: number[] } {
  let value = '';
  const origins: number[] = [];
  let offset = 0;
  for (const char of text) {
    if (/[\p{L}\p{N}]/u.test(char)) {
      const lower = char.toLowerCase();
      value += lower;
      for (let k = 0; k < lower.length; k += 1) origins.push(offset);
    }
    offset += char.length;
  }
  return { value, origins };
}

/**
 * Первое вхождение текста в плоский текст абзаца по подписи букв и цифр: O(n + m).
 * Возвращает смещения в тексте абзаца от первого до последнего совпавшего символа.
 */
export function findBySignature(
  block: FlatBlock,
  needle: string,
): { start: number; end: number } | null {
  const target = letterSignature(needle).value;
  if (!target) return null;
  const own = letterSignature(block.text);
  const at = own.value.indexOf(target);
  if (at < 0) return null;
  const start = own.origins[at];
  const lastOrigin = own.origins[at + target.length - 1];
  if (start === undefined || lastOrigin === undefined) return null;
  const last = block.text.codePointAt(lastOrigin) ?? 0;
  return { start, end: lastOrigin + (last > 0xffff ? 2 : 1) };
}
