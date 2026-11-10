import { describe, expect, it } from 'vitest';

import type { DocumentBlock } from './block';
import {
  FLAG_FALLBACK_REASON,
  countPendingFlags,
  flagRanges,
  flagReasonLabel,
  type FlagLike,
} from './flag';
import { codePointToUtf16 } from './offsets';

const block = (ref: string, start: number, end: number): DocumentBlock => ({
  ref,
  type: 'paragraph',
  start_offset: start,
  end_offset: end,
  editable: true,
});

const flag = (id: string, blockId: string, status: FlagLike['status'] = 'pending'): FlagLike => ({
  id,
  block_id: blockId,
  status,
});

describe('flagReasonLabel', () => {
  it('понимает оба написания причины расхождения источников', () => {
    expect(flagReasonLabel('sources_conflict')).toBe('Источники расходятся');
    expect(flagReasonLabel('source_conflict')).toBe('Источники расходятся');
  });

  it('неизвестную причину показывает как «проверьте вручную»', () => {
    expect(flagReasonLabel('new_reason_from_pipeline')).toBe(FLAG_FALLBACK_REASON);
  });
});

describe('flagRanges', () => {
  it('берёт границы блока по ref и сортирует по началу', () => {
    const blocks = [block('b1', 0, 5), block('b2', 6, 12)];
    const ranges = flagRanges(
      [flag('f2', 'b2'), flag('f1', 'b1')],
      blocks,
      codePointToUtf16('abcde\nfghijk'),
    );
    expect(ranges).toEqual([
      { id: 'f1', start: 0, end: 5 },
      { id: 'f2', start: 6, end: 12 },
    ]);
  });

  it('переводит кодовые точки в UTF-16 для текста с эмодзи', () => {
    // «😀» — одна кодовая точка, но две единицы UTF-16: второй блок сдвигается на 1.
    const text = '😀 a\nbb';
    const ranges = flagRanges(
      [flag('f', 'b2')],
      [block('b1', 0, 3), block('b2', 4, 6)],
      codePointToUtf16(text),
    );
    expect(ranges).toEqual([{ id: 'f', start: 5, end: 7 }]);
    expect(text.slice(5, 7)).toBe('bb');
  });

  it('флаг с неизвестным блоком в разметку не попадает', () => {
    expect(flagRanges([flag('f', 'missing')], [block('b1', 0, 1)], (n) => n)).toEqual([]);
  });
});

describe('countPendingFlags', () => {
  it('считает только непросмотренные', () => {
    expect(countPendingFlags([flag('a', 'b'), flag('b', 'b', 'reviewed'), flag('c', 'b')])).toBe(2);
  });
});
