import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/queryKeys';
import {
  cancelAnalysisJob,
  getAnalysisJob,
  startAnalysis,
  startBulkAnalysis,
} from '@/api/resources/analysis';
import type { AnalysisState } from '@/api/types';
import {
  analysisStateFromContract,
  analysisStateFromJob,
  type AnalysisStateView,
  type AnalysisWarning,
  isTerminalJobStatus,
  needsJobLookup,
} from '@/domain/analysis/analysisState';
import type { DocumentStatus } from '@/domain/document/status';
import { isApiError } from '@/lib/errors';
import { uuidV4 } from '@/lib/id';

export function useInvalidateAfterAnalysis() {
  const queryClient = useQueryClient();
  return (projectId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.documents.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all }),
    ]);
}

/** 409 с confirmation_required: документ в ready, нужен повтор с force=true. */
export function isConfirmationRequired(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && error.extra('confirmation_required') === true;
}

export function useStartAnalysis(projectId: string) {
  const invalidate = useInvalidateAfterAnalysis();
  return useMutation({
    // Новый ключ на каждый клик: повтор того же клика (ретрай сети) вернёт ту же задачу.
    mutationFn: ({ documentId, force }: { documentId: string; force: boolean }) =>
      startAnalysis({ projectId, documentId, force, idempotencyKey: uuidV4() }),
    onSettled: () => invalidate(projectId),
  });
}

export function useCancelAnalysis(projectId: string) {
  const invalidate = useInvalidateAfterAnalysis();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, jobId }: { documentId: string; jobId: string }) =>
      cancelAnalysisJob(projectId, documentId, jobId),
    // При 409 задача уже завершилась сама: в любом случае перечитываем документ.
    onSettled: (_job, _error, { documentId }) =>
      Promise.all([
        invalidate(projectId),
        queryClient.invalidateQueries({
          queryKey: queryKeys.analysisJobs.byDocument(projectId, documentId),
        }),
      ]),
  });
}

export function useBulkAnalysis(projectId: string) {
  const invalidate = useInvalidateAfterAnalysis();
  return useMutation({
    mutationFn: ({ documentIds, force }: { documentIds: string[]; force: boolean }) =>
      startBulkAnalysis(projectId, { document_ids: documentIds, force }),
    onSettled: () => invalidate(projectId),
  });
}

interface DocumentForAnalysis {
  id: string;
  status: DocumentStatus;
  current_analysis_job_id?: string | null;
  analysis?: AnalysisState | null;
}

/**
 * Состояние анализа документа: из поля analysis, а если сервер его не прислал —
 * из текущей задачи. Завершённые задачи не меняются, поэтому кешируются навсегда.
 */
export function useAnalysisState(
  projectId: string,
  document: DocumentForAnalysis,
): AnalysisStateView | null {
  const jobId = document.current_analysis_job_id ?? '';
  const lookup = needsJobLookup(document);
  const job = useQuery({
    queryKey: queryKeys.analysisJobs.detail(projectId, document.id, jobId),
    queryFn: () => getAnalysisJob(projectId, document.id, jobId),
    enabled: lookup,
    staleTime: (query) =>
      query.state.data && isTerminalJobStatus(query.state.data.status) ? Infinity : 0,
  });

  if (document.analysis) return analysisStateFromContract(document.analysis);
  if (lookup && job.data) return analysisStateFromJob(job.data);
  return null;
}

/**
 * Предупреждение о частичной проверке для документа в ревью. В редакторе поля analysis нет,
 * поэтому задача запрашивается один раз: завершённая задача не меняется, кеш — навсегда.
 */
export function usePartialAnalysisWarning(
  projectId: string,
  document: { id: string; status: DocumentStatus; current_analysis_job_id?: string | null },
): AnalysisWarning | null {
  const jobId = document.current_analysis_job_id ?? '';
  const reviewed = document.status === 'awaiting_approval' || document.status === 'ready';
  const job = useQuery({
    queryKey: queryKeys.analysisJobs.detail(projectId, document.id, jobId),
    queryFn: () => getAnalysisJob(projectId, document.id, jobId),
    enabled: reviewed && Boolean(jobId),
    staleTime: (query) =>
      query.state.data && isTerminalJobStatus(query.state.data.status) ? Infinity : 0,
  });
  if (!reviewed || !job.data) return null;
  return analysisStateFromJob(job.data).warning;
}
