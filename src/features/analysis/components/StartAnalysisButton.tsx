import { Play } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button, type ButtonProps } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { analysisActionLabel, documentPolicy, type DocumentStatus } from '@/domain/document/status';
import { getErrorMessage } from '@/lib/errors';

import { isConfirmationRequired, useStartAnalysis } from '../hooks/useAnalysis';

import { FullAnalysisSwitch } from './FullAnalysisSwitch';

export const REANALYSIS_TITLE = 'Выполнить повторную проверку документа?';
export const REANALYSIS_TEXT =
  'Сервер проверит заново блоки, затронутые изменениями источников, а остальные правки и решения перенесёт из прошлого анализа. Если изменений много, документ проверяется полностью.';

interface StartAnalysisButtonProps {
  projectId: string;
  document: { id: string; name: string; status: DocumentStatus };
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  /** Подпись вместо стандартной, например «Запустить анализ» в диалоге загрузки. */
  label?: string;
  /** Только значок ▶ с подсказкой — вариант для строки документа в списках. */
  iconOnly?: boolean;
  onStarted?: () => void;
}

/**
 * Запуск анализа. Доступен из любого статуса, кроме «В работе». У документа с результатами
 * («Ожидает утверждения» и «Готово») запуск идёт через диалог: там выбирается полный повторный
 * анализ, и пользователь видит, что станет с решениями. Если сервер ответил 409
 * confirmation_required (статус успел смениться), показываем тот же диалог.
 */
export function StartAnalysisButton({
  projectId,
  document,
  size = 'sm',
  variant = 'outline',
  label,
  iconOnly = false,
  onStarted,
}: StartAnalysisButtonProps) {
  const start = useStartAnalysis(projectId);
  const [confirming, setConfirming] = useState(false);
  const [full, setFull] = useState(false);

  const openDialog = () => {
    setFull(false);
    setConfirming(true);
  };

  const run = (force: boolean) => {
    start.mutate(
      { documentId: document.id, force, strategy: full ? 'full' : 'auto' },
      {
        onSuccess: (job) => {
          setConfirming(false);
          if (job.status === 'failed') {
            toast.error(job.error_message ?? 'Не удалось поставить анализ в очередь');
            return;
          }
          toast.success(`Анализ «${document.name}» запущен`);
          onStarted?.();
        },
        onError: (error) => {
          if (isConfirmationRequired(error)) {
            if (!confirming) openDialog();
            return;
          }
          setConfirming(false);
          toast.error(getErrorMessage(error));
        },
      },
    );
  };

  if (!documentPolicy.canStartAnalysis(document.status)) return null;

  const title = label ?? analysisActionLabel(document.status);
  const loading = start.isPending && !confirming;
  const onClick = () =>
    documentPolicy.hasAnalysisResults(document.status) ? openDialog() : run(false);

  return (
    <>
      {iconOnly ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="iconSm"
              variant="ghost"
              className="text-primary hover:text-primary"
              aria-label={`${title}: ${document.name}`}
              loading={loading}
              onClick={onClick}
            >
              <Play aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{title}</TooltipContent>
        </Tooltip>
      ) : (
        <Button size={size} variant={variant} loading={loading} onClick={onClick}>
          <Play aria-hidden />
          {title}
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={REANALYSIS_TITLE}
        description={REANALYSIS_TEXT}
        confirmLabel="Запустить анализ"
        loading={start.isPending}
        onConfirm={() => run(true)}
      >
        <FullAnalysisSwitch checked={full} onCheckedChange={setFull} disabled={start.isPending} />
      </ConfirmDialog>
    </>
  );
}
