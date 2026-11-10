/**
 * Смещения сервера (блоки, разделы, границы правок) считаются в кодовых точках Python,
 * а строки JS индексируются в UTF-16. Без суррогатных пар они совпадают, поэтому таблица
 * соответствий строится один раз за O(T) и только для текста с символами вне BMP.
 */

/** Перевод смещения из кодовых точек в UTF-16; смещение за концом текста прижимается к концу. */
export type OffsetMapper = (offset: number) => number;

const identity: OffsetMapper = (offset) => offset;

export function codePointToUtf16(text: string): OffsetMapper {
  if (!/[\uD800-\uDFFF]/.test(text)) return identity;
  // Int32Array вместо number[]: на длинном документе таблица заметно легче.
  const table = new Int32Array(text.length + 1);
  let points = 0;
  let unit = 0;
  for (const char of text) {
    table[points] = unit;
    points += 1;
    unit += char.length;
  }
  table[points] = unit;
  return (offset) => table[Math.max(0, Math.min(offset, points))] ?? unit;
}

export function spansInUtf16<T extends { start_offset: number; end_offset: number }>(
  items: readonly T[],
  toUtf16: OffsetMapper,
): T[] {
  if (toUtf16 === identity) return [...items];
  return items.map((item) => ({
    ...item,
    start_offset: toUtf16(item.start_offset),
    end_offset: toUtf16(item.end_offset),
  }));
}
