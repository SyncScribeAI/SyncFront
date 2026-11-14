/**
 * Флаги «проверьте вручную»: место документа, где конвейер не предлагает правку,
 * а просит человека сверить текст с источниками. У флага нет принятия и отклонения —
 * только отметка «просмотрено», которая не влияет на ревью, статус документа и экспорт.
 */
import type { DocumentBlock } from './block';
import type { OffsetMapper } from './offsets';

export const FLAG_STATUSES = ['pending', 'reviewed'] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

/**
 * Подписи причин. В плане ML-конвейера причина называется sources_conflict, а в описании
 * поля OpenAPI — source_conflict, поэтому принимаются оба написания.
 */
const REASON_LABELS: Record<string, string> = {
  sources_conflict: 'Источники расходятся',
  source_conflict: 'Источники расходятся',
  // Флаг инкрементального анализа: основание прошлой правки исчезло, а новой правки по блоку нет.
  evidence_removed: 'Основание удалено из источника',
};

export const FLAG_FALLBACK_REASON = 'Проверьте вручную';

export function flagReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? FLAG_FALLBACK_REASON;
}

/** Минимум полей флага, нужный разметке текста. */
export interface FlagLike {
  id: string;
  block_id: string;
  status: FlagStatus;
}

/** Диапазон блока флага в plain_text, в UTF-16. */
export interface FlagRange {
  id: string;
  start: number;
  end: number;
}

/**
 * Диапазоны флагов: блок ищется по ref в словаре, построенном один раз, — O(F + B).
 * Флаг без найденного блока остаётся только в списке. Результат отсортирован по началу.
 */
export function flagRanges(
  flags: readonly FlagLike[],
  blocks: readonly DocumentBlock[],
  toUtf16: OffsetMapper,
): FlagRange[] {
  if (flags.length === 0) return [];
  const byRef = new Map(blocks.map((block) => [block.ref, block]));
  const ranges: FlagRange[] = [];
  for (const flag of flags) {
    const block = byRef.get(flag.block_id);
    if (!block) continue;
    ranges.push({
      id: flag.id,
      start: toUtf16(block.start_offset),
      end: toUtf16(block.end_offset),
    });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** Сколько флагов ждут просмотра, если сервер не прислал counters.flags_pending. */
export function countPendingFlags(flags: readonly FlagLike[]): number {
  return flags.reduce((count, flag) => count + (flag.status === 'pending' ? 1 : 0), 0);
}
