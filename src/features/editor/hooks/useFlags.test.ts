import { describe, expect, it } from 'vitest';

import type { AnalysisFlagResponse, EditorAggregateResponse } from '@/api/types';

import { applyFlagStatus } from './useFlags';

const flag = (id: string, status: AnalysisFlagResponse['status']) =>
  ({ id, status }) as AnalysisFlagResponse;

const editor = (pending: number | undefined, flags: AnalysisFlagResponse[]) =>
  ({
    flags,
    counters: { total: 0, pending: 0, accepted: 0, rejected: 0, flags_pending: pending },
  }) as unknown as EditorAggregateResponse;

describe('applyFlagStatus', () => {
  it('меняет статус и уменьшает счётчик при отметке', () => {
    const next = applyFlagStatus(editor(2, [flag('a', 'pending'), flag('b', 'pending')]), 'a', {
      status: 'reviewed',
    });
    expect(next.flags?.find((f) => f.id === 'a')?.status).toBe('reviewed');
    expect(next.counters.flags_pending).toBe(1);
  });

  it('снятие отметки возвращает флаг в счётчик', () => {
    const next = applyFlagStatus(editor(0, [flag('a', 'reviewed')]), 'a', { status: 'pending' });
    expect(next.counters.flags_pending).toBe(1);
  });

  it('повтор того же статуса счётчик не трогает', () => {
    const before = editor(0, [flag('a', 'reviewed')]);
    expect(applyFlagStatus(before, 'a', { status: 'reviewed' }).counters).toBe(before.counters);
  });

  it('неизвестный флаг оставляет кеш как есть', () => {
    const before = editor(1, [flag('a', 'pending')]);
    expect(applyFlagStatus(before, 'zzz', { status: 'reviewed' })).toBe(before);
  });
});
