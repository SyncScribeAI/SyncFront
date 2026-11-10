/**
 * Техническое состояние анализа документа.
 *
 * Контракт отдаёт его в поле `analysis` документа, но бэкенд пока всегда присылает null
 * (resolve_document_public_status_and_analysis вызывается без latest_job). Поэтому состояние
 * восстанавливается из задачи `current_analysis_job_id` по тем же правилам, что и на сервере.
 */
import type { DocumentStatus } from '../document/status';

export type AnalysisPhase = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface AnalysisStateView {
  jobId: string | null;
  phase: AnalysisPhase;
  errorCode: string | null;
  errorMessage: string | null;
  canRetry: boolean;
  /** Анализ завершён, но часть документа не проверена (partial_success). */
  warning: AnalysisWarning | null;
}

export interface AnalysisWarning {
  message: string | null;
  /** Проверено и не проверено блоков; null, если сервер их не посчитал (прежний конвейер). */
  checked: number | null;
  failed: number | null;
}

export type AnalysisJobStatus =
  'pending' | 'dispatched' | 'processing' | 'success' | 'partial_success' | 'failed' | 'cancelled';

const TERMINAL_JOB_STATUSES: ReadonlySet<AnalysisJobStatus> = new Set([
  'success',
  'partial_success',
  'failed',
  'cancelled',
]);

export function isTerminalJobStatus(status: AnalysisJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

interface JobLike {
  id: string;
  status: AnalysisJobStatus;
  error_code: string | null;
  error_message: string | null;
  checked_blocks?: number | null;
  failed_blocks?: number | null;
}

interface AnalysisLike {
  job_id?: string | null;
  state: AnalysisPhase;
  error_code?: string | null;
  error_message?: string | null;
  can_retry?: boolean;
}

/** Зеркало resolve_document_public_status_and_analysis (app/api/schemas/document.py). */
export function analysisStateFromJob(job: JobLike): AnalysisStateView {
  switch (job.status) {
    case 'failed':
      return {
        jobId: job.id,
        phase: 'failed',
        errorCode: job.error_code ?? 'ANALYSIS_FAILED',
        errorMessage: job.error_message ?? 'Ошибка выполнения анализа',
        canRetry: true,
        warning: null,
      };
    case 'cancelled':
      return {
        jobId: job.id,
        phase: 'cancelled',
        errorCode: 'ANALYSIS_CANCELLED',
        errorMessage: job.error_message ?? 'Анализ отменён пользователем',
        canRetry: true,
        warning: null,
      };
    case 'pending':
      return {
        jobId: job.id,
        phase: 'pending',
        errorCode: null,
        errorMessage: null,
        canRetry: false,
        warning: null,
      };
    case 'dispatched':
    case 'processing':
      return {
        jobId: job.id,
        phase: 'processing',
        errorCode: null,
        errorMessage: null,
        canRetry: false,
        warning: null,
      };
    case 'success':
      return {
        jobId: job.id,
        phase: 'completed',
        errorCode: null,
        errorMessage: null,
        canRetry: true,
        warning: null,
      };
    case 'partial_success':
      // Правки сохранены и документ в ревью, поэтому это не ошибка: только предупреждение.
      return {
        jobId: job.id,
        phase: 'completed',
        errorCode: null,
        errorMessage: null,
        canRetry: true,
        warning: {
          message: job.error_message,
          checked: job.checked_blocks ?? null,
          failed: job.failed_blocks ?? null,
        },
      };
  }
}

export function analysisStateFromContract(analysis: AnalysisLike): AnalysisStateView {
  return {
    jobId: analysis.job_id ?? null,
    phase: analysis.state,
    errorCode: analysis.error_code ?? null,
    errorMessage: analysis.error_message ?? null,
    canRetry: analysis.can_retry ?? false,
    // В analysis документа нет счётчиков блоков; предупреждение берётся из задачи.
    warning: null,
  };
}

/**
 * Текст предупреждения о частичной проверке. Всего блоков — проверенные плюс непроверенные.
 * Без счётчиков остаётся только сообщение сервера.
 */
export function partialWarningText(warning: AnalysisWarning): string | null {
  const { checked, failed } = warning;
  if (checked === null || failed === null) return warning.message;
  const summary = `Проверено ${checked} из ${checked + failed} блоков, часть документа не проверена.`;
  return warning.message ? `${summary} ${warning.message}` : summary;
}

/**
 * Нужно ли запрашивать задачу, чтобы показать причину: документ в draft,
 * у него есть текущая задача, а сервер не прислал analysis.
 */
export function needsJobLookup(document: {
  status: DocumentStatus;
  current_analysis_job_id?: string | null;
  analysis?: AnalysisLike | null;
}): boolean {
  return (
    document.status === 'draft' && !document.analysis && Boolean(document.current_analysis_job_id)
  );
}

export function isAnalysisProblem(state: AnalysisStateView | null): boolean {
  return state?.phase === 'failed' || state?.phase === 'cancelled';
}
