import { Check, Pencil, Undo2, X } from 'lucide-react';
import { memo, useCallback, useMemo, useRef } from 'react';

import type { FlagRange } from '@/domain/editor/flag';
import type { ChangeSegment, Segment } from '@/domain/editor/projection';
import { changeTypeMeta, decisionLabel, type ChangeType } from '@/domain/editor/suggestion';
import { cn } from '@/lib/cn';

import { flagChunks, type FlagChunk } from '../lib/flagMarks';
import { renderMarkdownText } from '../lib/markdownLite';
import { isMarkerActivation, isSuggestionTarget } from '../lib/suggestionKeyboard';
import { FLAG_TEXTS } from '../model/texts';
import type { ViewMode } from '../model/useEditorModel';

interface DocumentTextProps {
  mode: ViewMode;
  originalText: string;
  segments: Segment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Быстрая отмена решения кнопкой на самом блоке (появляется при наведении). */
  onUndo?: (id: string) => void;
  /** Документ в формате Markdown: обычный текст размечается заголовками, списками и т. д. */
  markdown?: boolean;
  /** Блоки с флагами «проверьте вручную»; в «Чистовике» не показываются. */
  flags?: readonly FlagRange[];
  selectedFlagId?: string | null;
  onSelectFlag?: (id: string) => void;
}

const NO_FLAGS: readonly FlagRange[] = [];

/**
 * Правка занимает абзац целиком, если слева и справа от неё — перенос строки
 * (или край документа). Такие правки рисуются блоком по макету; правки внутри
 * предложения остаются инлайновыми, чтобы не рвать строку.
 */
function occupiesParagraph(segments: Segment[], index: number): boolean {
  const prev = segments[index - 1];
  const next = segments[index + 1];
  const startsLine = !prev || (prev.kind === 'text' && /\n\s*$/.test(prev.text));
  const endsLine = !next || (next.kind === 'text' && /^\s*\n/.test(next.text));
  return startsLine && endsLine;
}

/**
 * Текст документа. Сегменты мемоизированы по содержимому: решение по одной правке
 * перестраивает проекцию, но перерисовывается только изменившийся фрагмент.
 */
export function DocumentText({
  mode,
  originalText,
  segments,
  selectedId,
  onSelect,
  onUndo,
  markdown = false,
  flags = NO_FLAGS,
  selectedFlagId = null,
  onSelectFlag,
}: DocumentTextProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // В «Оригинале» весь текст — один сегмент с началом 0.
  const shown = useMemo<Segment[]>(
    () => (mode === 'original' ? [{ kind: 'text', text: originalText, origin: 0 }] : segments),
    [mode, originalText, segments],
  );
  const chunks = useMemo(
    () => (mode === 'clean' || !onSelectFlag ? shown.map(() => null) : flagChunks(shown, flags)),
    [mode, shown, flags, onSelectFlag],
  );
  const selectSuggestion = useCallback(
    (id: string) => {
      onSelect(id);
      hostRef.current?.focus({ preventScroll: true });
    },
    [onSelect],
  );

  return (
    <div
      className="whitespace-pre-wrap break-words font-serif text-sm leading-6 text-foreground outline-none md:text-[15px] md:leading-7"
      data-testid="document-text"
      ref={hostRef}
      tabIndex={-1}
    >
      {shown.map((segment, index) =>
        segment.kind === 'text' ? (
          <TextPart
            key={`t${index}`}
            text={segment.text}
            markdown={markdown}
            atLineStart={index === 0}
            chunks={chunks[index] ?? null}
            selectedFlagId={selectedFlagId}
            onSelectFlag={onSelectFlag}
          />
        ) : mode === 'original' ? null : (
          <ChangePart
            key={segment.id}
            segment={segment}
            mode={mode}
            block={segment.changeType === 'add' || occupiesParagraph(segments, index)}
            selected={segment.id === selectedId}
            onSelect={selectSuggestion}
            onUndo={onUndo}
          />
        ),
      )}
    </div>
  );
}

interface TextPartProps {
  text: string;
  markdown: boolean;
  atLineStart: boolean;
  chunks: FlagChunk[] | null;
  selectedFlagId: string | null;
  onSelectFlag: ((id: string) => void) | undefined;
}

const chunksKey = (chunks: FlagChunk[] | null) =>
  chunks ? chunks.map((chunk) => `${chunk.flagId ?? ''}:${chunk.text.length}`).join('|') : '';

const ownsFlag = (chunks: FlagChunk[] | null, id: string | null) =>
  id !== null && Boolean(chunks?.some((chunk) => chunk.flagId === id));

const TextPart = memo(
  function TextPart({
    text,
    markdown,
    atLineStart,
    chunks,
    selectedFlagId,
    onSelectFlag,
  }: TextPartProps) {
    const render = (part: string, lineStart: boolean) =>
      markdown ? renderMarkdownText(part, lineStart) : part;
    if (!chunks || !onSelectFlag) return <>{render(text, atLineStart)}</>;
    return (
      <>
        {chunks.map((chunk, index) => {
          const lineStart =
            index === 0 ? atLineStart : (chunks[index - 1]?.text.endsWith('\n') ?? false);
          if (chunk.flagId === null)
            return <span key={index}>{render(chunk.text, lineStart)}</span>;
          const id = chunk.flagId;
          return (
            <mark
              key={index}
              role="button"
              tabIndex={0}
              aria-label={FLAG_TEXTS.sectionTitle}
              aria-pressed={id === selectedFlagId}
              data-flag-id={id}
              onClick={() => onSelectFlag(id)}
              onKeyDown={(event) => {
                if (isMarkerActivation(event.nativeEvent)) {
                  event.preventDefault();
                  onSelectFlag(id);
                }
              }}
              className={cn(
                // Не цвета changeTypeMeta: флаг — не правка, у него пунктирная рамка слева.
                'cursor-pointer rounded-sm border-l-2 border-dashed border-sky-500 bg-sky-50/70 box-decoration-clone pl-1 text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring',
                id === selectedFlagId && 'ring-2 ring-sky-500 ring-offset-1',
              )}
            >
              {render(chunk.text, lineStart)}
            </mark>
          );
        })}
      </>
    );
  },
  (prev, next) =>
    prev.text === next.text &&
    prev.markdown === next.markdown &&
    prev.atLineStart === next.atLineStart &&
    prev.onSelectFlag === next.onSelectFlag &&
    chunksKey(prev.chunks) === chunksKey(next.chunks) &&
    ownsFlag(prev.chunks, prev.selectedFlagId) === ownsFlag(next.chunks, next.selectedFlagId) &&
    (!ownsFlag(next.chunks, next.selectedFlagId) || prev.selectedFlagId === next.selectedFlagId),
);

interface ChangePartProps {
  segment: ChangeSegment;
  mode: Exclude<ViewMode, 'original'>;
  /** Правка занимает абзац целиком: блочная карточка по макету. */
  block: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onUndo: ((id: string) => void) | undefined;
}

// Заголовок нерассмотренной блочной правки по макету: иконка + глагол. Доступное имя — из changeTypeMeta.
const PENDING_HEADER: Record<ChangeType, { verb: string; Icon: typeof Pencil }> = {
  modify: { verb: 'Изменить', Icon: Pencil },
  add: { verb: 'Добавить', Icon: Check },
  delete: { verb: 'Удалить', Icon: X },
};

// Нерассмотренные правки — цвет типа: рамка и левая полоса блока, инлайновая подсветка,
// заголовок и зачёркнутый старый текст.
const pendingTone = {
  modify: {
    block: 'border border-l-4 border-amber-300 border-l-amber-400 bg-amber-50/50',
    inline: 'bg-amber-50 ring-1 ring-amber-300',
    header: 'text-amber-800',
    old: 'text-amber-700/80 decoration-amber-600',
  },
  delete: {
    block: 'border border-l-4 border-red-200 border-l-red-400 bg-red-50/50',
    inline: 'bg-red-50 ring-1 ring-red-200',
    header: 'text-red-700',
    old: 'text-red-700/80 decoration-red-600',
  },
  add: {
    block: 'border border-l-4 border-emerald-200 border-l-emerald-400 bg-emerald-50/50',
    inline: 'bg-emerald-50 ring-1 ring-emerald-200',
    header: 'text-emerald-700',
    old: '',
  },
} as const;

// Принятые в «Правках»: изменение и добавление — зелёный блок с новым текстом, удаление — зачёркнуто.
const acceptedTone = {
  modify: { block: 'border-l-4 border-l-emerald-400 bg-emerald-50/60', inline: 'bg-emerald-50' },
  add: { block: 'border-l-4 border-l-emerald-400 bg-emerald-50/60', inline: 'bg-emerald-50' },
  delete: { block: 'bg-red-50/40', inline: '' },
} as const;

// Отклонённые в «Правках»: исходный текст без акцента, но блок остаётся кликабельным.
const rejectedTone = { block: 'border-l-4 border-l-border bg-muted/30', inline: 'bg-muted/40' };

// Рассмотренные в «Чистовике»: обычный текст, подсветка только при наведении — подсказка, что есть отмена.
const quietTone = { block: 'hover:bg-muted/30', inline: 'hover:bg-muted/40' };

const ChangePart = memo(
  function ChangePart({ segment, mode, block, selected, onSelect, onUndo }: ChangePartProps) {
    const { changeType, status, oldText, newText } = segment;
    const decided = status !== 'pending';
    const accepted = status === 'accepted';

    // Отклонённое добавление в документе не показывается; оно доступно из панели «Решено».
    if (changeType === 'add' && status === 'rejected') return null;
    // В «Чистовике» принятое удаление уже применено — текста нет.
    if (mode === 'clean' && accepted && changeType === 'delete') return null;

    // «Чистовик»: нерассмотренные размечены как в «Правках», рассмотренные — без подсветки.
    const quiet = mode === 'clean' && decided;
    const meta = changeTypeMeta[changeType];
    const label = `${meta.label}${decided ? `, ${decisionLabel[status].toLowerCase()}` : ''}`;
    const toneClass = quiet
      ? quietTone
      : status === 'pending'
        ? pendingTone[changeType]
        : accepted
          ? acceptedTone[changeType]
          : rejectedTone;

    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-pressed={selected}
        data-suggestion-id={segment.id}
        onClick={(event) => {
          if (!event.defaultPrevented && isSuggestionTarget(event.target, event.currentTarget))
            onSelect(segment.id);
        }}
        onKeyDown={(event) => {
          if (
            isMarkerActivation(event.nativeEvent) &&
            !event.defaultPrevented &&
            isSuggestionTarget(event.target, event.currentTarget)
          ) {
            event.preventDefault();
            onSelect(segment.id);
          }
        }}
        className={cn(
          'group relative cursor-pointer outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring',
          block
            ? cn('block rounded-lg', quiet ? '-mx-2 my-1 px-2' : 'my-3 px-4 py-3', toneClass.block)
            : cn('rounded-sm box-decoration-clone px-1 py-0.5', toneClass.inline),
          selected && 'ring-2 ring-primary ring-offset-1',
        )}
      >
        {status === 'pending' ? (
          <PendingContent
            changeType={changeType}
            block={block}
            oldText={oldText}
            newText={newText}
          />
        ) : accepted ? (
          changeType === 'delete' ? (
            <del
              className={cn(
                'text-red-700/70 line-through decoration-red-400 decoration-2',
                block && 'block',
              )}
            >
              {oldText}
            </del>
          ) : (
            <ins className={cn('no-underline', block && 'block')}>{newText}</ins>
          )
        ) : (
          <span className={cn(block && 'block')}>{oldText}</span>
        )}
        {decided && onUndo ? (
          // Быстрая отмена: не открывает карточку, поэтому события не всплывают к блоку.
          <button
            type="button"
            aria-label="Отменить решение"
            title="Отменить решение"
            onClick={(event) => {
              event.stopPropagation();
              onUndo(segment.id);
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border bg-card font-sans text-xs text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100',
              block ? 'absolute right-2 top-2 px-2 py-0.5' : 'ml-1 px-1 align-middle',
            )}
          >
            <Undo2 className="size-3.5" aria-hidden />
            {block ? 'Отмена' : null}
          </button>
        ) : null}
      </span>
    );
  },
  (prev, next) =>
    prev.mode === next.mode &&
    prev.block === next.block &&
    prev.selected === next.selected &&
    prev.onSelect === next.onSelect &&
    prev.onUndo === next.onUndo &&
    prev.segment.status === next.segment.status &&
    prev.segment.oldText === next.segment.oldText &&
    prev.segment.newText === next.segment.newText &&
    prev.segment.changeType === next.segment.changeType,
);

interface PendingContentProps {
  changeType: ChangeType;
  block: boolean;
  oldText: string;
  newText: string;
}

/** Нерассмотренная правка: заголовок (в блоке), зачёркнутый старый текст и новый текст. */
function PendingContent({ changeType, block, oldText, newText }: PendingContentProps) {
  const { Icon, verb } = PENDING_HEADER[changeType];
  const colors = pendingTone[changeType];
  return (
    <>
      {block ? (
        // Заголовок декоративный: тип уже есть в aria-label кнопки.
        <span
          aria-hidden
          className={cn(
            'mb-1.5 flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-wide',
            colors.header,
          )}
        >
          <Icon className="size-3.5" />
          {verb}
        </span>
      ) : null}
      {changeType !== 'add' ? (
        <del
          className={cn(
            'line-through decoration-2',
            colors.old,
            block && 'block',
            !block && changeType === 'modify' && 'text-muted-foreground',
          )}
        >
          {oldText}
        </del>
      ) : null}
      {changeType !== 'delete' ? (
        <ins
          className={cn(
            'no-underline',
            block && 'block',
            block && changeType === 'modify' && 'mt-1 font-semibold text-foreground',
            !block && changeType === 'modify' && 'ml-1 font-medium text-foreground',
          )}
        >
          {newText}
        </ins>
      ) : null}
    </>
  );
}
