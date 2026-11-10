import { describe, expect, it } from 'vitest';

import { groupIndex, groupSizes, nextInGroup } from './groups';

describe('groupIndex', () => {
  it('собирает id групп в переданном порядке и пропускает правки без группы', () => {
    const index = groupIndex([
      { id: 'a', group_key: 'g1' },
      { id: 'b', group_key: null },
      { id: 'c', group_key: 'g2' },
      { id: 'd', group_key: 'g1' },
      { id: 'e' },
    ]);
    expect(Object.fromEntries(index)).toEqual({ g1: ['a', 'd'], g2: ['c'] });
  });

  it('линеен по числу правок: 10 000 правок за один проход', () => {
    const list = Array.from({ length: 10_000 }, (_, i) => ({
      id: `s${i}`,
      group_key: `g${i % 50}`,
    }));
    const started = performance.now();
    const index = groupIndex(list);
    expect(performance.now() - started).toBeLessThan(100);
    expect(index.get('g0')).toHaveLength(200);
  });
});

describe('groupSizes', () => {
  it('размер сервера важнее локального: часть группы может быть на другой странице', () => {
    const sizes = groupSizes([{ group_key: 'g1', size: 7 }], new Map([['g1', ['a', 'b']]]));
    expect(sizes.get('g1')).toBe(7);
  });

  it('без suggestion_groups считает по загруженным', () => {
    expect(groupSizes(undefined, new Map([['g1', ['a', 'b']]])).get('g1')).toBe(2);
  });
});

describe('nextInGroup', () => {
  it('идёт по порядку и с последней возвращается к первой', () => {
    expect(nextInGroup(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextInGroup(['a', 'b', 'c'], 'c')).toBe('a');
  });

  it('в группе из одной правки переходить некуда', () => {
    expect(nextInGroup(['a'], 'a')).toBeNull();
  });
});
