import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DocumentResponse } from '@/api/types';
import { Button } from '@/components/ui/button';
import { useAnalysisState } from '@/features/analysis';

import { useDocumentDetail } from '../hooks/useDocuments';

interface AnalysisProgressProps {
  projectId: string;
  document: DocumentResponse;
  onOpenDocument: () => void;
}

/** Ход анализа сразу после загрузки; статус обновляется по SSE. */
export function AnalysisProgress({ projectId, document, onOpenDocument }: AnalysisProgressProps) {
  const progress = useDocumentDetail(projectId, document.id);
  const current = progress.data ?? document;
  const analysis = useAnalysisState(projectId, current);
  const link = `/projects/${projectId}/documents/${document.id}`;

  if (current.status === 'in_progress') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
        <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
        <p className="font-medium">Анализируем «{document.name}»</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Система сравнивает документ с источниками истины и ищет несоответствия.
        </p>
        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full w-1/3 animate-progress-indeterminate rounded-full bg-primary motion-reduce:animate-none" />
        </div>
      </div>
    );
  }

  if (current.status === 'draft') {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center" role="status">
        <CircleAlert className="size-8 text-amber-600" aria-hidden />
        <p className="font-medium">Анализ не завершился</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {analysis?.errorMessage ?? 'Документ вернулся в черновик. Запустите анализ повторно.'}
        </p>
      </div>
    );
  }

  const hasSuggestions = current.status === 'awaiting_approval';
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
      <CheckCircle2 className="size-8 text-emerald-600" aria-hidden />
      <p className="font-medium">
        {hasSuggestions ? 'Анализ завершён: есть предложения ИИ' : 'Документ актуален'}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {hasSuggestions
          ? 'Откройте документ, чтобы рассмотреть предложенные правки.'
          : 'Предложений нет, документ перешёл в статус «Готово».'}
      </p>
      <Button asChild size="sm">
        <Link to={link} onClick={onOpenDocument}>
          Открыть документ
        </Link>
      </Button>
    </div>
  );
}
