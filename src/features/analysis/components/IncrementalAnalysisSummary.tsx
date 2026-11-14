import { History } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import type { DocumentStatus } from '@/domain/document/status';

import { useIncrementalSummary } from '../hooks/useAnalysis';

interface IncrementalAnalysisSummaryProps {
  projectId: string;
  document: { id: string; status: DocumentStatus; current_analysis_job_id?: string | null };
}

/** Как получен результат: выборочной проверкой, переносом или полным анализом с причиной. */
export function IncrementalAnalysisSummary({
  projectId,
  document,
}: IncrementalAnalysisSummaryProps) {
  const text = useIncrementalSummary(projectId, document);
  if (!text) return null;
  return (
    // Сводка справочная: role=status не перебивает чтение экрана, как это сделал бы alert.
    <Alert role="status">
      <History aria-hidden />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}
