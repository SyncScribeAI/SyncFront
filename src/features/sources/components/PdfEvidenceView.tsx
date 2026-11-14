import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { queryKeys } from '@/api/queryKeys';
import { getSourceFile } from '@/api/resources/sourceFiles';
import { Skeleton } from '@/components/ui/skeleton';
import type { PdfEngine } from '@/lib/pdf/engine';
import { PdfView, type PdfHighlight } from '@/lib/pdf/PdfView';

interface PdfEvidenceViewProps {
  projectId: string;
  sourceId: string;
  sourceName: string;
  /** Основания этого источника, которые есть в файле; текущее выделено через focus. */
  highlights: readonly PdfHighlight[];
  focus: string;
  onSelect: (id: string) => void;
  /** Файл не загрузился или pdf.js не смог его открыть. */
  onFallback: () => void;
  /** Подмена pdf.js в тестах. */
  engine?: PdfEngine;
}

/**
 * Оригинал PDF с прямоугольниками оснований. Файл открывается один раз, переход между
 * основаниями только переносит фокус.
 */
export function PdfEvidenceView({
  projectId,
  sourceId,
  sourceName,
  highlights,
  focus,
  onSelect,
  onFallback,
  engine,
}: PdfEvidenceViewProps) {
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  const file = useQuery({
    queryKey: queryKeys.sources.fileBytes(projectId, sourceId),
    queryFn: async () => {
      const { blob } = await getSourceFile(projectId, sourceId, sourceName);
      return blob.arrayBuffer();
    },
    staleTime: 10 * 60_000,
    // Буфер PDF бывает большим: после закрытия просмотра он не должен оставаться в памяти.
    gcTime: 0,
  });

  useEffect(() => {
    if (file.isError) fallbackRef.current();
  }, [file.isError]);

  if (!file.data) {
    return (
      <div className="space-y-3 p-3" aria-busy="true" aria-label="Загрузка исходного файла">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
      </div>
    );
  }
  return (
    <div data-testid="source-pdf">
      <PdfView
        className="h-[60vh]"
        data={file.data}
        highlights={highlights}
        focus={focus}
        onHighlightClick={onSelect}
        onError={() => fallbackRef.current()}
        engine={engine}
      />
    </div>
  );
}
