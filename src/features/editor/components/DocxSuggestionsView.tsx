import { TriangleAlert } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import type { DocumentSection } from '@/domain/editor/projection';
import type { EditorSuggestion, SuggestionStatus } from '@/domain/editor/suggestion';
import { cn } from '@/lib/cn';

import { decorateAnchor, type InlineMode } from '../lib/decorateAnchor';
import { ANCHOR_ATTR, anchorSuggestions, type AnchorReport } from '../lib/docxAnchors';
import { renderDocx } from '../lib/renderDocx';

import { DOCX_RENDER_FAILED, HOST_CLASS } from './OriginalDocxView';

interface DocxSuggestionsViewProps {
  file: Blob | undefined;
  loading: boolean;
  error: unknown;
  mode: InlineMode;
  suggestions: readonly EditorSuggestion[];
  sections: readonly DocumentSection[];
  plainText: string;
  statusOf: (suggestion: EditorSuggestion) => SuggestionStatus;
  /** Новый текст правки с учётом правок пользователя. */
  newTextOf: (suggestion: EditorSuggestion) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Плоский текст с правками — если файл не загрузился или не отрисовался. */
  fallback: ReactNode;
  render?: (blob: Blob, container: HTMLElement) => Promise<void>;
}

type RenderState = 'idle' | 'rendering' | 'ready' | 'failed';

function anchorIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[${ANCHOR_ATTR}]`)?.dataset.suggestionId ?? null;
}

/**
 * «Правки» и «Чистовик» для .docx поверх рендера docx-preview: документ рисуется один раз,
 * правки привязываются к тексту и дальше меняется только содержимое якорей.
 * Спайк: доля привязанных правок выводится над документом — это критерий, взлетит ли подход.
 */
export function DocxSuggestionsView({
  file,
  loading,
  error,
  mode,
  suggestions,
  sections,
  plainText,
  statusOf,
  newTextOf,
  selectedId,
  onSelect,
  fallback,
  render = renderDocx,
}: DocxSuggestionsViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RenderState>('idle');
  const [report, setReport] = useState<AnchorReport | null>(null);

  // Рендер и привязка: один раз на файл и набор правок (новый анализ — новый набор).
  useEffect(() => {
    const host = hostRef.current;
    if (!file || !host) return undefined;
    let cancelled = false;
    setState('rendering');
    setReport(null);
    host.replaceChildren();
    render(file, host).then(
      () => {
        if (cancelled) return;
        setReport(anchorSuggestions(host, { suggestions, sections, plainText }));
        setState('ready');
      },
      () => {
        if (!cancelled) setState('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file, suggestions, sections, plainText, render]);

  // Решения, режим, выделение и правки текста — только перерисовка якорей, без повторного рендера.
  useEffect(() => {
    if (!report) return;
    for (const suggestion of suggestions) {
      const element = report.anchored.get(suggestion.id);
      const original = element ? report.originals.get(element) : undefined;
      if (!element || !original) continue;
      decorateAnchor(
        element,
        original,
        {
          changeType: suggestion.change_type,
          status: statusOf(suggestion),
          newText: newTextOf(suggestion),
          selected: suggestion.id === selectedId,
        },
        mode,
      );
    }
  }, [report, suggestions, statusOf, newTextOf, selectedId, mode]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const id = anchorIdOf(event.target);
    if (id) onSelect(id);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const id = anchorIdOf(event.target);
    if (!id) return;
    event.preventDefault();
    onSelect(id);
  };

  const failed = state === 'failed' || (error !== null && error !== undefined);
  const busy = !failed && (loading || (file !== undefined && state !== 'ready'));
  const empty = !failed && !busy && file === undefined;
  const total = suggestions.length;
  const anchoredCount = report?.anchored.size ?? 0;
  const missedAddCount = report
    ? suggestions.filter(
        (suggestion) => suggestion.change_type === 'add' && report.missed.has(suggestion.id),
      ).length
    : 0;
  // Причины непривязанных — в title строки отчёта: спайку нужна диагностика без консоли.
  const missedSummary = report
    ? Array.from(report.missed.entries())
        .map(([id, reason]) => `${id}: ${reason}`)
        .join('\n')
    : '';

  return (
    <div data-testid="docx-suggestions">
      {busy ? (
        <div className="space-y-3" aria-busy="true" aria-label="Загрузка исходного файла">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : null}
      {failed ? (
        <Alert variant="warning" className="mb-4">
          <TriangleAlert aria-hidden />
          <AlertDescription>{DOCX_RENDER_FAILED}</AlertDescription>
        </Alert>
      ) : null}
      {failed || empty ? fallback : null}
      {report && total > 0 ? (
        <p
          className="mb-3 font-sans text-xs text-muted-foreground"
          data-testid="docx-anchor-report"
          title={missedSummary || undefined}
        >
          Показано в тексте: {anchoredCount} из {total}
          {anchoredCount < total ? ' — остальные доступны в панели справа' : ''}
        </p>
      ) : null}
      {missedAddCount > 0 ? (
        <Alert variant="warning" className="mb-4">
          <TriangleAlert aria-hidden />
          <AlertDescription>
            Не удалось определить место вставки для {missedAddCount} добавлений. Они доступны в
            панели справа, но не показаны в документе: текст-якорь не найден или отсутствует текст
            добавления.
          </AlertDescription>
        </Alert>
      ) : null}
      {/* Делегирование: якоря создаются вне React, их события ловим на контейнере. */}
      <div
        ref={hostRef}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(HOST_CLASS, (busy || failed) && 'hidden')}
      />
    </div>
  );
}
