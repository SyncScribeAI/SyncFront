import { useMemo } from 'react';

import type { SnapshotFormat } from '@/domain/source/evidence';
import type { TextRange } from '@/domain/editor/textRange';
import { MarkdownView, type RangeRenderer } from '@/lib/markdown/MarkdownView';

import { EVIDENCE_ATTR } from '../lib/docxEvidence';

export const EVIDENCE_MARK_CLASS = 'rounded-sm bg-amber-100 text-foreground ring-1 ring-amber-300';

interface SnapshotTextProps {
  text: string;
  format: SnapshotFormat;
  range: TextRange | null;
}

const renderMark: RangeRenderer = ({ first, children }) => (
  // Прокрутка ищет первый фрагмент: диапазон через границу узлов рисуется несколькими.
  <mark {...{ [EVIDENCE_ATTR]: first ? 'first' : 'true' }} className={EVIDENCE_MARK_CLASS}>
    {children}
  </mark>
);

/** Текст снимка с подсветкой одного основания: Markdown размеченным, текст абзацами. */
export function SnapshotText({ text, format, range }: SnapshotTextProps) {
  const ranges = useMemo(() => (range ? [range] : []), [range]);
  if (format === 'plain') {
    if (!range) return <div className="whitespace-pre-wrap break-words">{text}</div>;
    return (
      <div className="whitespace-pre-wrap break-words">
        {text.slice(0, range.start)}
        <mark {...{ [EVIDENCE_ATTR]: 'first' }} className={EVIDENCE_MARK_CLASS}>
          {text.slice(range.start, range.end)}
        </mark>
        {text.slice(range.end)}
      </div>
    );
  }
  return (
    <MarkdownView
      text={text}
      ranges={ranges}
      renderRange={renderMark}
      pipeTables={format === 'structured'}
    />
  );
}
