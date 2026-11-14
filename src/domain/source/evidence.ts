/**
 * Основание правки: цитата источника и её место в снимке, на котором шёл анализ.
 *
 * Смещения считаются сервером в кодовых точках текста снимка. Просмотр выбирает способ
 * показа по формату источника и по тому, совпадает ли файл с разобранным при анализе.
 */
import { codePointToUtf16 } from '../editor/offsets';
import { parsePageRects, type PageRect } from '../pdf/pageRect';
import type { TextRange } from '../editor/textRange';

export type EvidenceMatch = 'exact' | 'approximate' | 'not_found';

export interface Evidence {
  source_id?: string | null;
  source_name: string;
  snapshot_id?: string | null;
  quote: string;
  match: EvidenceMatch;
  start_offset?: number | null;
  end_offset?: number | null;
  segment_index?: number | null;
  locator?: Record<string, unknown> | null;
  original_file_available: boolean;
}

export const EVIDENCE_MATCH_LABEL: Record<EvidenceMatch, string> = {
  exact: 'Точное совпадение',
  approximate: 'Подсвечен абзац целиком',
  not_found: 'Цитата в источнике не найдена',
};

/**
 * Основания одного источника в порядке текста: найденные по началу, ненайденные в конце
 * в порядке выдачи. Сортировка устойчивая, O(E log E).
 */
export function evidenceOfSource(evidence: readonly Evidence[], sourceId: string): Evidence[] {
  const start = (item: Evidence) =>
    item.match === 'not_found' ? Number.POSITIVE_INFINITY : (item.start_offset ?? 0);
  return evidence.filter((item) => item.source_id === sourceId).sort((a, b) => start(a) - start(b));
}

/**
 * Как рисуется текст источника:
 * - markdown: файл .md размечен автором, текст снимка совпадает с файлом;
 * - plain: .txt и заметка, текст абзацами без разметки;
 * - structured: единый формат снимка для HTML, ссылок, DOCX и PDF, где таблицы идут
 *   строками «| a | b |».
 */
export type SnapshotFormat = 'markdown' | 'plain' | 'structured';

export interface ViewableSource {
  name: string;
  type: 'url' | 'file';
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function snapshotFormat(source: ViewableSource): SnapshotFormat {
  if (source.type === 'url') return 'structured';
  const ext = extension(source.name);
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  // Заметка хранится файлом note.txt под именем, которое дал пользователь, обычно без расширения.
  if (ext === 'txt' || ext === '') return 'plain';
  return 'structured';
}

export interface DocxParagraphs {
  first: number;
  last: number;
}

/** Порядковые номера непустых абзацев файла DOCX, оба включены. */
export function docxParagraphs(evidence: Evidence): DocxParagraphs | null {
  const locator = evidence.locator;
  if (!locator || locator.kind !== 'docx_paragraphs') return null;
  const { first, last } = locator;
  if (!Number.isInteger(first) || !Number.isInteger(last)) return null;
  const from = first as number;
  const to = last as number;
  return from >= 0 && to >= from ? { first: from, last: to } : null;
}

/** Основание можно подсветить в оригинале DOCX: файл тот же и есть номера абзацев. */
export function showsInDocx(source: ViewableSource, evidence: Evidence): boolean {
  return (
    source.type === 'file' &&
    extension(source.name) === 'docx' &&
    evidence.original_file_available &&
    evidence.match !== 'not_found' &&
    docxParagraphs(evidence) !== null
  );
}

/**
 * Прямоугольники строк PDF под основанием. Сервер отдаёт строки блока или строки таблицы,
 * которые задевает цитата, поэтому подсветка идёт по строкам, а не по словам.
 */
export function pdfRects(evidence: Evidence): PageRect[] {
  const locator = evidence.locator;
  if (!locator || locator.kind !== 'pdf_rects') return [];
  return parsePageRects(locator.rects);
}

/** Основание можно подсветить в оригинале PDF: файл тот же и есть прямоугольники. */
export function showsInPdf(source: ViewableSource, evidence: Evidence): boolean {
  return (
    source.type === 'file' &&
    extension(source.name) === 'pdf' &&
    evidence.original_file_available &&
    evidence.match !== 'not_found' &&
    pdfRects(evidence).length > 0
  );
}

/** Диапазон основания в тексте снимка в UTF-16 или null, если места нет или оно вне текста. */
export function evidenceRange(text: string, evidence: Evidence, id: string): TextRange | null {
  const { start_offset: start, end_offset: end } = evidence;
  if (evidence.match === 'not_found' || start == null || end == null || end <= start) return null;
  const toUtf16 = codePointToUtf16(text);
  const from = toUtf16(start);
  const to = toUtf16(end);
  return to > from ? { id, kind: 'evidence', start: from, end: to } : null;
}
