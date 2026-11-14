import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { queryKeys } from '@/api/queryKeys';
import { getSourceContent } from '@/api/resources/sources';
import { getSnapshotContent } from '@/api/resources/sourceSnapshots';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/state';
import {
  docxParagraphs,
  EVIDENCE_MATCH_LABEL,
  evidenceRange,
  pdfRects,
  showsInDocx,
  showsInPdf,
  snapshotFormat,
  type Evidence,
} from '@/domain/source/evidence';
import { cn } from '@/lib/cn';
import { getErrorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import type { PdfEngine } from '@/lib/pdf/engine';
import type { PdfHighlight } from '@/lib/pdf/PdfView';

import { DocxEvidenceView } from './DocxEvidenceView';
import { PdfEvidenceView } from './PdfEvidenceView';
import { SnapshotText } from './SnapshotText';

export interface PreviewableSource {
  id: string;
  name: string;
  type: 'url' | 'file';
  url?: string | null;
}

interface SourceViewerProps {
  projectId: string;
  source: PreviewableSource;
  /** Основания правки из этого источника; без них показывается текущий текст источника. */
  evidence?: readonly Evidence[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Подмена рендерера DOCX в тестах. */
  renderDocx?: (blob: Blob, container: HTMLElement) => Promise<void>;
  /** Подмена pdf.js в тестах. */
  pdfEngine?: PdfEngine;
}

const NO_EVIDENCE: readonly Evidence[] = [];
const BODY_CLASS =
  'max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 font-sans text-sm leading-6';
// PdfView прокручивается сам: наблюдатель видимости страниц должен следить за его областью.
const PDF_BODY_CLASS = 'overflow-hidden rounded-md border';
const PDF_MARK_CLASS = 'bg-amber-200/50';
const PDF_OTHER_CLASS = 'bg-amber-100/40';

/**
 * Просмотр источника. С основаниями правки показывает источник на момент анализа и
 * подсвечивает цитату: оригинал DOCX или PDF, если файл тот же, иначе текст снимка. Без
 * оснований показывает текущий текст источника только для чтения.
 */
export function SourceViewer({
  projectId,
  source,
  evidence = NO_EVIDENCE,
  open,
  onOpenChange,
  renderDocx,
  pdfEngine,
}: SourceViewerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6" title={source.name}>
            {source.name}
          </DialogTitle>
          {evidence.length === 0 ? (
            <DialogDescription>Источник истины, только просмотр.</DialogDescription>
          ) : null}
        </DialogHeader>
        {evidence.length > 0 ? (
          <EvidenceBrowser
            projectId={projectId}
            source={source}
            evidence={evidence}
            renderDocx={renderDocx}
            pdfEngine={pdfEngine}
          />
        ) : (
          <CurrentContent projectId={projectId} source={source} enabled={open} />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface EvidenceBrowserProps {
  projectId: string;
  source: PreviewableSource;
  evidence: readonly Evidence[];
  renderDocx?: (blob: Blob, container: HTMLElement) => Promise<void>;
  pdfEngine?: PdfEngine;
}

function EvidenceBrowser({
  projectId,
  source,
  evidence,
  renderDocx,
  pdfEngine,
}: EvidenceBrowserProps) {
  const [index, setIndex] = useState(0);
  const [docxFailed, setDocxFailed] = useState(false);
  const [pdfFailed, setPdfFailed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const current = evidence[Math.min(index, evidence.length - 1)];
  const snapshotId = current?.snapshot_id ?? null;
  const snapshot = useQuery({
    queryKey: queryKeys.sources.snapshot(projectId, snapshotId ?? ''),
    queryFn: () => getSnapshotContent(projectId, snapshotId ?? ''),
    enabled: snapshotId !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const text = snapshot.data?.text ?? null;
  const range = useMemo(
    () => (text !== null && current ? evidenceRange(text, current, String(index)) : null),
    [text, current, index],
  );
  const docxCapable = current !== undefined && showsInDocx(source, current);
  const inDocx = docxCapable && !docxFailed;
  const paragraphs = current ? docxParagraphs(current) : null;
  const pdfCapable = current !== undefined && showsInPdf(source, current);
  const inPdf = pdfCapable && !pdfFailed;
  const inOriginal = inDocx || inPdf;
  const fellBack = (docxCapable && docxFailed) || (pdfCapable && pdfFailed);
  const focusId = String(index);

  // Все основания файла видны сразу, текущее выделено; разбор локаторов O(E) на набор оснований.
  const pdfHighlights = useMemo<PdfHighlight[]>(
    () =>
      evidence.flatMap((item, i) =>
        showsInPdf(source, item) ? [{ id: String(i), rects: pdfRects(item) }] : [],
      ),
    [evidence, source],
  );
  const markedPdf = useMemo(
    () =>
      pdfHighlights.map((item) => ({
        ...item,
        className: item.id === focusId ? PDF_MARK_CLASS : PDF_OTHER_CLASS,
      })),
    [pdfHighlights, focusId],
  );

  useEffect(() => {
    if (inOriginal) return;
    // Первый фрагмент подсветки в центр; в jsdom scrollIntoView нет.
    bodyRef.current
      ?.querySelector<HTMLElement>('[data-evidence="first"]')
      ?.scrollIntoView?.({ block: 'center' });
  }, [inOriginal, range, text]);

  if (!current) return null;
  const takenAt = snapshot.data?.taken_at ? formatDate(snapshot.data.taken_at) : null;
  const go = (step: number) => {
    setIndex((value) => (value + step + evidence.length) % evidence.length);
  };

  let body;
  if (inPdf) {
    body = (
      <PdfEvidenceView
        projectId={projectId}
        sourceId={source.id}
        sourceName={source.name}
        highlights={markedPdf}
        focus={focusId}
        onSelect={(id) => setIndex(Number(id))}
        onFallback={() => setPdfFailed(true)}
        engine={pdfEngine}
      />
    );
  } else if (inDocx && paragraphs && range && text !== null) {
    body = (
      <DocxEvidenceView
        projectId={projectId}
        sourceId={source.id}
        sourceName={source.name}
        paragraphs={paragraphs}
        match={current.match}
        fragment={text.slice(range.start, range.end)}
        onFallback={() => setDocxFailed(true)}
        render={renderDocx}
      />
    );
  } else if (snapshotId === null) {
    body = <p className="text-muted-foreground">Текст источника на момент анализа не сохранён.</p>;
  } else if (snapshot.isPending) {
    body = <Skeleton className="h-48" aria-label="Загрузка источника" />;
  } else if (snapshot.isError) {
    body = (
      <ErrorState
        message={getErrorMessage(snapshot.error)}
        onRetry={() => void snapshot.refetch()}
      />
    );
  } else {
    body = <SnapshotText text={snapshot.data.text} format={snapshotFormat(source)} range={range} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">
          {inOriginal ? 'Оригинал файла' : 'Текст на момент анализа'}
          {takenAt ? `, снимок от ${takenAt}` : ''}
        </p>
        {source.type === 'url' && source.url ? (
          <Button asChild variant="outline" size="sm">
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              Открыть оригинал
            </a>
          </Button>
        ) : null}
      </div>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        aria-label="Основание правки"
      >
        {evidence.length > 1 ? (
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Предыдущее основание"
              onClick={() => go(-1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="tabular-nums">
              Основание {index + 1} из {evidence.length}
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Следующее основание"
              onClick={() => go(1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </span>
        ) : null}
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-medium',
            current.match === 'not_found'
              ? 'bg-muted text-muted-foreground'
              : 'bg-amber-100 text-amber-900',
          )}
        >
          {EVIDENCE_MATCH_LABEL[current.match]}
        </span>
      </div>
      {current.match === 'not_found' || fellBack ? (
        <div className="space-y-1 text-sm">
          {fellBack ? (
            <p className="text-muted-foreground">
              {pdfCapable
                ? 'Файл не открылся, показан текст на момент анализа.'
                : 'Абзац в оригинале не найден, показан текст на момент анализа.'}
            </p>
          ) : null}
          {current.match === 'not_found' ? (
            <blockquote className="border-l-2 border-border pl-3 italic">
              {current.quote}
            </blockquote>
          ) : null}
        </div>
      ) : null}
      <div
        ref={bodyRef}
        className={inPdf ? PDF_BODY_CLASS : BODY_CLASS}
        data-testid="source-viewer-body"
      >
        {body}
      </div>
    </div>
  );
}

interface CurrentContentProps {
  projectId: string;
  source: PreviewableSource;
  enabled: boolean;
}

/** Текущий текст источника: файл текстом или, если текста нет, причина и ссылка. */
function CurrentContent({ projectId, source, enabled }: CurrentContentProps) {
  const content = useQuery({
    queryKey: queryKeys.sources.content(projectId, source.id),
    queryFn: () => getSourceContent(projectId, source.id),
    enabled,
    staleTime: 10 * 60_000,
  });
  if (content.isPending) return <Skeleton className="h-48" aria-label="Загрузка источника" />;
  if (content.isError) {
    return (
      <ErrorState message={getErrorMessage(content.error)} onRetry={() => void content.refetch()} />
    );
  }
  const addedAt = content.data.created_at
    ? `Добавлен ${formatDate(content.data.created_at)}.`
    : null;
  const plainText = content.data.plain_text;
  if (content.data.preview_available && typeof plainText === 'string') {
    return (
      <div className="space-y-2">
        {addedAt ? <p className="text-sm text-muted-foreground">{addedAt}</p> : null}
        <div className={BODY_CLASS}>
          <SnapshotText
            text={plainText}
            format={snapshotFormat(source) === 'markdown' ? 'markdown' : 'plain'}
            range={null}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{content.data.reason ?? 'Просмотр недоступен.'}</p>
      {content.data.url ? (
        <Button asChild variant="outline" size="sm">
          <a href={content.data.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden />
            Открыть ссылку
          </a>
        </Button>
      ) : null}
    </div>
  );
}
