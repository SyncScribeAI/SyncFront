import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { queryKeys } from '@/api/queryKeys';
import { patchFlag } from '@/api/resources/flags';
import type { AnalysisFlagResponse, EditorAggregateResponse } from '@/api/types';
import type { FlagStatus } from '@/domain/editor/flag';
import { getErrorMessage, isApiError } from '@/lib/errors';

import { FLAG_TEXTS } from '../model/texts';

interface MarkFlagInput {
  flagId: string;
  status: FlagStatus;
}

/**
 * Статус флага и счётчик в кеше редактора. Счётчик меняется только при реальной смене статуса:
 * повторная отметка тем же статусом не должна уводить его в минус.
 */
export function applyFlagStatus(
  editor: EditorAggregateResponse,
  flagId: string,
  patch: Pick<AnalysisFlagResponse, 'status'> & Partial<AnalysisFlagResponse>,
): EditorAggregateResponse {
  const flags = editor.flags ?? [];
  const current = flags.find((flag) => flag.id === flagId);
  if (!current) return editor;
  const delta = current.status === patch.status ? 0 : patch.status === 'reviewed' ? -1 : 1;
  const pending = editor.counters.flags_pending as number | undefined;
  return {
    ...editor,
    flags: flags.map((flag) => (flag.id === flagId ? { ...flag, ...patch } : flag)),
    counters:
      pending === undefined || delta === 0
        ? editor.counters
        : { ...editor.counters, flags_pending: Math.max(0, pending + delta) },
  };
}

export function useMarkFlag(projectId: string, documentId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.documents.editor(projectId, documentId);
  return useMutation({
    mutationFn: ({ flagId, status }: MarkFlagInput) =>
      patchFlag(projectId, documentId, flagId, status),
    onMutate: async ({ flagId, status }) => {
      // Иначе перезапрос, начатый до клика, вернёт старый статус поверх оптимистичного.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<EditorAggregateResponse>(key);
      queryClient.setQueryData<EditorAggregateResponse>(key, (old) =>
        old ? applyFlagStatus(old, flagId, { status }) : old,
      );
      return { previous };
    },
    onSuccess: (flag) =>
      queryClient.setQueryData<EditorAggregateResponse>(key, (old) =>
        old ? applyFlagStatus(old, flag.id, flag) : old,
      ),
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      // 404 — флаг от прежнего анализа (у нового другие id), 409 — документ вышел из ревью:
      // в обоих случаях локальные данные устарели, поэтому перечитываем редактор.
      if (isApiError(error) && (error.status === 404 || error.status === 409)) {
        toast.error(error.status === 409 ? FLAG_TEXTS.notInReview : FLAG_TEXTS.stale);
        void queryClient.invalidateQueries({ queryKey: key });
        return;
      }
      toast.error(getErrorMessage(error));
    },
  });
}
