import { Play } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { bulkCandidates, summarizeBulkResult } from '@/domain/analysis/bulkAnalysis';
import type { DocumentStatus } from '@/domain/document/status';
import { getErrorMessage } from '@/lib/errors';
import { pluralize } from '@/lib/format';

import { useBulkAnalysis } from '../hooks/useAnalysis';

import { FullAnalysisSwitch } from './FullAnalysisSwitch';
import { REANALYSIS_TEXT } from './StartAnalysisButton';

interface BulkAnalysisButtonProps {
  projectId: string;
  documents: { id: string; name: string; status: DocumentStatus }[];
}

const documentsWord = ['документ', 'документа', 'документов'] as const;

/**
 * «Анализ всех документов»: draft запускается сразу, ready после подтверждения. Полный
 * повторный анализ выбирается в подтверждении и относится только к готовым документам.
 */
export function BulkAnalysisButton({ projectId, documents }: BulkAnalysisButtonProps) {
  const bulk = useBulkAnalysis(projectId);
  const [pendingConfirmation, setPendingConfirmation] = useState<string[]>([]);
  const [full, setFull] = useState(false);
  const candidates = bulkCandidates(documents);
  const nameOf = (id: string) => documents.find((d) => d.id === id)?.name ?? id;

  const run = (documentIds: string[], force: boolean) => {
    bulk.mutate(
      { documentIds, force, strategy: force && full ? 'full' : 'auto' },
      {
        onSuccess: (response) => {
          const summary = summarizeBulkResult(response.results);
          if (summary.started.length > 0) {
            const n = summary.started.length;
            toast.success(`Анализ запущен: ${n} ${pluralize(n, documentsWord)}`);
          }
          if (summary.problems.length > 0) {
            toast.warning('Часть документов не запущена', {
              description: summary.problems
                .map((p) => `«${nameOf(p.documentId)}»: ${p.message}`)
                .join('\n'),
            });
          }
          if (!force) setFull(false);
          setPendingConfirmation(force ? [] : summary.needsConfirmation);
        },
        onError: (error) => {
          setPendingConfirmation([]);
          toast.error(getErrorMessage(error));
        },
      },
    );
  };

  const confirmCount = pendingConfirmation.length;

  return (
    <>
      <Button
        variant="outline"
        disabled={candidates.length === 0}
        loading={bulk.isPending && confirmCount === 0}
        title={candidates.length === 0 ? 'Нет документов для анализа' : undefined}
        onClick={() =>
          run(
            candidates.map((d) => d.id),
            false,
          )
        }
      >
        <Play aria-hidden />
        Анализ всех документов
      </Button>
      <ConfirmDialog
        open={confirmCount > 0}
        onOpenChange={(open) => !open && setPendingConfirmation([])}
        title="Выполнить повторную проверку готовых документов?"
        description={`Среди выбранных ${confirmCount} ${pluralize(confirmCount, documentsWord)} в статусе «Готово». ${REANALYSIS_TEXT}`}
        confirmLabel="Запустить анализ"
        cancelLabel="Пропустить"
        loading={bulk.isPending}
        onConfirm={() => run(pendingConfirmation, true)}
      >
        <FullAnalysisSwitch checked={full} onCheckedChange={setFull} disabled={bulk.isPending} />
      </ConfirmDialog>
    </>
  );
}
