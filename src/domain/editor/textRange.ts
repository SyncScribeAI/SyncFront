/**
 * Общая модель подсветки текста: правка, флаг или цитата источника занимают диапазон
 * в координатах показанного текста (UTF-16). Пустой диапазон отмечает точку, например
 * место добавления, у которого в тексте ещё нет символов.
 */
export type TextRangeKind = 'suggestion' | 'flag' | 'evidence';

export interface TextRange {
  id: string;
  kind: TextRangeKind;
  start: number;
  end: number;
}

/**
 * Непересекающиеся диапазоны по возрастанию начала. Вложенная подсветка в одном месте
 * не рисуется: остаётся более ранний диапазон, остальные доступны из списков.
 */
export function disjointRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const result: TextRange[] = [];
  let reached = -1;
  for (const range of sorted) {
    if (range.end < range.start || range.start < reached) continue;
    result.push(range);
    reached = range.end;
  }
  return result;
}
