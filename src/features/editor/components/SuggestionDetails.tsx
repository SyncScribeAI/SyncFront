import {
  ArrowDownToLine,
  Check,
  CheckCheck,
  ExternalLink,
  FileText,
  MessageSquare,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import type { SuggestionResponse, SuggestionSourceResponse } from '@/api/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { LocatedSuggestion } from '@/domain/editor/projection';
import { decisionLabel, type Decision, type SuggestionStatus } from '@/domain/editor/suggestion';
import { SourceViewer } from '@/features/sources';
import { evidenceOfSource } from '@/domain/source/evidence';

import { EDITOR_TEXTS, GROUP_TEXTS, ISSUE_TEXTS } from '../model/texts';

import { ChangeTypeLabel } from './ChangeTypeLabel';
import { CarriedBadge, GroupBadge, PropagatedBadge, StaleBadge } from './GroupBadges';
import { LowConfidenceBadge } from './LowConfidenceBadge';

interface SuggestionDetailsProps {
  suggestion: SuggestionResponse;
  status: SuggestionStatus;
  /** Решение есть только в буфере и ещё не отправлено. */
  unsaved: boolean;
  /** Новый текст с учётом правки пользователя (несохранённой или сохранённой). */
  newText: string;
  located: LocatedSuggestion | undefined;
  canReview: boolean;
  undoing: boolean;
  /** editedText передаётся только с accepted и только если текст отличается от предложенного ИИ. */
  onDecide: (decision: Decision, editedText?: string) => void;
  onUndo: () => void;
  onClose: () => void;
  /** Группа той же фразы: размер по серверу и число нерешённых среди загруженных. */
  group?: {
    size: number;
    pending: number;
    /** Решение для всех нерешённых правок группы; edited_text этой карточки не копируется. */
    onDecide: (decision: Decision) => void;
    /** Следующая правка группы в порядке документа; null — переходить некуда. */
    onNext: (() => void) | null;
  };
}

function Fragment({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 text-sm">
        {children}
      </div>
    </div>
  );
}

/**
 * Карточка «Предложение ИИ». Раздел, источник, обоснование и уверенность — обычным текстом.
 * «Новый текст» нерассмотренной правки можно отредактировать перед принятием — текст уходит
 * в PUT /review как edited_text и при экспорте заменяет текст ИИ. Для добавления original_text —
 * якорь, после которого встанет новый текст; без найденного якоря правка не применяется.
 */
export function SuggestionDetails({
  suggestion,
  status,
  unsaved,
  newText,
  located,
  canReview,
  undoing,
  onDecide,
  onUndo,
  onClose,
  group,
}: SuggestionDetailsProps) {
  const { change_type: type } = suggestion;
  const [draft, setDraft] = useState(newText);
  const [previewSource, setPreviewSource] = useState<SuggestionSourceResponse | null>(null);
  const sources = suggestion.sources ?? [];
  const sourceEvidence = useMemo(() => {
    const evidence = suggestion.evidence ?? [];
    return new Map(
      (suggestion.sources ?? []).map((source) => [
        source.id,
        evidenceOfSource(evidence, source.id),
      ]),
    );
  }, [suggestion.sources, suggestion.evidence]);
  const confidence =
    typeof suggestion.confidence_score === 'number'
      ? Math.round(suggestion.confidence_score * 100)
      : null;

  const editable = status === 'pending' && canReview && type !== 'delete';
  const aiText = (suggestion.suggested_text ?? '').trim();
  const trimmedDraft = draft.trim();
  const edited = (editable ? trimmedDraft : newText.trim()) !== aiText;
  const anchor = type === 'add' ? (suggestion.original_text ?? '').trim() : '';

  const accept = () => {
    onDecide('accepted', editable && edited ? trimmedDraft : undefined);
  };

  return (
    <section
      aria-label="Карточка предложения"
      className="animate-fade-in overflow-hidden rounded-xl border bg-card shadow-xl"
    >
      <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
          <span className="inline-flex items-center gap-2">
            <MessageSquare className="size-4 text-primary" aria-hidden />
            Предложение ИИ
          </span>
          <ChangeTypeLabel type={type} />
          {status !== 'pending' ? (
            <span className="text-xs font-medium text-muted-foreground">
              {decisionLabel[status]}
              {unsaved ? ' · не сохранено' : ''}
            </span>
          ) : null}
        </div>
        <Button size="iconXs" variant="ghost" onClick={onClose} aria-label="Закрыть карточку">
          <X aria-hidden />
        </Button>
      </header>

      <div className="space-y-3 p-4">
        <div className="space-y-1 text-sm">
          {suggestion.section_ref ? (
            <p className="text-xs text-muted-foreground">Раздел: {suggestion.section_ref}</p>
          ) : null}
          {sources.length > 0 ? (
            <div className="space-y-1" aria-label="Источники правки">
              {sources.map((source) =>
                // Ссылка с основаниями открывается в просмотре снимка: там видна цитата,
                // а страница сайта могла с тех пор измениться.
                source.type === 'url' && source.url && !sourceEvidence.get(source.id)?.length ? (
                  <a
                    key={source.id}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-fit items-center gap-1.5 font-medium text-primary underline underline-offset-4 hover:text-primary/80"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    Источник: {source.name}
                  </a>
                ) : (
                  <button
                    key={source.id}
                    type="button"
                    className="flex items-center gap-1.5 text-left font-medium text-primary underline underline-offset-4 hover:text-primary/80"
                    onClick={() => setPreviewSource(source)}
                  >
                    <FileText className="size-3.5 shrink-0" aria-hidden />
                    Источник: {source.name}
                  </button>
                ),
              )}
            </div>
          ) : (
            <p className="font-medium text-muted-foreground">Источник недоступен</p>
          )}
          <p>{suggestion.rationale ?? 'ИИ не указал обоснование.'}</p>
          {(group && group.size > 1) ||
          suggestion.origin === 'propagated' ||
          suggestion.carried_from_id ||
          suggestion.stale ? (
            <p className="flex flex-wrap items-center gap-2">
              <GroupBadge size={group?.size} />
              <PropagatedBadge origin={suggestion.origin} />
              <CarriedBadge carriedFrom={suggestion.carried_from_id} />
              <StaleBadge stale={suggestion.stale} />
            </p>
          ) : null}
          {suggestion.stale ? <p className="text-amber-800">{GROUP_TEXTS.staleHint}</p> : null}
          {confidence !== null ? (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Уверенность ИИ: {confidence}%
              <LowConfidenceBadge score={suggestion.confidence_score} />
            </p>
          ) : null}
        </div>

        {type !== 'add' ? (
          <Fragment label="Текущий текст">{suggestion.original_text}</Fragment>
        ) : null}
        {anchor ? <Fragment label="Вставить после">{anchor}</Fragment> : null}
        {type === 'delete' ? (
          <p className="text-sm text-red-700">{EDITOR_TEXTS.deleteMessage}</p>
        ) : editable ? (
          <div className="space-y-1">
            <label
              htmlFor={`new-text-${suggestion.id}`}
              className="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Новый текст
            </label>
            <textarea
              id={`new-text-${suggestion.id}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={4}
              className="min-h-[7rem] w-full resize-y rounded-md border bg-muted/40 p-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              {edited
                ? 'Текст изменён — в документ попадёт ваш вариант.'
                : 'Текст можно отредактировать перед принятием.'}
            </p>
          </div>
        ) : (
          <Fragment label={edited ? 'Новый текст (отредактирован)' : 'Новый текст'}>
            {newText}
          </Fragment>
        )}
        {type === 'add' && located?.inline ? (
          <p className="text-xs text-muted-foreground">{EDITOR_TEXTS.addAfterAnchor}</p>
        ) : null}

        {located?.issue ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription>{ISSUE_TEXTS[located.issue]}</AlertDescription>
          </Alert>
        ) : null}

        {group && group.size > 1 && (group.onNext || (canReview && group.pending > 1)) ? (
          <div
            className="space-y-2 rounded-md border border-dashed p-2.5"
            aria-label="Группа правок"
          >
            {canReview && group.pending > 1 ? (
              <p className="text-xs text-muted-foreground">{GROUP_TEXTS.hint}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {canReview && group.pending > 1 ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => group.onDecide('accepted')}>
                    <CheckCheck aria-hidden />
                    {GROUP_TEXTS.acceptAll(group.pending)}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => group.onDecide('rejected')}>
                    {GROUP_TEXTS.rejectAll}
                  </Button>
                </>
              ) : null}
              {group.onNext ? (
                <Button size="sm" variant="ghost" onClick={group.onNext}>
                  <ArrowDownToLine aria-hidden />
                  {GROUP_TEXTS.next}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {status === 'pending' && canReview ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => onDecide('rejected')}>
                Отклонить
              </Button>
              <Button size="sm" onClick={accept} disabled={editable && trimmedDraft === ''}>
                <Check aria-hidden />
                Принять
              </Button>
            </>
          ) : null}
          {status !== 'pending' ? (
            <Button size="sm" variant="outline" loading={undoing} onClick={onUndo}>
              <Undo2 aria-hidden />
              Отменить
            </Button>
          ) : null}
        </div>
      </div>
      {previewSource ? (
        <SourceViewer
          projectId={previewSource.project_id}
          source={previewSource}
          evidence={sourceEvidence.get(previewSource.id)}
          open
          onOpenChange={(open) => {
            if (!open) setPreviewSource(null);
          }}
        />
      ) : null}
    </section>
  );
}
