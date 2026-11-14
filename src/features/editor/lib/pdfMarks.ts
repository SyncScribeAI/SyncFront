/**
 * Отметки правок и флагов поверх страниц PDF. Перевёрстки PDF нет, поэтому все режимы
 * показывают исходные страницы, а режим определяет только набор и цвет прямоугольников.
 */
import type { AnalysisFlagResponse } from '@/api/types';
import { geometryRects } from '@/domain/pdf/pageRect';
import type { ChangeType, EditorSuggestion, SuggestionStatus } from '@/domain/editor/suggestion';
import type { PdfHighlight } from '@/lib/pdf/PdfView';

import type { InlineMode } from './decorateAnchor';

export type PdfMode = 'original' | InlineMode;

const SUGGESTION_PREFIX = 's:';
const FLAG_PREFIX = 'f:';

// Прямоугольник лежит поверх canvas с mix-blend-multiply: заливка полупрозрачная, текст виден.
// Обводка задаётся рамкой, потому что ring занят отметкой фокуса в PdfView и перекрыл бы её.
const PENDING_CLASS: Record<ChangeType, string> = {
  modify: 'border border-amber-500/70 bg-amber-300/40',
  delete: 'border border-red-500/70 bg-red-300/40',
  // У вставки сервер отдаёт символ перед точкой вставки: рамка нужна, чтобы узкую отметку было видно.
  add: 'border-2 border-emerald-500 bg-emerald-300/50',
};
const ACCEPTED_CLASS = 'bg-emerald-300/40';
const REJECTED_CLASS = 'bg-slate-300/30';
const FLAG_CLASS = 'border border-dashed border-sky-600 bg-sky-200/30';

export const suggestionMarkId = (id: string) => `${SUGGESTION_PREFIX}${id}`;
export const flagMarkId = (id: string) => `${FLAG_PREFIX}${id}`;

export type PdfMarkTarget = { kind: 'suggestion'; id: string } | { kind: 'flag'; id: string };

/** Что выбрано щелчком по прямоугольнику. */
export function markTarget(markId: string): PdfMarkTarget | null {
  if (markId.startsWith(SUGGESTION_PREFIX)) {
    return { kind: 'suggestion', id: markId.slice(SUGGESTION_PREFIX.length) };
  }
  if (markId.startsWith(FLAG_PREFIX)) return { kind: 'flag', id: markId.slice(FLAG_PREFIX.length) };
  return null;
}

function suggestionClass(
  mode: InlineMode,
  changeType: ChangeType,
  status: SuggestionStatus,
): string | null {
  // «Чистовик» показывает только то, что попадёт в документ.
  if (mode === 'clean') return status === 'accepted' ? ACCEPTED_CLASS : null;
  if (status === 'accepted') return ACCEPTED_CLASS;
  if (status === 'rejected') return REJECTED_CLASS;
  return PENDING_CLASS[changeType];
}

export interface PdfMarksInput {
  mode: PdfMode;
  suggestions: readonly EditorSuggestion[];
  statusOf: (suggestion: EditorSuggestion) => SuggestionStatus;
  flags: readonly Pick<AnalysisFlagResponse, 'id' | 'geometry'>[];
}

/**
 * Подсветки для PdfView. Флаги идут первыми, чтобы прямоугольник правки на том же месте
 * лежал сверху и забирал щелчок. Правки и флаги без прямоугольников пропускаются: они
 * остаются в панели. O(S + F + R).
 */
export function pdfMarks({ mode, suggestions, statusOf, flags }: PdfMarksInput): PdfHighlight[] {
  if (mode === 'original') return [];
  const marks: PdfHighlight[] = [];
  if (mode === 'suggestions') {
    for (const flag of flags) {
      const rects = geometryRects(flag.geometry);
      if (rects.length > 0) marks.push({ id: flagMarkId(flag.id), rects, className: FLAG_CLASS });
    }
  }
  for (const suggestion of suggestions) {
    const className = suggestionClass(mode, suggestion.change_type, statusOf(suggestion));
    if (className === null) continue;
    const rects = geometryRects(suggestion.geometry);
    if (rects.length > 0) marks.push({ id: suggestionMarkId(suggestion.id), rects, className });
  }
  return marks;
}
