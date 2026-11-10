import { SearchCheck } from 'lucide-react';

import type { AnalysisFlagResponse } from '@/api/types';

import { useMarkFlag } from '../hooks/useFlags';
import { FLAG_TEXTS } from '../model/texts';

import { FlagCard } from './FlagCard';

interface FlagsSectionProps {
  projectId: string;
  documentId: string;
  flags: readonly AnalysisFlagResponse[];
  pending: number;
  canMark: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Флаги «проверьте вручную» над списком правок. Отметка идёт сразу на сервер, мимо буфера
 * ревью: флаг не участвует ни в сохранении решений, ни в finalize, ни в экспорте.
 */
export function FlagsSection({
  projectId,
  documentId,
  flags,
  pending,
  canMark,
  selectedId,
  onSelect,
}: FlagsSectionProps) {
  const mark = useMarkFlag(projectId, documentId);
  if (flags.length === 0) return null;
  const busyId = mark.isPending ? mark.variables.flagId : null;
  return (
    <section aria-labelledby="flags-title" className="space-y-2 border-b pb-5">
      <h3 id="flags-title" className="flex items-center gap-2 text-sm font-semibold">
        <SearchCheck className="size-4 text-sky-700" aria-hidden />
        {FLAG_TEXTS.sectionTitle} ({pending})
      </h3>
      <p className="text-xs text-muted-foreground">{FLAG_TEXTS.hint}</p>
      <ul className="space-y-2" aria-label="Список флагов">
        {flags.map((flag) => (
          <li key={flag.id}>
            <FlagCard
              flag={flag}
              selected={flag.id === selectedId}
              canMark={canMark}
              busy={busyId === flag.id}
              onSelect={onSelect}
              onMark={(flagId, status) => mark.mutate({ flagId, status })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
