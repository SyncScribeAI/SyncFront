import type { FlagRange } from '@/domain/editor/flag';
import type { Segment } from '@/domain/editor/projection';

export interface FlagChunk {
  text: string;
  flagId: string | null;
}

/**
 * Нарезка текстовых сегментов по диапазонам флагов одним проходом: и сегменты, и диапазоны
 * идут по возрастанию смещения, поэтому O(S + F). Для сегмента без флагов — null, чтобы он
 * рисовался как раньше. Флаги одного места не вкладываются: подсвечивается первый, остальные
 * доступны из списка.
 */
export function flagChunks(
  segments: readonly Segment[],
  ranges: readonly FlagRange[],
): (FlagChunk[] | null)[] {
  const result: (FlagChunk[] | null)[] = segments.map(() => null);
  const disjoint: FlagRange[] = [];
  for (const range of ranges) {
    const last = disjoint[disjoint.length - 1];
    if (range.end > range.start && (!last || range.start >= last.end)) disjoint.push(range);
  }
  if (disjoint.length === 0) return result;

  let next = 0;
  segments.forEach((segment, index) => {
    if (segment.kind !== 'text' || segment.origin === undefined || !segment.text) return;
    const from = segment.origin;
    const to = from + segment.text.length;
    while (next < disjoint.length && (disjoint[next]?.end ?? 0) <= from) next += 1;
    const chunks: FlagChunk[] = [];
    let cursor = from;
    for (let k = next; k < disjoint.length; k += 1) {
      const range = disjoint[k];
      if (!range || range.start >= to) break;
      const start = Math.max(range.start, from);
      const end = Math.min(range.end, to);
      if (start > cursor)
        chunks.push({ text: segment.text.slice(cursor - from, start - from), flagId: null });
      chunks.push({ text: segment.text.slice(start - from, end - from), flagId: range.id });
      cursor = end;
    }
    if (chunks.length === 0) return;
    if (cursor < to) chunks.push({ text: segment.text.slice(cursor - from), flagId: null });
    result[index] = chunks;
  });
  return result;
}
