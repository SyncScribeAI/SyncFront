import { Loader2, Sparkles, TriangleAlert } from 'lucide-react';

import type { DocumentResponse } from '@/api/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CancelAnalysisButton, StartAnalysisButton, useAnalysisState } from '@/features/analysis';
import { isAnalysisProblem } from '@/domain/analysis/analysisState';

interface DocumentStatusPanelProps {
  projectId: string;
  document: DocumentResponse;
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-10 text-center shadow-sm">
      {children}
    </div>
  );
}

/** Главный блок страницы документа до результатов анализа: что происходит и что можно сделать. */
export function DocumentStatusPanel({ projectId, document }: DocumentStatusPanelProps) {
  const analysis = useAnalysisState(projectId, document);

  switch (document.status) {
    case 'in_progress':
      return (
        <Panel>
          <div role="status" className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
            <p className="font-medium">Идёт анализ</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Система сравнивает документ с источниками истины. Страницу можно закрыть: статус
              обновится сам.
            </p>
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full w-1/3 animate-progress-indeterminate rounded-full bg-primary motion-reduce:animate-none" />
            </div>
          </div>
          <CancelAnalysisButton projectId={projectId} document={document} />
        </Panel>
      );

    case 'draft': {
      const problem = analysis && isAnalysisProblem(analysis) ? analysis : null;
      const problemTitle = problem?.phase === 'cancelled' ? 'Анализ отменён' : 'Анализ не удался';
      // Для отмены сервер пишет в error_message то же «Анализ отменён», поэтому текст свой.
      const problemText =
        problem?.phase === 'cancelled'
          ? 'Документ вернулся в статус "Черновик".'
          : (problem?.errorMessage ?? 'Сервер не сообщил причину.');
      return (
        <div className="space-y-4">
          {problem ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertTitle>{problemTitle}</AlertTitle>
              <AlertDescription>{problemText}</AlertDescription>
            </Alert>
          ) : null}
          <Panel>
            <Sparkles className="size-8 text-primary" aria-hidden />
            <p className="font-medium">
              {problem ? 'Запустите анализ повторно' : 'Документ ещё не проверен'}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Проверьте источники ниже и запустите анализ: ИИ найдёт расхождения и предложит правки.
            </p>
            <StartAnalysisButton
              projectId={projectId}
              document={document}
              variant="default"
              label={problem ? 'Повторить анализ' : undefined}
            />
          </Panel>
        </div>
      );
    }

    // С результатами анализа страница показывает редактор, а не эту панель.
    case 'awaiting_approval':
    case 'ready':
      return null;
  }
}
