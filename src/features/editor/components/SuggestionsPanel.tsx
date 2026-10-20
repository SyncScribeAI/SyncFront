import { observeElementRect, useVirtualizer } from '@tanstack/react-virtual';
import {
  Check,
  CheckCircle2,
  FileText,
  Inbox,
  ListChecks,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import type { SuggestionResponse } from '@/api/types';
import { Progress } from '@/components/ui/progress';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyState } from '@/components/ui/state';
import type { LocatedSuggestion, LocateIssue } from '@/domain/editor/projection';
import type { ReviewProgress } from '@/domain/editor/review';
import { decisionLabel, type SuggestionStatus } from '@/domain/editor/suggestion';
import { cn } from '@/lib/cn';

import {
  ESTIMATED_CARD_HEIGHT,
  FALLBACK_VIEWPORT_HEIGHT,
  isVirtualized,
  LIST_OVERSCAN,
} from '../model/suggestionList';
import { orderSuggestions } from '../model/orderSuggestions';
import { EMPTY_FILTER_TEXTS, ISSUE_TEXTS } from '../model/texts';

import { ChangeTypeLabel } from './ChangeTypeLabel';

export type SuggestionFilter = 'pending' | 'decided' | 'all';
export type PanelDecision = Exclude<SuggestionStatus, 'pending'>;

interface SuggestionsPanelProps {
  suggestions: SuggestionResponse[];
  statusOf: (s: SuggestionResponse) => SuggestionStatus;
  unsavedIds: ReadonlySet<string>;
  located: Record<string, LocatedSuggestion>;
  progress: ReviewProgress;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Можно ли принимать/отклонять прямо из списка (права ревьюера). */
  canReview?: boolean;
  /** Быстрое решение по выбранной правке без открытия карточки. */
  onDecide?: (id: string, decision: PanelDecision) => void;
  /** Отмена решения по рассмотренной правке — как у блоков в тексте. */
  onUndo?: (id: string) => void;
  /** Карточка выбранной правки и блок завершения — над списком. */
  header?: React.ReactNode;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      [
        'input',
        'textarea',
        'select',
        'button',
        'a[href]',
        'summary',
        '[contenteditable]:not([contenteditable="false"])',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="radio"]',
        '[role="checkbox"]',
        '[role="switch"]',
        '[role="slider"]',
        '[role="spinbutton"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="textbox"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', '),
    ),
  );
}

function shortText(s: SuggestionResponse): string {
  return (s.change_type === 'delete' ? s.original_text : s.suggested_text) ?? '';
}

export function SuggestionsPanel({
  suggestions,
  statusOf,
  unsavedIds,
  located,
  progress,
  selectedId,
  onSelect,
  canReview = false,
  onDecide,
  onUndo,
  header,
}: SuggestionsPanelProps) {
  const [filter, setFilter] = useState<SuggestionFilter>('pending');
  const panelRef = useRef<HTMLElement>(null);

  const filtered = useMemo(
    () =>
      orderSuggestions(suggestions, located).filter((s) => {
        const status = statusOf(s);
        if (filter === 'pending') return status === 'pending';
        if (filter === 'decided') return status !== 'pending';
        return true;
      }),
    [filter, located, statusOf, suggestions],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (
        panelRef.current?.closest('[aria-hidden="true"]') ||
        event.isComposing ||
        isInteractiveTarget(event.target) ||
        filtered.length === 0
      )
        return;

      const selectedIndex = filtered.findIndex((suggestion) => suggestion.id === selectedId);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex =
          selectedIndex === -1
            ? delta > 0
              ? 0
              : filtered.length - 1
            : Math.min(filtered.length - 1, Math.max(0, selectedIndex + delta));
        const next = filtered[nextIndex];
        if (next) onSelect(next.id);
        return;
      }

      if (event.key === 'Enter' && selectedIndex >= 0) {
        const selected = filtered[selectedIndex];
        if (selected && canReview && statusOf(selected) === 'pending' && onDecide) {
          event.preventDefault();
          onDecide(selected.id, 'accepted');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canReview, filtered, onDecide, onSelect, selectedId, statusOf]);

  const selectSuggestion = (id: string) => {
    onSelect(id);
    panelRef.current?.focus({ preventScroll: true });
  };

  const renderCard = (s: SuggestionResponse) => (
    <SuggestionCard
      suggestion={s}
      status={statusOf(s)}
      issue={located[s.id]?.issue ?? null}
      selected={s.id === selectedId}
      unsaved={unsavedIds.has(s.id)}
      canReview={canReview}
      onSelect={selectSuggestion}
      onDecide={onDecide}
      onUndo={onUndo}
    />
  );

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby="suggestions-title"
      className="flex min-h-0 flex-col gap-5 outline-none"
    >
      {/* Шапка панели отделена линией от фильтра и списка — как на макете. */}
      <div className="space-y-2 border-b pb-5">
        <div className="flex items-center justify-between gap-2">
          <h2 id="suggestions-title" className="flex items-center gap-2 text-base font-semibold">
            <ListChecks className="size-4 text-primary" aria-hidden />
            Предложения ИИ
          </h2>
          <span className="text-sm tabular-nums text-muted-foreground">
            {progress.decided}/{progress.total}
          </span>
        </div>
        {/* Трек на фоне панели должен быть виден и при 0% — поэтому bg-border, а не bg-muted. */}
        <Progress value={progress.percent / 100} label="Прогресс проверки" className="bg-border" />
        <p className="text-xs text-muted-foreground">Ревью завершено на {progress.percent}%</p>
      </div>

      {header}

      {/* По макету табы без счётчиков: числа уже есть в шапке и в «решено/всего». */}
      <SegmentedControl<SuggestionFilter>
        ariaLabel="Фильтр предложений"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'pending', label: 'На рассмотрении' },
          { value: 'decided', label: 'Решено' },
          { value: 'all', label: 'Все' },
        ]}
      />

      {filtered.length === 0 ? (
        <EmptyState icon={Inbox} title={EMPTY_FILTER_TEXTS[filter]} className="py-8" />
      ) : isVirtualized(filtered.length) ? (
        <VirtualSuggestionList items={filtered} selectedId={selectedId} renderCard={renderCard} />
      ) : (
        <SuggestionList items={filtered} selectedId={selectedId} renderCard={renderCard} />
      )}
    </aside>
  );
}

interface SuggestionListProps {
  items: SuggestionResponse[];
  selectedId: string | null;
  renderCard: (s: SuggestionResponse) => React.ReactNode;
}

/** Короткий список: выбранная извне или с клавиатуры карточка остаётся в видимой области. */
function SuggestionList({ items, selectedId, renderCard }: SuggestionListProps) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    const selectedItem = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-suggestion-id]') ?? [],
    ).find((element) => element.dataset.suggestionId === selectedId);
    selectedItem?.scrollIntoView?.({ block: 'nearest' });
  }, [items, selectedId]);

  return (
    <ul ref={listRef} className="space-y-3" aria-label="Список предложений">
      {items.map((suggestion) => (
        <li key={suggestion.id} data-suggestion-id={suggestion.id}>
          {renderCard(suggestion)}
        </li>
      ))}
    </ul>
  );
}

type VirtualSuggestionListProps = SuggestionListProps;

/** Длинный список: в DOM только видимые карточки плюс небольшой запас сверху и снизу. */
function VirtualSuggestionList({ items, selectedId, renderCard }: VirtualSuggestionListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: LIST_OVERSCAN,
    getItemKey: (index) => items[index]?.id ?? index,
    // Неизмеренный контейнер (0 px) не должен оставлять панель пустой.
    observeElementRect: (instance, cb) =>
      observeElementRect(instance, (rect) =>
        cb(rect.height > 0 ? rect : { width: rect.width, height: FALLBACK_VIEWPORT_HEIGHT }),
      ),
  });

  // Правка, выбранная кликом по тексту, должна оказаться в видимой части списка.
  useEffect(() => {
    if (!selectedId) return;
    const index = items.findIndex((s) => s.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [selectedId, items, virtualizer]);

  return (
    <div ref={parentRef} className="max-h-[60vh] overflow-y-auto pr-1">
      <ul
        aria-label="Список предложений"
        className="relative"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const suggestion = items[row.index];
          if (!suggestion) return null;
          return (
            <li
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              className="absolute left-0 top-0 w-full pb-3"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {renderCard(suggestion)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface SuggestionCardProps {
  suggestion: SuggestionResponse;
  status: SuggestionStatus;
  issue: LocateIssue | null;
  selected: boolean;
  unsaved: boolean;
  canReview: boolean;
  onSelect: (id: string) => void;
  onDecide?: (id: string, decision: PanelDecision) => void;
  onUndo?: (id: string) => void;
}

/**
 * Элемент списка по макету: обычные правки — плоские строки без рамки, выбранная — карточка
 * с кнопками «Принять / Отклонить»; у решённых при наведении поверх статуса появляется
 * «Отменить». Обёртка — div, чтобы кнопки действий не оказались внутри кнопки выбора.
 */
const SuggestionCard = memo(function SuggestionCard({
  suggestion: s,
  status,
  issue,
  selected,
  unsaved,
  canReview,
  onSelect,
  onDecide,
  onUndo,
}: SuggestionCardProps) {
  const showActions = selected && status === 'pending' && canReview && Boolean(onDecide);
  const showUndo = status !== 'pending' && Boolean(onUndo);
  return (
    <div
      className={cn(
        'group relative rounded-xl p-3 text-sm transition-colors',
        selected ? 'border bg-card shadow-sm' : 'border border-transparent hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(s.id)}
        className="w-full space-y-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="flex items-center gap-2">
          <ChangeTypeLabel type={s.change_type} />
          {issue ? (
            <TriangleAlert
              className="size-4 shrink-0 text-amber-600"
              aria-label={ISSUE_TEXTS[issue]}
            />
          ) : null}
          {/* Статус решения — у правого края; при наведении его место занимает «Отменить». */}
          {status !== 'pending' ? (
            <span
              className={cn(
                'ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium transition-opacity',
                status === 'accepted' ? 'text-emerald-700' : 'text-muted-foreground',
                showUndo && 'group-focus-within:opacity-0 group-hover:opacity-0',
              )}
            >
              {status === 'accepted' ? (
                <CheckCircle2 className="size-3" aria-hidden />
              ) : (
                <X className="size-3" aria-hidden />
              )}
              {decisionLabel[status]}
              {unsaved ? ' · не сохранено' : ''}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 block break-words text-foreground">{shortText(s)}</span>
        {s.section_ref ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{s.section_ref}</span>
          </span>
        ) : null}
      </button>

      {showUndo ? (
        <button
          type="button"
          onClick={() => onUndo?.(s.id)}
          className="absolute right-3 top-2.5 inline-flex h-6 items-center gap-1 rounded-md border bg-card px-2 text-xs font-medium text-foreground opacity-0 shadow-sm transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 motion-reduce:transition-none"
        >
          <Undo2 className="size-3" aria-hidden />
          Отменить
        </button>
      ) : null}

      {showActions ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onDecide?.(s.id, 'accepted')}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary/10 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Check className="size-3.5" aria-hidden />
            Принять
          </button>
          <button
            type="button"
            onClick={() => onDecide?.(s.id, 'rejected')}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-muted text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
            Отклонить
          </button>
        </div>
      ) : null}
    </div>
  );
});
