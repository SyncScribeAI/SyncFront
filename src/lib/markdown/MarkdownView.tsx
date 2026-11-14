import { memo, useMemo, useRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import Markdown, { type Components, type ExtraProps, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { TextRange } from '@/domain/editor/textRange';
import { cn } from '@/lib/cn';

import { chunkKeys, splitMarkdownChunks, type MarkdownChunk } from './chunks';
import { RANGE_TAG, rehypeSourceRanges, type SourceRange } from './rehypeSourceRanges';
import { remarkPipeTables } from './remarkPipeTables';

export interface RangeRenderProps {
  range: TextRange;
  /** Кусок содержит начало диапазона: на нём ставится фокус. */
  first: boolean;
  /** Кусок содержит конец диапазона: после него рисуется новый текст и кнопки. */
  last: boolean;
  children: ReactNode;
}

export type RangeRenderer = (props: RangeRenderProps) => ReactNode;

export interface MarkdownViewProps {
  text: string;
  /** Непересекающиеся, по возрастанию начала, в координатах text (UTF-16). */
  ranges?: readonly TextRange[];
  renderRange?: RangeRenderer;
  /**
   * Состояние диапазона, от которого зависит его вид (статус, выбор). Кусок текста
   * перерисовывается, только когда меняется его текст или состояние его диапазонов.
   */
  rangeState?: (range: TextRange) => string;
  /** Текст снимка источника: строки «| a | b |» без разделителя рисуются таблицей. */
  pipeTables?: boolean;
  className?: string;
}

const NO_RANGES: readonly TextRange[] = [];
const SAFE_URL = /^(?:https?:|mailto:)/i;

/** Ссылки только с разрешёнными схемами; относительные и прочие остаются текстом. */
const safeUrl = (url: string) => (SAFE_URL.test(url.trim()) ? url : null);

interface ChunkRanges {
  chunk: MarkdownChunk;
  ranges: SourceRange[];
  byKey: Map<string, TextRange>;
}

const rangeKey = (kind: string, id: string) => `${kind}:${id}`;

/**
 * Диапазоны по кускам за один проход: и куски, и диапазоны идут по возрастанию.
 * Диапазон через границу кусков делится; head и tail отмечают, в каком куске его начало
 * и конец. Пустой диапазон на границе относится к следующему куску, у последнего куска
 * к нему самому.
 */
function distribute(chunks: readonly MarkdownChunk[], ranges: readonly TextRange[]): ChunkRanges[] {
  let r = 0;
  return chunks.map((chunk, index) => {
    const from = chunk.start;
    const to = chunk.start + chunk.text.length;
    const lastChunk = index === chunks.length - 1;
    const local: SourceRange[] = [];
    const byKey = new Map<string, TextRange>();
    while (r < ranges.length) {
      const range = ranges[r];
      if (!range) break;
      const point = range.start === range.end;
      if (point ? range.start >= to && !lastChunk : range.start >= to) break;
      if (point || range.end > from) {
        local.push({
          id: range.id,
          kind: range.kind,
          start: Math.max(range.start, from) - from,
          end: Math.min(range.end, to) - from,
          head: range.start >= from,
          tail: range.end <= to,
        });
        byKey.set(rangeKey(range.kind, range.id), range);
      }
      if (!point && range.end > to) break;
      r += 1;
    }
    return { chunk, ranges: local, byKey };
  });
}

/** react-markdown передаёт компонентам узел hast; в DOM он попасть не должен. */
function domProps<P extends ExtraProps>(props: P): Omit<P, 'node'> {
  const rest: P = { ...props };
  delete rest.node;
  return rest;
}

const BASE_COMPONENTS: Components = {
  h1: (props) => <h1 className="mb-3 mt-6 text-2xl font-bold" {...domProps(props)} />,
  h2: (props) => <h2 className="mb-3 mt-6 text-xl font-bold" {...domProps(props)} />,
  h3: (props) => <h3 className="mb-2 mt-5 text-lg font-semibold" {...domProps(props)} />,
  h4: (props) => <h4 className="mb-2 mt-4 font-semibold" {...domProps(props)} />,
  h5: (props) => <h5 className="mb-2 mt-4 font-semibold" {...domProps(props)} />,
  h6: (props) => <h6 className="mb-2 mt-4 font-semibold" {...domProps(props)} />,
  p: (props) => <p className="my-3" {...domProps(props)} />,
  ul: (props) => <ul className="my-3 list-disc pl-6" {...domProps(props)} />,
  ol: (props) => <ol className="my-3 list-decimal pl-6" {...domProps(props)} />,
  li: (props) => <li className="my-1" {...domProps(props)} />,
  blockquote: (props) => (
    <blockquote
      className="my-3 border-l-2 border-border pl-3 text-muted-foreground"
      {...domProps(props)}
    />
  ),
  hr: (props) => <hr className="my-6 border-border" {...domProps(props)} />,
  pre: (props) => (
    <pre
      className="my-3 overflow-x-auto whitespace-pre rounded-md bg-muted p-3 font-mono text-[0.9em] [&_code]:bg-transparent [&_code]:p-0"
      {...domProps(props)}
    />
  ),
  code: (props) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]" {...domProps(props)} />
  ),
  table: (props) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left" {...domProps(props)} />
    </div>
  ),
  th: (props) => (
    <th className="border border-border bg-muted/50 px-2 py-1 font-semibold" {...domProps(props)} />
  ),
  td: (props) => <td className="border border-border px-2 py-1" {...domProps(props)} />,
  a: ({ href, children, ...props }) =>
    href ? (
      <a
        {...domProps(props)}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // В закрытом контуре внешние изображения не загружаются: вместо них подпись.
  img: ({ alt }) => (
    <span className="rounded border border-dashed border-border px-1 text-muted-foreground">
      {alt ? `[${alt}]` : '[изображение]'}
    </span>
  ),
};

type RemarkPlugins = NonNullable<Options['remarkPlugins']>;
const DOCUMENT_PLUGINS: RemarkPlugins = [remarkGfm];
const SNAPSHOT_PLUGINS: RemarkPlugins = [remarkGfm, remarkPipeTables];

interface ChunkProps {
  part: ChunkRanges;
  stateKey: string;
  rendererRef: { current: RangeRenderer | undefined };
  pipeTables: boolean;
}

type SpanProps = ComponentPropsWithoutRef<'span'> & Record<`data-${string}`, string | undefined>;

const Chunk = memo(
  function Chunk({ part, rendererRef, pipeTables }: ChunkProps) {
    const { chunk, ranges, byKey } = part;
    // Компонент диапазона создаётся один раз на кусок: новый тип компонента заставил бы
    // React пересоздать узлы, и фокус и ссылки на них потерялись бы. Данные берутся по ref.
    const byKeyRef = useRef(byKey);
    byKeyRef.current = byKey;
    const components = useMemo<Components>(
      () => ({
        ...BASE_COMPONENTS,
        [RANGE_TAG]: (raw) => {
          const props = domProps(raw) as SpanProps;
          const id = props['data-range-id'];
          const kind = props['data-range-kind'];
          const range = id && kind ? byKeyRef.current.get(rangeKey(kind, id)) : undefined;
          const render = rendererRef.current;
          if (!range || !render) return <span {...props} />;
          return render({
            range,
            first: props['data-range-first'] === 'true',
            last: props['data-range-last'] === 'true',
            children: props.children,
          });
        },
      }),
      [rendererRef],
    );
    return (
      <Markdown
        remarkPlugins={pipeTables ? SNAPSHOT_PLUGINS : DOCUMENT_PLUGINS}
        rehypePlugins={[[rehypeSourceRanges, { source: chunk.text, ranges }]]}
        components={components}
        urlTransform={safeUrl}
      >
        {chunk.text}
      </Markdown>
    );
  },
  (prev, next) =>
    prev.part.chunk.text === next.part.chunk.text &&
    prev.stateKey === next.stateKey &&
    prev.pipeTables === next.pipeTables,
);

/**
 * Markdown в исходном форматировании с подсветкой диапазонов. Сырой HTML выводится
 * текстом, ссылки открываются в новой вкладке, изображения заменяются подписью.
 */
export function MarkdownView({
  text,
  ranges = NO_RANGES,
  renderRange,
  rangeState,
  pipeTables = false,
  className,
}: MarkdownViewProps) {
  const rendererRef = useRef(renderRange);
  rendererRef.current = renderRange;
  const chunks = useMemo(() => splitMarkdownChunks(text), [text]);
  const keys = useMemo(() => chunkKeys(chunks), [chunks]);
  const parts = useMemo(() => distribute(chunks, ranges), [chunks, ranges]);
  return (
    <div className={cn('break-words', className)}>
      {parts.map((part, index) => (
        <Chunk
          key={keys[index]}
          part={part}
          rendererRef={rendererRef}
          pipeTables={pipeTables}
          stateKey={part.ranges
            .map((range) => {
              const full = part.byKey.get(rangeKey(range.kind, range.id));
              const state = full && rangeState ? rangeState(full) : '';
              return `${range.kind}:${range.id}:${range.start}:${range.end}:${state}`;
            })
            .join('|')}
        />
      ))}
    </div>
  );
}
