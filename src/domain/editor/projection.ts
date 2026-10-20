/**
 * Проекция текста документа с правками. Сервер не меняет текст при принятии правок,
 * поэтому «Правки» и «Чистовик» строятся здесь — по тем же правилам, что и
 * экспортёры SyncBack (TextExporter / DocxExporter), иначе чистовик и экспорт разойдутся:
 *
 * - принятые правки применяются по очереди в порядке ответа сервера (created_at, id),
 *   каждая — к уже изменённому тексту;
 * - modify/delete заменяют первое вхождение original_text во всём тексте;
 *   в docx вхождение ищется внутри одного абзаца, поэтому фрагмент с переводом строки не применится;
 * - add вставляется только по якорю — сразу после строки с original_text (SyncBack#78);
 *   без якоря или с ненайденным якорем сервер добавление не применит, место за модель не выбираем;
 * - новый текст правки берётся из newTextOf: отредактированный пользователем важнее текста ИИ.
 */
import type { ChangeType, EditorSuggestion, SuggestionStatus } from './suggestion';

export interface DocumentSection {
  ref: string;
  start_offset: number;
  end_offset: number;
}

/** Почему правку нельзя показать в тексте или её применение отличается от ожидаемого. */
export type LocateIssue =
  /** Фрагмента (для add — якоря) нет в тексте: сервер правку не применит. */
  | 'not_found'
  /** Фрагмент (или якорь) пересекается с другой правкой: результат экспорта может отличаться. */
  | 'overlap'
  /** Нет текста для замены или вставки, либо фрагмент занимает несколько абзацев docx. */
  | 'not_applicable'
  /** Первое вхождение — вне указанного раздела: заменится именно оно. */
  | 'outside_section';

export interface LocatedSuggestion {
  issue: LocateIssue | null;
  /** Будет ли правка применена при экспорте, если её принять. */
  exportable: boolean;
  /** Показана ли правка внутри текста. */
  inline: boolean;
  /**
   * Смещение правки в исходном тексте (UTF-16); null, если привязать не удалось.
   * Для add — точка вставки (конец строки с якорем), а не конец якоря.
   */
  originOffset: number | null;
  /**
   * Порядковый номер правки в итоговой проекции (сверху вниз по документу).
   * Разрешает совпадающие смещения, например несколько add в одном абзаце.
   */
  documentOrder?: number;
}

function locatedSuggestion(
  value: Omit<LocatedSuggestion, 'originOffset' | 'documentOrder'>,
  originOffset: number | null,
): LocatedSuggestion {
  return Object.defineProperty(value, 'originOffset', {
    value: originOffset,
    enumerable: false,
  }) as LocatedSuggestion;
}

export interface TextSegment {
  kind: 'text';
  text: string;
}

export interface ChangeSegment {
  kind: 'change';
  id: string;
  changeType: ChangeType;
  status: SuggestionStatus;
  oldText: string;
  newText: string;
}

export type Segment = TextSegment | ChangeSegment;

export interface ProjectionInput {
  text: string;
  sections: readonly DocumentSection[];
  format: string;
  /** В порядке ответа сервера: так же их применяет экспорт. */
  suggestions: readonly EditorSuggestion[];
  statusOf: (suggestion: EditorSuggestion) => SuggestionStatus;
  /** Новый текст правки с учётом правок пользователя; по умолчанию — suggested_text. */
  newTextOf?: (suggestion: EditorSuggestion) => string;
}

export interface Projection {
  segments: Segment[];
  located: Record<string, LocatedSuggestion>;
}

interface TextPiece {
  kind: 'text';
  text: string;
  /** Смещение начала куска в исходном тексте (UTF-16). */
  origin: number;
}

type Piece = TextPiece | ChangeSegment;

/** Вклад куска в текст, который в этот момент видит сервер. */
function serverText(piece: Piece): string {
  if (piece.kind === 'text') return piece.text;
  // У добавления oldText — якорь, он уже есть в тексте; непринятое добавление ничего не вносит.
  if (piece.changeType === 'add') return piece.status === 'accepted' ? piece.newText : '';
  if (piece.status !== 'accepted') return piece.oldText;
  return piece.changeType === 'delete' ? '' : piece.newText;
}

// DOC сервер экспортирует тем же DocxExporter, что и DOCX.
const isDocx = (format: string) => ['docx', 'doc'].includes(format.toLowerCase());

/**
 * Офсеты разделов сервер считает в кодовых точках Python, а строки JS — в UTF-16.
 * Без суррогатных пар они совпадают, иначе пересчитываем.
 */
export function sectionsInUtf16(
  text: string,
  sections: readonly DocumentSection[],
): DocumentSection[] {
  if (!/[\uD800-\uDFFF]/.test(text)) return [...sections];
  const toUtf16: number[] = [];
  let unit = 0;
  for (const char of text) {
    toUtf16.push(unit);
    unit += char.length;
  }
  toUtf16.push(unit);
  const map = (offset: number) => toUtf16[Math.min(offset, toUtf16.length - 1)] ?? unit;
  return sections.map((s) => ({
    ...s,
    start_offset: map(s.start_offset),
    end_offset: map(s.end_offset),
  }));
}

function changeOf(
  suggestion: EditorSuggestion,
  status: SuggestionStatus,
  newText: string,
): ChangeSegment {
  return {
    kind: 'change',
    id: suggestion.id,
    changeType: suggestion.change_type,
    status,
    oldText: suggestion.original_text ?? '',
    newText,
  };
}

export function buildProjection(input: ProjectionInput): Projection {
  const { text, format, suggestions, statusOf } = input;
  const newTextOf = input.newTextOf ?? ((s: EditorSuggestion) => s.suggested_text ?? '');
  const sections = sectionsInUtf16(text, input.sections);
  const located: Record<string, LocatedSuggestion> = {};
  let pieces: Piece[] = [{ kind: 'text', text, origin: 0 }];

  for (const suggestion of suggestions) {
    const status = statusOf(suggestion);

    if (suggestion.change_type === 'add') {
      if (!suggestion.suggested_text) {
        located[suggestion.id] = locatedSuggestion(
          { issue: 'not_applicable', exportable: false, inline: false },
          null,
        );
        continue;
      }
      const placed = placeAddition(
        pieces,
        changeOf(suggestion, status, newTextOf(suggestion)),
        suggestion,
      );
      if (placed === 'not_found') {
        located[suggestion.id] = locatedSuggestion(
          { issue: 'not_found', exportable: false, inline: false },
          null,
        );
        continue;
      }
      if (placed === 'overlap') {
        located[suggestion.id] = locatedSuggestion(
          { issue: 'overlap', exportable: true, inline: false },
          null,
        );
        continue;
      }
      located[suggestion.id] = locatedSuggestion(
        { issue: null, exportable: true, inline: true },
        placed.originOffset,
      );
      pieces = placed.pieces;
      continue;
    }

    const old = suggestion.original_text ?? '';
    if (!old || (isDocx(format) && old.includes('\n'))) {
      located[suggestion.id] = locatedSuggestion(
        { issue: 'not_applicable', exportable: false, inline: false },
        null,
      );
      continue;
    }

    const contributions = pieces.map(serverText);
    const index = contributions.join('').indexOf(old);
    if (index === -1) {
      located[suggestion.id] = locatedSuggestion(
        { issue: 'not_found', exportable: false, inline: false },
        null,
      );
      continue;
    }

    const hit = findTextPiece(pieces, contributions, index, old.length);
    if (!hit) {
      // Сервер применит правку к тексту, уже изменённому соседней правкой; показать это точно нельзя.
      located[suggestion.id] = locatedSuggestion(
        { issue: 'overlap', exportable: true, inline: false },
        null,
      );
      continue;
    }
    const { index: target, piece, start } = hit;

    const originStart = piece.origin + start;
    const section = suggestion.section_ref
      ? sections.find((s) => s.ref === suggestion.section_ref)
      : undefined;
    const outside =
      section !== undefined &&
      (originStart < section.start_offset || originStart + old.length > section.end_offset);
    located[suggestion.id] = locatedSuggestion(
      { issue: outside ? 'outside_section' : null, exportable: true, inline: true },
      originStart,
    );

    const replacement: Piece[] = [];
    if (start > 0)
      replacement.push({ kind: 'text', text: piece.text.slice(0, start), origin: piece.origin });
    replacement.push(changeOf(suggestion, status, newTextOf(suggestion)));
    const tail = piece.text.slice(start + old.length);
    if (tail) replacement.push({ kind: 'text', text: tail, origin: originStart + old.length });
    pieces = [...pieces.slice(0, target), ...replacement, ...pieces.slice(target + 1)];
  }

  let order = 0;
  for (const piece of pieces) {
    if (piece.kind !== 'change') continue;
    const item = located[piece.id];
    if (item?.inline) {
      Object.defineProperty(item, 'documentOrder', { value: order, enumerable: false });
      order += 1;
    }
  }

  return { segments: pieces.map(toSegment), located };
}

interface PieceHit {
  index: number;
  piece: TextPiece;
  /** Смещение внутри куска. */
  start: number;
}

/** Найти текстовый кусок, целиком содержащий диапазон серверного текста [index, index + length). */
function findTextPiece(
  pieces: Piece[],
  contributions: string[],
  index: number,
  length: number,
): PieceHit | null {
  let cursor = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const size = contributions[i]?.length ?? 0;
    const piece = pieces[i];
    if (piece?.kind === 'text' && index >= cursor && index + length <= cursor + size) {
      return { index: i, piece, start: index - cursor };
    }
    cursor += size;
  }
  return null;
}

/**
 * Разместить добавление как экспортёры SyncBack: сразу после строки с якорем.
 * Якорь ищется в тексте, каким его видит сервер на этом шаге (с уже принятыми правками).
 * 'not_found' — якоря нет или он не найден: сервер такое добавление не применит.
 * 'overlap' — якорь есть, но лежит внутри другой правки: сервер вставку применит, показать её точно нельзя.
 * originOffset — реальная точка вставки в исходном тексте, а не конец якоря.
 */
function placeAddition(
  pieces: Piece[],
  change: ChangeSegment,
  suggestion: EditorSuggestion,
): { pieces: Piece[]; originOffset: number } | 'not_found' | 'overlap' {
  const anchor = (suggestion.original_text ?? '').trim();
  if (!anchor) return 'not_found';
  const contributions = pieces.map(serverText);
  const index = contributions.join('').indexOf(anchor);
  if (index === -1) return 'not_found';
  const hit = findTextPiece(pieces, contributions, index, anchor.length);
  if (!hit) return 'overlap';
  const from = hit.start + anchor.length;
  const newline = hit.piece.text.indexOf('\n', from);
  const at = newline === -1 ? hit.piece.text.length : newline;
  return {
    pieces: splitPiece(pieces, hit.index, at, change),
    originOffset: hit.piece.origin + at,
  };
}

/** Вставить правку внутрь текстового куска по локальному смещению. */
function splitPiece(pieces: Piece[], index: number, at: number, change: ChangeSegment): Piece[] {
  const piece = pieces[index];
  if (!piece || piece.kind !== 'text') return [...pieces, change];
  const before: Piece[] = at > 0 ? [{ ...piece, text: piece.text.slice(0, at) }] : [];
  const after: Piece[] =
    at < piece.text.length
      ? [{ kind: 'text', text: piece.text.slice(at), origin: piece.origin + at }]
      : [];
  return [...pieces.slice(0, index), ...before, change, ...after, ...pieces.slice(index + 1)];
}

function toSegment(piece: Piece): Segment {
  return piece.kind === 'text' ? { kind: 'text', text: piece.text } : piece;
}

/**
 * Текст, который получится при экспорте: принятые правки применены, остальные — нет.
 * Повторяет нормализацию пустых строк TextExporter вокруг вставленного абзаца
 * (ровно одна пустая строка до и после) и вставку абзаца DocxExporter.
 */
export function exportedText(projection: Projection, format: string): string {
  const docx = isDocx(format);
  let body = '';
  // После вставки в тексте сервер срезает ведущие переводы строк у хвоста и ставит одну пустую строку.
  let afterAdd = false;

  const append = (text: string) => {
    if (!text) return;
    if (afterAdd && !docx) {
      const trimmed = text.replace(/^\n+/, '');
      if (!trimmed) return;
      body += `\n\n${trimmed}`;
      afterAdd = false;
      return;
    }
    body += text;
    afterAdd = false;
  };

  for (const segment of projection.segments) {
    if (segment.kind === 'text') {
      append(segment.text);
      continue;
    }
    if (segment.changeType === 'add') {
      if (segment.status !== 'accepted') continue;
      const block = segment.newText.replace(/^\n+|\n+$/g, '');
      if (docx) {
        body = body ? `${body}\n${block}` : block;
      } else {
        const head = body.replace(/\n+$/, '');
        body = head ? `${head}\n\n${block}` : block;
        afterAdd = true;
      }
      continue;
    }
    append(
      segment.status === 'accepted'
        ? segment.changeType === 'delete'
          ? ''
          : segment.newText
        : segment.oldText,
    );
  }

  if (afterAdd && !docx) body += '\n';
  return body;
}
