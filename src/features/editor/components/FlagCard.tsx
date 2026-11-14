import { CheckCircle2, FileText, SearchCheck, Undo2 } from 'lucide-react';
import { memo } from 'react';

import type { AnalysisFlagResponse } from '@/api/types';
import { Button } from '@/components/ui/button';
import { flagReasonLabel } from '@/domain/editor/flag';
import { cn } from '@/lib/cn';
import { MarkdownView } from '@/lib/markdown/MarkdownView';

import { FLAG_TEXTS } from '../model/texts';

/** Сколько символов фрагмента показывать в карточке: полный текст есть в документе. */
const FRAGMENT_LIMIT = 160;

function truncate(text: string): string {
  return text.length > FRAGMENT_LIMIT ? `${text.slice(0, FRAGMENT_LIMIT).trimEnd()}…` : text;
}

interface FlagCardProps {
  flag: AnalysisFlagResponse;
  selected: boolean;
  /** Отметка доступна в ревью (awaiting_approval, ready); в остальных статусах — только чтение. */
  canMark: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onMark: (id: string, status: AnalysisFlagResponse['status']) => void;
}

export const FlagCard = memo(function FlagCard({
  flag,
  selected,
  canMark,
  busy,
  onSelect,
  onMark,
}: FlagCardProps) {
  const reviewed = flag.status === 'reviewed';
  const quotes = flag.quotes as AnalysisFlagResponse['quotes'] | undefined;
  return (
    <div
      data-flag-card-id={flag.id}
      className={cn(
        'space-y-2 rounded-xl border border-dashed p-3 text-sm transition-colors',
        selected ? 'border-sky-500 bg-card shadow-sm' : 'border-sky-300 hover:bg-accent/50',
        reviewed && !selected && 'opacity-70',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(flag.id)}
        className="w-full space-y-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-sky-800">
          <SearchCheck className="size-3.5 shrink-0" aria-hidden />
          {flagReasonLabel(flag.reason)}
          {reviewed ? (
            <span className="ml-auto inline-flex items-center gap-1 font-medium text-emerald-700">
              <CheckCircle2 className="size-3" aria-hidden />
              {FLAG_TEXTS.reviewedLabel}
            </span>
          ) : null}
        </span>
        <span className="line-clamp-3 block break-words text-foreground">
          {truncate(flag.original_text)}
        </span>
        {flag.section_ref ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{flag.section_ref}</span>
          </span>
        ) : null}
      </button>

      {selected && flag.rationale ? (
        <div className="break-words text-muted-foreground">
          <MarkdownView text={flag.rationale} className="[&_p]:my-1" />
        </div>
      ) : null}
      {selected && quotes && quotes.length > 0 ? (
        <ul className="space-y-1 text-xs" aria-label="Цитаты источников">
          {quotes.map((quote, index) => (
            <li key={index} className="break-words">
              <span className="font-medium">{quote.source_name}</span> — «{quote.text}»
            </li>
          ))}
        </ul>
      ) : null}

      {canMark ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onMark(flag.id, reviewed ? 'pending' : 'reviewed')}
        >
          {reviewed ? <Undo2 aria-hidden /> : <CheckCircle2 aria-hidden />}
          {reviewed ? FLAG_TEXTS.reopen : FLAG_TEXTS.markReviewed}
        </Button>
      ) : null}
    </div>
  );
});
