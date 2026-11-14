import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { DOCX_HOST_CLASS, renderDocx } from '@/lib/docx/renderDocx';

export const DOCX_RENDER_FAILED =
  'Не удалось отрисовать исходный файл — показан текст без форматирования.';

interface OriginalDocxViewProps {
  file: Blob | undefined;
  loading: boolean;
  error: unknown;
  /** Плоский текст — показывается, если файл не загрузился или не отрисовался. */
  fallback: ReactNode;
  /** Подмена рендерера в тестах: jsdom не умеет docx-preview. */
  render?: (blob: Blob, container: HTMLElement) => Promise<void>;
}

type RenderState = 'idle' | 'rendering' | 'done' | 'failed';

/**
 * Режим «Оригинал» для .docx: исходный файл рендерится в HTML с заголовками, таблицами
 * и выделениями Word. Пока файл грузится и рисуется — скелетон; при любой ошибке —
 * предупреждение и обычный плоский текст, чтобы документ не пропал.
 */
export function OriginalDocxView({
  file,
  loading,
  error,
  fallback,
  render = renderDocx,
}: OriginalDocxViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RenderState>('idle');

  useEffect(() => {
    const host = hostRef.current;
    if (!file || !host) return undefined;
    let cancelled = false;
    setState('rendering');
    host.replaceChildren();
    render(file, host).then(
      () => {
        if (!cancelled) setState('done');
      },
      () => {
        if (!cancelled) setState('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file, render]);

  const failed = state === 'failed' || (error !== null && error !== undefined);
  const busy = !failed && (loading || (file !== undefined && state !== 'done'));
  const empty = !failed && !busy && file === undefined;

  return (
    <div data-testid="original-docx">
      {busy ? (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка исходного файла">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-6 h-4 w-full" />
          <Skeleton className="h-4 w-10/12" />
        </div>
      ) : null}
      {failed ? (
        <Alert variant="warning" className="mb-4">
          <TriangleAlert aria-hidden />
          <AlertDescription>{DOCX_RENDER_FAILED}</AlertDescription>
        </Alert>
      ) : null}
      {failed || empty ? fallback : null}
      {/* Контейнер смонтирован всегда: рендер идёт в него, пока сверху показан скелетон. */}
      <div ref={hostRef} className={cn(DOCX_HOST_CLASS, (busy || failed) && 'hidden')} />
    </div>
  );
}
