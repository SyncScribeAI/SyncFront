/**
 * Словарь правок ИИ. Статусы и типы совпадают с SuggestionResponse бэкенда;
 * совпадение проверяется типами в src/api/types.ts.
 */

export const CHANGE_TYPES = ['modify', 'add', 'delete'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const SUGGESTION_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** model — правку предложил конвейер; propagated — бэкенд нашёл тот же фрагмент в другом месте. */
export const SUGGESTION_ORIGINS = ['model', 'propagated'] as const;
export type SuggestionOrigin = (typeof SUGGESTION_ORIGINS)[number];

/**
 * Ниже этого порога правку стоит проверить внимательнее. API порог не отдаёт: значение
 * повторяет настройку SyncBack SUGGESTION_LOW_CONFIDENCE_THRESHOLD по умолчанию.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** null — модель уверенность не указала, тогда и предупреждать не о чем. */
export function isLowConfidence(score: number | null | undefined): boolean {
  return typeof score === 'number' && score < LOW_CONFIDENCE_THRESHOLD;
}

export type Decision = Exclude<SuggestionStatus, 'pending'>;

export interface ChangeTypeMeta {
  label: string;
  /** Цвета разметки по «Описанию UI»: изменение — жёлтый, добавление — зелёный, удаление — красный. */
  tone: 'amber' | 'emerald' | 'red';
}

export const changeTypeMeta: Record<ChangeType, ChangeTypeMeta> = {
  modify: { label: 'Изменение', tone: 'amber' },
  add: { label: 'Добавить', tone: 'emerald' },
  delete: { label: 'Удалить', tone: 'red' },
};

export const decisionLabel: Record<Decision, string> = {
  accepted: 'Принято',
  rejected: 'Отклонено',
};

/** Минимум полей правки, нужный доменной логикой редактора. */
export interface EditorSuggestion {
  id: string;
  change_type: ChangeType;
  original_text?: string | null;
  suggested_text?: string | null;
  /** Текст, которым пользователь заменил suggested_text при принятии (уже сохранён на сервере). */
  edited_text?: string | null;
  section_ref?: string | null;
  /** ref блока из EditorContent.blocks; заполняет только конвейер 2.0. */
  block_id?: string | null;
  /** Границы original_text в plain_text, в кодовых точках; null у правок прежнего конвейера. */
  start_offset?: number | null;
  end_offset?: number | null;
  /** Порядок внутри ответа модели; сервер уже сортирует по нему, см. orderSuggestions. */
  position?: number;
  status: SuggestionStatus;
  /** Только у PDF: прямоугольники правки на страницах оригинала, см. domain/pdf. */
  geometry?: { rects?: unknown } | null;
}

/**
 * Текст, который попадёт в документ при принятии: несохранённая правка пользователя важнее
 * сохранённой, сохранённая — важнее текста ИИ. Так же выбирает экспорт SyncBack.
 */
export function effectiveNewText(suggestion: EditorSuggestion, draft?: string | null): string {
  return draft ?? suggestion.edited_text ?? suggestion.suggested_text ?? '';
}
