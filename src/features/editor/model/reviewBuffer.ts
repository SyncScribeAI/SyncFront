import { create } from 'zustand';

import type { DecisionBuffer, EditBuffer } from '@/domain/editor/review';
import type { Decision } from '@/domain/editor/suggestion';

interface ReviewBufferStore {
  /** Документ и анализ, к которым относятся решения: `${documentId}:${jobId}`. */
  scope: string | null;
  decisions: DecisionBuffer;
  /** Отредактированный новый текст принятых правок; живёт и сбрасывается вместе с решением. */
  edits: EditBuffer;
  /** Привязать буфер к анализу; решения другого документа или анализа отбрасываются. */
  bind: (scope: string) => void;
  /** editedText — текст правки, изменённый пользователем перед принятием; без него старая правка стирается. */
  decide: (id: string, decision: Decision, editedText?: string) => void;
  /**
   * То же решение для нескольких правок одним обновлением — для группы одинаковых фраз.
   * У каждой правки остаётся своё решение (его можно переключить отдельно), правки текста
   * пользователя у них стираются, как у decide без editedText.
   */
  decideMany: (ids: readonly string[], decision: Decision) => void;
  undo: (id: string) => void;
  forget: (ids: readonly string[]) => void;
  clear: () => void;
}

/**
 * Несохранённые решения ревью. Живут вне кеша запросов: перезапрос редактора
 * (SSE, конфликт версий) не должен терять то, что пользователь уже решил.
 */
export const useReviewBuffer = create<ReviewBufferStore>((set) => ({
  scope: null,
  decisions: {},
  edits: {},
  bind: (scope) =>
    set((state) => (state.scope === scope ? state : { scope, decisions: {}, edits: {} })),
  decide: (id, decision, editedText) =>
    set((state) => ({
      decisions: { ...state.decisions, [id]: decision },
      edits: editedText ? { ...state.edits, [id]: editedText } : without(state.edits, [id]),
    })),
  decideMany: (ids, decision) =>
    set((state) => ({
      decisions: { ...state.decisions, ...Object.fromEntries(ids.map((id) => [id, decision])) },
      edits: without(state.edits, ids),
    })),
  undo: (id) =>
    set((state) => ({
      decisions: without(state.decisions, [id]),
      edits: without(state.edits, [id]),
    })),
  forget: (ids) =>
    set((state) => ({
      decisions: without(state.decisions, ids),
      edits: without(state.edits, ids),
    })),
  clear: () => set({ decisions: {}, edits: {} }),
}));

export const reviewScope = (documentId: string, jobId: string | null | undefined) =>
  `${documentId}:${jobId ?? 'none'}`;

function without<T>(
  map: Readonly<Record<string, T>>,
  ids: readonly string[],
): Readonly<Record<string, T>> {
  const drop = new Set(ids);
  return Object.fromEntries(Object.entries(map).filter(([id]) => !drop.has(id)));
}
