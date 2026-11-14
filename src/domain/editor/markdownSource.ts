/**
 * Текст Markdown, который рисуется в режимах документа, и диапазоны подсветки в нём.
 *
 * Разметка разбирается по показанному тексту, а не по исходнику с наложенными сверху
 * правками: так новый текст принятой правки тоже форматируется, а чистовик совпадает
 * с тем, что получится при экспорте.
 */
import type { FlagRange } from './flag';
import type { ChangeSegment, Segment } from './projection';
import { disjointRanges, type TextRange } from './textRange';

export interface MarkdownSource {
  text: string;
  /** Непересекающиеся, по возрастанию начала. */
  ranges: TextRange[];
}

export type MarkdownMode = 'suggestions' | 'clean';

/** Оригинал: исходный текст и флаги. */
export function originalSource(text: string, flags: readonly FlagRange[]): MarkdownSource {
  return {
    text,
    ranges: disjointRanges(flags.map((flag) => ({ ...flag, kind: 'flag' as const }))),
  };
}

/** Что из правки попадает в показанный текст; null, если правка не видна вовсе. */
function shownText(change: ChangeSegment, mode: MarkdownMode): string | null {
  const { changeType, status } = change;
  if (changeType === 'add') {
    if (status === 'rejected') return null;
    return mode === 'clean' && status === 'accepted'
      ? change.newText.replace(/^\n+|\n+$/g, '')
      : '';
  }
  if (mode === 'suggestions' || status !== 'accepted') return change.oldText;
  if (changeType === 'delete') return null;
  return change.newText;
}

/**
 * Показанный текст по сегментам проекции за один проход: O(S + F).
 *
 * В «Правках» текст всегда совпадает с исходником: старый фрагмент любой правки остаётся
 * в своей разметке, новый текст компонент рисует рядом, а добавление отмечается пустым
 * диапазоном в точке вставки. Поэтому решение по правке меняет только состояние
 * диапазона, и узлы документа вместе с фокусом сохраняются. В «Чистовике» принятая
 * правка входит в текст новым фрагментом, чтобы его разметка тоже отформатировалась;
 * принятое добавление встаёт отдельным абзацем с пустой строкой до и после, как его
 * вставляет экспорт. Флаги
 * накладываются только на текст без правок и только в «Правках»: так же, как в
 * текстовом режиме.
 */
export function markdownSource(
  segments: readonly Segment[],
  mode: MarkdownMode,
  flags: readonly FlagRange[],
): MarkdownSource {
  const parts: string[] = [];
  const ranges: TextRange[] = [];
  const flagged = mode === 'suggestions' ? disjointFlags(flags) : [];
  let length = 0;
  let next = 0;

  const push = (text: string) => {
    parts.push(text);
    length += text.length;
  };

  for (const segment of segments) {
    if (segment.kind === 'text') {
      const from = segment.origin;
      if (from !== undefined && segment.text) {
        const to = from + segment.text.length;
        while (next < flagged.length && (flagged[next]?.end ?? 0) <= from) next += 1;
        for (let k = next; k < flagged.length; k += 1) {
          const flag = flagged[k];
          if (!flag || flag.start >= to) break;
          ranges.push({
            id: flag.id,
            kind: 'flag',
            start: length + Math.max(flag.start, from) - from,
            end: length + Math.min(flag.end, to) - from,
          });
        }
      }
      push(segment.text);
      continue;
    }
    const shown = shownText(segment, mode);
    if (shown === null) continue;
    const accepted = segment.changeType === 'add' && segment.status === 'accepted';
    if (accepted && shown) push('\n\n');
    ranges.push({ id: segment.id, kind: 'suggestion', start: length, end: length + shown.length });
    push(shown);
    if (accepted && shown) push('\n\n');
  }
  return { text: parts.join(''), ranges: disjointRanges(ranges) };
}

/** Флаги одного места не вкладываются: подсвечивается первый, как в текстовом режиме. */
function disjointFlags(flags: readonly FlagRange[]): FlagRange[] {
  const result: FlagRange[] = [];
  for (const flag of [...flags].sort((a, b) => a.start - b.start)) {
    const last = result[result.length - 1];
    if (flag.end > flag.start && (!last || flag.start >= last.end)) result.push(flag);
  }
  return result;
}
