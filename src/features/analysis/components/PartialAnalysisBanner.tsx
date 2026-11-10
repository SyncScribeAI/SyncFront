import { TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { partialWarningText } from '@/domain/analysis/analysisState';
import type { DocumentStatus } from '@/domain/document/status';

import { usePartialAnalysisWarning } from '../hooks/useAnalysis';

interface PartialAnalysisBannerProps {
  projectId: string;
  document: { id: string; status: DocumentStatus; current_analysis_job_id?: string | null };
}

/** Часть блоков не проверена: правки есть, но молчание модели о блоке ещё не значит «всё верно». */
export function PartialAnalysisBanner({ projectId, document }: PartialAnalysisBannerProps) {
  const warning = usePartialAnalysisWarning(projectId, document);
  const text = warning ? partialWarningText(warning) : null;
  if (!text) return null;
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}
