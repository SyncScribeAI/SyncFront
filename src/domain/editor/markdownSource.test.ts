import { describe, expect, it } from 'vitest';

import { markdownSource, originalSource } from './markdownSource';
import type { ChangeSegment, Segment } from './projection';
import type { SuggestionStatus } from './suggestion';

const text = (value: string, origin: number): Segment => {
  const segment: Segment = { kind: 'text', text: value };
  Object.defineProperty(segment, 'origin', { value: origin, enumerable: false });
  return segment;
};

function change(
  id: string,
  changeType: ChangeSegment['changeType'],
  status: SuggestionStatus,
  oldText: string,
  newText: string,
): ChangeSegment {
  return { kind: 'change', id, changeType, status, oldText, newText };
}

// Исходник: «Срок **10 дней**.\n\nОплата картой.»
function segments(statuses: [SuggestionStatus, SuggestionStatus, SuggestionStatus]): Segment[] {
  return [
    text('Срок **', 0),
    change('m', 'modify', statuses[0], '10 дней', '14 дней'),
    text('**.', 14),
    change('a', 'add', statuses[1], '', '\nНовый абзац.\n'),
    text('\n\n', 17),
    change('d', 'delete', statuses[2], 'Оплата картой.', ''),
  ];
}
const ORIGINAL = 'Срок **10 дней**.\n\nОплата картой.';

describe('markdownSource', () => {
  it('в «Правках» текст совпадает с исходником при любых решениях', () => {
    for (const statuses of [
      ['pending', 'pending', 'pending'],
      ['accepted', 'accepted', 'accepted'],
      ['rejected', 'rejected', 'rejected'],
    ] as const) {
      expect(markdownSource(segments([...statuses]), 'suggestions', []).text).toBe(ORIGINAL);
    }
  });

  it('в «Правках» добавление отмечено пустым диапазоном, правки покрывают старый текст', () => {
    const { ranges } = markdownSource(
      segments(['pending', 'pending', 'pending']),
      'suggestions',
      [],
    );
    expect(ranges).toEqual([
      { id: 'm', kind: 'suggestion', start: 7, end: 14 },
      { id: 'a', kind: 'suggestion', start: 17, end: 17 },
      { id: 'd', kind: 'suggestion', start: 19, end: 33 },
    ]);
  });

  it('отклонённое добавление не рисуется', () => {
    const { ranges } = markdownSource(
      segments(['pending', 'rejected', 'pending']),
      'suggestions',
      [],
    );
    expect(ranges.map((range) => range.id)).toEqual(['m', 'd']);
  });

  it('«Чистовик» применяет принятые правки и вставляет добавление абзацем', () => {
    const { text: clean, ranges } = markdownSource(
      segments(['accepted', 'accepted', 'accepted']),
      'clean',
      [],
    );
    expect(clean).toBe('Срок **14 дней**.\n\nНовый абзац.\n\n\n\n');
    expect(clean.slice(ranges[0]!.start, ranges[0]!.end)).toBe('14 дней');
    expect(clean.slice(ranges[1]!.start, ranges[1]!.end)).toBe('Новый абзац.');
    expect(ranges).toHaveLength(2);
  });

  it('«Чистовик» оставляет нерассмотренные и отклонённые правки старым текстом', () => {
    expect(markdownSource(segments(['pending', 'pending', 'rejected']), 'clean', []).text).toBe(
      ORIGINAL,
    );
  });

  it('флаги переносятся на текст без правок только в «Правках»', () => {
    const flags = [{ id: 'f', start: 0, end: 4 }];
    const shown = markdownSource(segments(['pending', 'pending', 'pending']), 'suggestions', flags);
    expect(shown.ranges[0]).toEqual({ id: 'f', kind: 'flag', start: 0, end: 4 });
    expect(
      markdownSource(segments(['pending', 'pending', 'pending']), 'clean', flags).ranges,
    ).not.toContainEqual(expect.objectContaining({ kind: 'flag' }));
  });

  it('оригинал отдаёт текст и флаги', () => {
    expect(originalSource(ORIGINAL, [{ id: 'f', start: 0, end: 4 }])).toEqual({
      text: ORIGINAL,
      ranges: [{ id: 'f', kind: 'flag', start: 0, end: 4 }],
    });
  });
});
