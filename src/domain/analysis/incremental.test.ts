import { describe, expect, it } from 'vitest';

import { baselineJobId, fallbackReasonText, incrementalSummaryText } from './incremental';

describe('incrementalSummaryText', () => {
  it('у выборочной задачи показывает проверенные блоки и дату прошлого анализа', () => {
    const job = {
      incremental: { mode: 'delta' as const, reason: 'input_changed', baseline_job_id: 'b1' },
      run_stats: { blocks_total: 240, blocks_checked: 12 },
    };
    expect(incrementalSummaryText(job, '10.11.2026')).toBe(
      'Проверено блоков: 12 из 240, остальные результаты перенесены из анализа от 10.11.2026.',
    );
    expect(baselineJobId(job)).toBe('b1');
  });

  it('без run_stats берёт blocks_selected, без даты ссылается на прошлый анализ', () => {
    const job = {
      incremental: { mode: 'delta' as const, reason: 'input_changed', blocks_selected: 3 },
    };
    expect(incrementalSummaryText(job, null)).toBe(
      'Проверено блоков: 3, остальные результаты перенесены из прошлого анализа.',
    );
  });

  it('называет число решений с изменившимся основанием', () => {
    const job = { incremental: { mode: 'delta' as const, reason: 'input_changed', stale: 2 } };
    expect(incrementalSummaryText(job, null)).toContain(
      'Перенесённых решений с изменившимся основанием: 2, они во вкладке «Решено».',
    );
  });

  it('дата с точкой на конце не даёт двух точек подряд', () => {
    const job = { incremental: { mode: 'delta' as const, reason: 'input_changed', stale: 1 } };
    expect(incrementalSummaryText(job, '10 нояб. 2026 г.')).toBe(
      'Проверены заново блоки, затронутые изменениями, остальные результаты перенесены из анализа от 10 нояб. 2026 г. Перенесённых решений с изменившимся основанием: 1, они во вкладке «Решено».',
    );
  });

  it('перенос без изменений входа', () => {
    const job = {
      incremental: { mode: 'reused' as const, reason: 'reused', baseline_job_id: 'b1' },
    };
    expect(incrementalSummaryText(job, '10.11.2026')).toBe(
      'Источники и документ не изменились, результаты перенесены из анализа от 10.11.2026.',
    );
  });

  it('у полного анализа показывает причину перехода, а ожидаемый полный анализ молчит', () => {
    const changed = {
      mode: 'full' as const,
      reason: 'input_changed',
      fallback_reason: 'changed_share',
      changed_share: 0.42,
    };
    expect(incrementalSummaryText({ incremental: changed }, null)).toBe(
      'Выполнен полный анализ: источники изменились слишком сильно: изменилось 42% текста.',
    );
    for (const reason of ['mode_off', 'strategy_full', 'no_baseline']) {
      const info = { mode: 'full' as const, reason, fallback_reason: reason };
      expect(incrementalSummaryText({ incremental: info }, null)).toBeNull();
    }
    expect(baselineJobId({ incremental: { ...changed, baseline_job_id: 'b1' } })).toBeNull();
  });

  it('неизвестную причину показывает кодом, старый сервер без incremental даёт null', () => {
    expect(
      fallbackReasonText({ mode: 'full', reason: 'input_changed', fallback_reason: 'new_rule' }),
    ).toBe('причина new_rule');
    expect(
      fallbackReasonText({ mode: 'full', reason: 'sources_failed', fallback_reason: null }),
    ).toBe('часть источников не загрузилась');
    expect(incrementalSummaryText({}, null)).toBeNull();
  });
});
