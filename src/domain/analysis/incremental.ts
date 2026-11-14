/**
 * Сводка инкрементального анализа: сколько блоков проверено заново, откуда перенесено
 * остальное и почему задача ушла в полный анализ. Поля повторяют AnalysisIncrementalInfo
 * и AnalysisRunStats SyncBack; все они необязательные, старый сервер их не присылает.
 */

export type IncrementalMode = 'reused' | 'full' | 'delta';

export interface IncrementalInfoLike {
  mode: IncrementalMode;
  reason: string;
  baseline_job_id?: string | null;
  fallback_reason?: string | null;
  changed_share?: number | null;
  blocks_selected?: number | null;
  stale?: number | null;
}

export interface RunStatsLike {
  blocks_total: number;
  blocks_checked: number;
}

export interface IncrementalJobLike {
  incremental?: IncrementalInfoLike | null;
  run_stats?: RunStatsLike | null;
}

/**
 * Полный анализ по этим причинам ожидаем: режим выключен на сервере, пользователь сам
 * попросил полный анализ или прошлого результата нет. Объяснять тут нечего.
 */
const EXPECTED_FULL = new Set(['mode_off', 'strategy_full', 'no_baseline']);

const FALLBACK_TEXTS: Record<string, string> = {
  sources_failed: 'часть источников не загрузилась',
  mode_reuse: 'на сервере включён только перенос результата без выборочной проверки',
  baseline_unknown: 'прошлый анализ выполнен до появления инкрементального режима',
  document_changed: 'изменился сам документ',
  contract_changed: 'изменилась версия контракта анализа',
  provider_changed: 'изменился поставщик анализа',
  chain_limit: 'достигнут предел выборочных проверок подряд',
  fingerprints_unavailable: 'не удалось сравнить источники с прошлым анализом',
  changed_share: 'источники изменились слишком сильно',
  blocks_share: 'изменения затрагивают большую часть документа',
  no_blocks_matched: 'новый текст источников не совпал ни с одним блоком документа',
  sources_replaced: 'источник прошлого анализа удалён или создан заново',
};

/** Задача, из которой перенесены результаты; у полного анализа её нет. */
export function baselineJobId(job: IncrementalJobLike): string | null {
  const info = job.incremental;
  if (!info || info.mode === 'full') return null;
  return info.baseline_job_id ?? null;
}

export function fallbackReasonText(info: IncrementalInfoLike): string | null {
  const code = info.fallback_reason ?? info.reason;
  if (EXPECTED_FULL.has(code)) return null;
  const text = FALLBACK_TEXTS[code] ?? `причина ${code}`;
  if (code === 'changed_share' && typeof info.changed_share === 'number') {
    return `${text}: изменилось ${Math.round(info.changed_share * 100)}% текста`;
  }
  return text;
}

// Русская дата из Intl заканчивается на «г.», вторая точка в конце предложения лишняя.
const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);

/**
 * Текст сводки или null, если показывать нечего. baselineDate уже отформатирована
 * вызывающим кодом: домен не зависит от локали и lib.
 */
export function incrementalSummaryText(
  job: IncrementalJobLike,
  baselineDate: string | null,
): string | null {
  const info = job.incremental;
  if (!info) return null;
  const from = baselineDate ? `из анализа от ${baselineDate}` : 'из прошлого анализа';
  if (info.mode === 'reused') {
    return sentence(`Источники и документ не изменились, результаты перенесены ${from}`);
  }
  if (info.mode === 'full') {
    const reason = fallbackReasonText(info);
    return reason ? `Выполнен полный анализ: ${reason}.` : null;
  }
  const checked = job.run_stats?.blocks_checked ?? info.blocks_selected ?? null;
  const total = job.run_stats?.blocks_total ?? null;
  const scope =
    checked === null
      ? 'Проверены заново блоки, затронутые изменениями'
      : `Проверено блоков: ${checked}${total === null ? '' : ` из ${total}`}`;
  const stale = info.stale
    ? ` Перенесённых решений с изменившимся основанием: ${info.stale}, они во вкладке «Решено».`
    : '';
  return `${sentence(`${scope}, остальные результаты перенесены ${from}`)}${stale}`;
}
