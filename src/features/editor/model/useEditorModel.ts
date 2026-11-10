import { useCallback, useEffect, useMemo, useState } from 'react';

import type { EditorAggregateResponse, EditorBlockResponse, SuggestionResponse } from '@/api/types';
import { isDocumentStatus, type DocumentStatus } from '@/domain/document/status';
import { buildProjection, type Projection } from '@/domain/editor/projection';
import {
  type DecisionBuffer,
  type EditBuffer,
  effectiveStatus,
  planSave,
  reviewProgress,
} from '@/domain/editor/review';
import {
  effectiveNewText,
  type Decision,
  type EditorSuggestion,
  type SuggestionStatus,
} from '@/domain/editor/suggestion';
import { getErrorMessage } from '@/lib/errors';

import { isReviewConflict, useSaveReview } from '../hooks/useEditor';

import { reviewScope, useReviewBuffer } from './reviewBuffer';

export type ViewMode = 'original' | 'suggestions' | 'clean';

/** Начальный режим подсказывает сервер полем view_mode. */
export function initialViewMode(viewMode: string): ViewMode {
  if (viewMode === 'suggested') return 'suggestions';
  if (viewMode === 'clean') return 'clean';
  return 'original';
}

const NO_DECISIONS: DecisionBuffer = {};
const NO_EDITS: EditBuffer = {};

export type SaveOutcome = 'saved' | 'conflict' | 'failed';

/**
 * Состояние экрана редактора: данные сервера + буфер решений + проекция текста.
 * Компоненты получают готовые значения и команды, без знания о контракте API.
 */
export function useEditorModel(
  projectId: string,
  editor: EditorAggregateResponse,
  refetch: () => Promise<unknown>,
) {
  const { document: meta, suggestions, counters, permissions } = editor;
  const status: DocumentStatus = isDocumentStatus(meta.status) ? meta.status : 'draft';
  const content = editor.content ?? { plain_text: '', sections: [], blocks: [] };
  // Сервер прежней версии blocks не присылает, хотя по схеме поле обязательно.
  const rawBlocks = content.blocks as EditorBlockResponse[] | undefined;
  const blocks = useMemo(() => rawBlocks ?? [], [rawBlocks]);

  const scope = reviewScope(meta.id, meta.current_analysis_job_id);
  const bind = useReviewBuffer((s) => s.bind);
  const boundScope = useReviewBuffer((s) => s.scope);
  const storedDecisions = useReviewBuffer((s) => s.decisions);
  const storedEdits = useReviewBuffer((s) => s.edits);
  const decide = useReviewBuffer((s) => s.decide);
  const undo = useReviewBuffer((s) => s.undo);
  const forget = useReviewBuffer((s) => s.forget);
  const clear = useReviewBuffer((s) => s.clear);
  useEffect(() => bind(scope), [bind, scope]);
  // До bind() в буфере могут лежать решения другого документа: не показываем их ни на один кадр.
  const bound = boundScope === scope;
  const decisions = bound ? storedDecisions : NO_DECISIONS;
  const edits = bound ? storedEdits : NO_EDITS;

  const plan = useMemo(
    () => planSave(suggestions, decisions, counters.pending, edits),
    [suggestions, decisions, counters.pending, edits],
  );
  // Правка решена в другой сессии или исчезла с новым анализом: решение из буфера уже не применить.
  useEffect(() => {
    if (plan.stale.length > 0) forget(plan.stale);
  }, [plan.stale, forget]);

  const statusOf = useCallback(
    (s: Pick<SuggestionResponse, 'id' | 'status'>): SuggestionStatus =>
      effectiveStatus(s, decisions),
    [decisions],
  );

  // Новый текст правки с учётом несохранённой и сохранённой правки пользователя.
  const newTextOf = useCallback(
    (s: EditorSuggestion): string => effectiveNewText(s, edits[s.id]),
    [edits],
  );

  // Добавления размещаются по месту так же, как при экспорте, поэтому «Правки» и «Чистовик»
  // строятся на одной проекции; разница между режимами — только в отрисовке решённых правок.
  const projection = useMemo(
    () =>
      buildProjection({
        text: content.plain_text,
        sections: content.sections,
        format: meta.format,
        suggestions,
        statusOf,
        newTextOf,
      }),
    [content.plain_text, content.sections, meta.format, suggestions, statusOf, newTextOf],
  );
  const projections = useMemo<Record<'suggestions' | 'clean', Projection>>(
    () => ({ suggestions: projection, clean: projection }),
    [projection],
  );

  const progress = useMemo(
    () => reviewProgress(counters, suggestions, decisions),
    [counters, suggestions, decisions],
  );

  const unsavedCount = plan.decisions.length;
  // Все правки уже решены на сервере, но ревью не завершено (например, другой сессией): даём сохранить.
  const canSave =
    permissions.can_review && (unsavedCount > 0 || (counters.pending === 0 && counters.total > 0));

  const save = useSaveReview(projectId, meta.id);
  const [conflict, setConflict] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveDecisions = useCallback(async (): Promise<SaveOutcome> => {
    setSaveError(null);
    try {
      await save.mutateAsync({
        review_version: meta.review_version,
        decisions: plan.decisions,
        finalize: plan.finalize,
      });
      clear();
      setConflict(null);
      return 'saved';
    } catch (error) {
      if (isReviewConflict(error)) {
        setConflict(getErrorMessage(error));
        await refetch();
        return 'conflict';
      }
      setSaveError(getErrorMessage(error));
      return 'failed';
    }
  }, [save, meta.review_version, plan, clear, refetch]);

  const decideSuggestion = useCallback(
    (id: string, decision: Decision, editedText?: string) => {
      if (permissions.can_review) decide(id, decision, editedText);
    },
    [decide, permissions.can_review],
  );

  return {
    meta,
    status,
    content,
    blocks,
    suggestions,
    counters,
    permissions,
    projections,
    progress,
    statusOf,
    newTextOf,
    decisions,
    unsavedCount,
    canSave,
    saving: save.isPending,
    conflict,
    dismissConflict: () => setConflict(null),
    saveError,
    saveDecisions,
    decideSuggestion,
    undoBuffered: undo,
    clearBuffer: clear,
  };
}

export type EditorModel = ReturnType<typeof useEditorModel>;
