import { TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import type { PageSize } from '@/domain/pdf/pageRect';
import type { PdfEngine } from '@/lib/pdf/engine';
import { PdfView, type PdfHighlight } from '@/lib/pdf/PdfView';

export const PDF_RENDER_FAILED = 'Не удалось открыть PDF, показан текст без разметки.';

interface PdfDocumentViewProps {
  file: Blob | undefined;
  loading: boolean;
  error: unknown;
  highlights: readonly PdfHighlight[];
  focus: string | null;
  onHighlightClick: (id: string) => void;
  pageSizes?: readonly PageSize[];
  /** Плоский текст: показывается, если файл не загрузился или pdf.js его не открыл. */
  fallback: ReactNode;
  /** Подмена pdf.js в тестах. */
  engine?: PdfEngine;
}

/**
 * PDF-документ в редакторе: исходные страницы с отметками правок и флагов. Область
 * прокручивается сама, потому что PdfView следит за видимостью страниц внутри неё.
 */
export function PdfDocumentView({
  file,
  loading,
  error,
  highlights,
  focus,
  onHighlightClick,
  pageSizes,
  fallback,
  engine,
}: PdfDocumentViewProps) {
  const [data, setData] = useState<{ file: Blob; buffer: ArrayBuffer } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    setFailed(false);
    file.arrayBuffer().then(
      (buffer) => {
        if (!cancelled) setData({ file, buffer });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file]);

  const broken = failed || (error !== null && error !== undefined);
  const buffer = data && data.file === file ? data.buffer : null;
  if (broken || (!loading && !file)) {
    return (
      <div data-testid="pdf-document">
        {broken ? (
          <Alert variant="warning" className="mb-4">
            <TriangleAlert aria-hidden />
            <AlertDescription>{PDF_RENDER_FAILED}</AlertDescription>
          </Alert>
        ) : null}
        {fallback}
      </div>
    );
  }
  if (!buffer) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Загрузка исходного файла">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
      </div>
    );
  }
  return (
    <div data-testid="pdf-document" className="overflow-hidden rounded-md border">
      <PdfView
        className="h-[calc(100vh-11rem)] min-h-[24rem]"
        data={buffer}
        highlights={highlights}
        focus={focus}
        pageSizes={pageSizes}
        onHighlightClick={onHighlightClick}
        onError={() => setFailed(true)}
        engine={engine}
      />
    </div>
  );
}
