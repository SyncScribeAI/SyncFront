import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { queryKeys } from '@/api/queryKeys';
import { getSourceFile } from '@/api/resources/sourceFiles';
import { Skeleton } from '@/components/ui/skeleton';
import type { DocxParagraphs, EvidenceMatch } from '@/domain/source/evidence';
import { cn } from '@/lib/cn';
import { DOCX_HOST_CLASS, renderDocx } from '@/lib/docx/renderDocx';

import { clearDocxEvidence, markDocxEvidence } from '../lib/docxEvidence';

interface DocxEvidenceViewProps {
  projectId: string;
  sourceId: string;
  sourceName: string;
  paragraphs: DocxParagraphs;
  match: EvidenceMatch;
  /** Фрагмент снимка под основанием: по нему проверяются найденные абзацы. */
  fragment: string;
  /** Файл не загрузился, не отрисовался или абзацы не прошли проверку. */
  onFallback: () => void;
  /** Подмена рендерера в тестах: jsdom не умеет docx-preview. */
  render?: (blob: Blob, container: HTMLElement) => Promise<void>;
}

const MARK_CLASS = cn(
  '[&_[data-evidence]]:rounded-sm [&_[data-evidence]]:bg-amber-100 [&_[data-evidence]]:ring-1 [&_[data-evidence]]:ring-amber-300',
  '[&_[data-evidence-block]]:bg-amber-50 [&_[data-evidence-block]]:ring-1 [&_[data-evidence-block]]:ring-amber-300',
);

/**
 * Оригинал DOCX с подсветкой основания. Файл рисуется один раз, при переходе между
 * основаниями меняется только подсветка.
 */
export function DocxEvidenceView({
  projectId,
  sourceId,
  sourceName,
  paragraphs,
  match,
  fragment,
  onFallback,
  render = renderDocx,
}: DocxEvidenceViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<Blob | null>(null);
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  const file = useQuery({
    queryKey: queryKeys.sources.file(projectId, sourceId),
    queryFn: () => getSourceFile(projectId, sourceId, sourceName),
    staleTime: 10 * 60_000,
  });
  const blob = file.data?.blob;

  useEffect(() => {
    if (file.isError) fallbackRef.current();
  }, [file.isError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!blob || !host) return undefined;
    let cancelled = false;
    host.replaceChildren();
    render(blob, host).then(
      () => {
        if (!cancelled) setRendered(blob);
      },
      () => {
        if (!cancelled) fallbackRef.current();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [blob, render]);

  const { first, last } = paragraphs;
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !rendered || rendered !== blob) return;
    clearDocxEvidence(host);
    const target = markDocxEvidence(host, { paragraphs: { first, last }, match, fragment });
    if (!target) {
      fallbackRef.current();
      return;
    }
    // В jsdom scrollIntoView нет.
    target.scrollIntoView?.({ block: 'center' });
  }, [rendered, blob, first, last, match, fragment]);

  const busy = !rendered || rendered !== blob;
  return (
    <div data-testid="source-docx">
      {busy ? (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка исходного файла">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
        </div>
      ) : null}
      <div ref={hostRef} className={cn(DOCX_HOST_CLASS, MARK_CLASS, busy && 'hidden')} />
    </div>
  );
}
