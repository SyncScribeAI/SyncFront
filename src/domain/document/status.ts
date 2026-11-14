/**
 * Статусная модель документа — словарь предметной области.
 * Единственный источник лейблов и цветов статусов для всего интерфейса.
 * Соответствие enum бэкенда проверяется на уровне типов в src/api/types.ts.
 */

export const DOCUMENT_STATUSES = ['draft', 'in_progress', 'awaiting_approval', 'ready'] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type StatusTone = 'neutral' | 'info' | 'warning' | 'success';

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** Классы Tailwind для текста статуса: статус показывается словом в своём цвете, без бейджа. */
  badgeClassName: string;
  description: string;
}

export const statusMeta: Record<DocumentStatus, StatusMeta> = {
  draft: {
    label: 'Черновик',
    tone: 'neutral',
    badgeClassName: 'text-slate-600',
    description: 'Загружен, анализ ещё не запущен или не удался',
  },
  in_progress: {
    label: 'В работе',
    tone: 'info',
    badgeClassName: 'text-blue-700',
    description: 'Выполняется ИИ-анализ',
  },
  awaiting_approval: {
    label: 'Ожидает утверждения',
    tone: 'warning',
    badgeClassName: 'text-amber-700',
    description: 'Есть предложения ИИ, которые нужно рассмотреть',
  },
  ready: {
    label: 'Готово',
    tone: 'success',
    badgeClassName: 'text-emerald-700',
    description: 'Все решения сохранены, документ можно экспортировать',
  },
};

export function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === 'string' && (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Зеркало DocumentLifecycle бэкенда (app/domain/lifecycle.py) для списков,
 * где нет permissions редактора. В редакторе приоритет у permissions из ответа API.
 *
 * Источники заморожены только пока идёт анализ: на ревью их можно менять,
 * уже созданные правки остаются до следующего анализа.
 */
export const documentPolicy = {
  canStartAnalysis: (status: DocumentStatus): boolean => status !== 'in_progress',
  analysisNeedsConfirmation: (status: DocumentStatus): boolean => status === 'ready',
  /** У документа есть результат анализа: повторный запуск переносит или заменяет его. */
  hasAnalysisResults: (status: DocumentStatus): boolean =>
    status === 'awaiting_approval' || status === 'ready',
  canEditSources: (status: DocumentStatus): boolean => status !== 'in_progress',
  canReview: (status: DocumentStatus): boolean => status === 'awaiting_approval',
  canExport: (status: DocumentStatus): boolean => status === 'ready',
  canDelete: (status: DocumentStatus): boolean => status !== 'in_progress',
  canResetReview: (status: DocumentStatus): boolean =>
    status === 'awaiting_approval' || status === 'ready',
} as const;

/** Подпись кнопки запуска анализа по «Описанию UI». */
export function analysisActionLabel(status: DocumentStatus): string {
  return status === 'ready' ? 'Проверить актуальность' : 'Анализировать';
}
