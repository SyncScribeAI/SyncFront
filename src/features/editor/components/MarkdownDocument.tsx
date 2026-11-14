import { Undo2 } from 'lucide-react';
import { useCallback, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';

import type { FlagRange } from '@/domain/editor/flag';
import { markdownSource, originalSource } from '@/domain/editor/markdownSource';
import type { ChangeSegment, Segment } from '@/domain/editor/projection';
import { changeTypeMeta, decisionLabel } from '@/domain/editor/suggestion';
import type { TextRange } from '@/domain/editor/textRange';
import { cn } from '@/lib/cn';
import { MarkdownView, type RangeRenderProps } from '@/lib/markdown/MarkdownView';

import {
  acceptedTone,
  FLAG_MARK_CLASS,
  PENDING_HEADER,
  pendingTone,
  quietTone,
  rejectedTone,
} from '../lib/changeTones';
import { isMarkerActivation, isSuggestionTarget } from '../lib/suggestionKeyboard';
import { FLAG_TEXTS } from '../model/texts';
import type { ViewMode } from '../model/useEditorModel';

interface MarkdownDocumentProps {
  mode: ViewMode;
  originalText: string;
  segments: Segment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUndo?: (id: string) => void;
  /** Блоки с флагами «проверьте вручную»; в «Чистовике» не показываются. */
  flags?: readonly FlagRange[];
  selectedFlagId?: string | null;
  onSelectFlag?: (id: string) => void;
}

const NO_FLAGS: readonly FlagRange[] = [];

/** Щелчок по продолжению диапазона выбирает его, если не попал в ссылку или кнопку. */
const plainClick = (event: MouseEvent) =>
  !event.defaultPrevented &&
  !(event.target instanceof Element && event.target.closest('a[href], button'));

/**
 * Документ Markdown в исходном форматировании. Правки и флаги рисуются поверх
 * разметки: старый фрагмент сохраняет своё форматирование, новый текст нерассмотренной
 * правки стоит рядом, принятая правка уже в тексте и форматируется вместе с ним.
 */
export function MarkdownDocument({
  mode,
  originalText,
  segments,
  selectedId,
  onSelect,
  onUndo,
  flags = NO_FLAGS,
  selectedFlagId = null,
  onSelectFlag,
}: MarkdownDocumentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shownFlags = onSelectFlag ? flags : NO_FLAGS;
  const source = useMemo(
    () =>
      mode === 'original'
        ? originalSource(originalText, shownFlags)
        : markdownSource(segments, mode, shownFlags),
    [mode, originalText, segments, shownFlags],
  );
  const changes = useMemo(() => {
    const byId = new Map<string, ChangeSegment>();
    for (const segment of segments) if (segment.kind === 'change') byId.set(segment.id, segment);
    return byId;
  }, [segments]);

  const rangeState = useCallback(
    (range: TextRange) => {
      if (range.kind === 'flag') return range.id === selectedFlagId ? 'selected' : '';
      const change = changes.get(range.id);
      if (!change) return '';
      const selected = range.id === selectedId ? 'selected' : '';
      return `${mode}:${change.changeType}:${change.status}:${change.newText}:${selected}`;
    },
    [changes, mode, selectedFlagId, selectedId],
  );

  const selectSuggestion = useCallback(
    (id: string) => {
      onSelect(id);
      hostRef.current?.focus({ preventScroll: true });
    },
    [onSelect],
  );

  const renderRange = ({ range, first, last, children }: RangeRenderProps): ReactNode => {
    if (range.kind === 'flag') {
      if (!onSelectFlag) return children;
      return (
        <FlagFragment
          id={range.id}
          first={first}
          selected={range.id === selectedFlagId}
          onSelect={onSelectFlag}
        >
          {children}
        </FlagFragment>
      );
    }
    const change = changes.get(range.id);
    if (!change || mode === 'original') return children;
    return (
      <SuggestionFragment
        change={change}
        mode={mode}
        first={first}
        last={last}
        selected={change.id === selectedId}
        onSelect={selectSuggestion}
        onUndo={onUndo}
      >
        {children}
      </SuggestionFragment>
    );
  };

  return (
    <div
      className="font-serif text-sm leading-6 text-foreground outline-none md:text-[15px] md:leading-7"
      data-testid="document-text"
      ref={hostRef}
      tabIndex={-1}
    >
      <MarkdownView
        text={source.text}
        ranges={source.ranges}
        renderRange={renderRange}
        rangeState={rangeState}
      />
    </div>
  );
}

interface FlagFragmentProps {
  id: string;
  first: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  children: ReactNode;
}

/** Флаг на блоке; кнопкой с фокусом служит первый кусок, остальные только откликаются на щелчок. */
function FlagFragment({ id, first, selected, onSelect, children }: FlagFragmentProps) {
  return (
    <mark
      role={first ? 'button' : undefined}
      tabIndex={first ? 0 : undefined}
      aria-label={first ? FLAG_TEXTS.sectionTitle : undefined}
      aria-pressed={first ? selected : undefined}
      data-flag-id={id}
      onClick={(event) => {
        if (plainClick(event)) onSelect(id);
      }}
      onKeyDown={(event) => {
        if (first && isMarkerActivation(event.nativeEvent)) {
          event.preventDefault();
          onSelect(id);
        }
      }}
      className={cn(FLAG_MARK_CLASS, selected && 'ring-2 ring-sky-500 ring-offset-1')}
    >
      {children}
    </mark>
  );
}

interface SuggestionFragmentProps {
  change: ChangeSegment;
  mode: Exclude<ViewMode, 'original'>;
  first: boolean;
  last: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onUndo: ((id: string) => void) | undefined;
  children: ReactNode;
}

/**
 * Кусок правки внутри разметки. Правка может занимать несколько узлов (жирный текст,
 * ячейки, пункты списка), поэтому каждый кусок подсвечен отдельно, а новый текст и
 * кнопка отмены стоят после последнего.
 */
function SuggestionFragment({
  change,
  mode,
  first,
  last,
  selected,
  onSelect,
  onUndo,
  children,
}: SuggestionFragmentProps) {
  const { changeType, status, newText } = change;
  const decided = status !== 'pending';
  const accepted = status === 'accepted';
  const quiet = mode === 'clean' && decided;
  const point = changeType === 'add' && mode === 'suggestions';
  const meta = changeTypeMeta[changeType];
  const label = `${meta.label}${decided ? `, ${decisionLabel[status].toLowerCase()}` : ''}`;
  const tone = quiet
    ? quietTone
    : status === 'pending'
      ? pendingTone[changeType]
      : accepted
        ? acceptedTone[changeType]
        : rejectedTone;

  let content: ReactNode;
  if (point) {
    const { Icon, verb } = PENDING_HEADER.add;
    content = (
      <>
        {status === 'pending' ? (
          <span
            aria-hidden
            className={cn(
              'mb-1.5 flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-wide',
              pendingTone.add.header,
            )}
          >
            <Icon className="size-3.5" />
            {verb}
          </span>
        ) : null}
        <ins className="block whitespace-pre-wrap no-underline">{newText}</ins>
      </>
    );
  } else if (status === 'pending') {
    content = (
      <>
        <del className={cn('line-through decoration-2', pendingTone[changeType].old)}>
          {children}
        </del>
        {last && changeType === 'modify' ? (
          <ins className="ml-1 whitespace-pre-wrap font-medium text-foreground no-underline">
            {newText}
          </ins>
        ) : null}
      </>
    );
  } else if (accepted && changeType === 'modify' && mode === 'suggestions') {
    // Старый фрагмент остаётся в разметке исходника приглушённым, новый текст стоит рядом.
    content = (
      <>
        <del className="text-muted-foreground line-through decoration-1">{children}</del>
        {last ? <ins className="ml-1 whitespace-pre-wrap no-underline">{newText}</ins> : null}
      </>
    );
  } else if (accepted && changeType === 'delete') {
    content = (
      <del className="text-red-700/70 line-through decoration-red-400 decoration-2">{children}</del>
    );
  } else if (accepted) {
    content = <ins className="no-underline">{children}</ins>;
  } else {
    content = children;
  }

  const activate = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    onSelect(change.id);
  };

  return (
    <span
      role={first ? 'button' : undefined}
      tabIndex={first ? 0 : undefined}
      aria-label={first ? label : undefined}
      aria-pressed={first ? selected : undefined}
      data-suggestion-id={change.id}
      onClick={(event) => {
        const own = first
          ? !event.defaultPrevented && isSuggestionTarget(event.target, event.currentTarget)
          : plainClick(event);
        if (own) onSelect(change.id);
      }}
      onKeyDown={(event) => {
        if (
          first &&
          isMarkerActivation(event.nativeEvent) &&
          !event.defaultPrevented &&
          isSuggestionTarget(event.target, event.currentTarget)
        )
          activate(event);
      }}
      className={cn(
        'group relative cursor-pointer outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
        point
          ? cn('my-3 block rounded-lg px-4 py-3 font-normal', tone.block)
          : cn('rounded-sm box-decoration-clone px-0.5', tone.inline),
        selected && 'ring-2 ring-primary ring-offset-1',
      )}
    >
      {content}
      {last && decided && onUndo ? (
        <button
          type="button"
          aria-label="Отменить решение"
          title="Отменить решение"
          onClick={(event) => {
            event.stopPropagation();
            onUndo(change.id);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className="ml-1 inline-flex items-center rounded-md border bg-card px-1 align-middle font-sans text-xs text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <Undo2 className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
