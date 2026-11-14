import { describe, expect, it } from 'vitest';

import { geometryRects, parsePageRects } from './pageRect';

describe('parsePageRects', () => {
  it('читает записи [page, x0, y0, x1, y1]', () => {
    expect(parsePageRects([[2, 10, 20, 110, 32.5]])).toEqual([
      { page: 2, x0: 10, y0: 20, x1: 110, y1: 32.5 },
    ]);
  });

  it('пропускает записи неверной формы и оставляет остальные', () => {
    const rects = parsePageRects([
      [1, 0, 0, 10, 10],
      [0, 0, 0, 10, 10],
      [1.5, 0, 0, 10, 10],
      [1, 10, 0, 5, 10],
      [1, 0, 10, 10, 10],
      [1, 0, 0, 10],
      [1, '0', 0, 10, 10],
      [1, 0, 0, Number.NaN, 10],
      'rect',
      [3, 1, 2, 3, 4],
    ]);
    expect(rects.map((rect) => rect.page)).toEqual([1, 3]);
  });

  it('не список даёт пустой результат', () => {
    expect(parsePageRects(null)).toEqual([]);
    expect(parsePageRects({ rects: [] })).toEqual([]);
  });
});

describe('geometryRects', () => {
  it('берёт rects из geometry, без geometry пусто', () => {
    expect(geometryRects({ rects: [[1, 0, 0, 1, 1]] })).toHaveLength(1);
    expect(geometryRects(null)).toEqual([]);
    expect(geometryRects(undefined)).toEqual([]);
  });
});
