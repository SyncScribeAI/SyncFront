/**
 * Плагин rehype: оборачивает текст под диапазонами подсветки в элементы с data-range-id.
 *
 * Текстовые узлы дерева идут в порядке исходника, диапазоны отсортированы, поэтому
 * оба списка проходятся двумя указателями за O(n + r). Узел режется по границам
 * диапазона, только когда срез исходника по его позиции равен значению узла: тогда
 * символ узла и символ исходника совпадают один к одному. Иначе (экранирование,
 * сущности, «>» на продолжении цитаты, содержимое блока кода) узел неделим и
 * оборачивается целиком в первый пересекающий его диапазон.
 */
import type { Element, ElementContent, Parent, Root, Text } from 'hast';
import type { Position } from 'unist';

export interface SourceRange {
  id: string;
  kind: string;
  start: number;
  end: number;
  /** Кусок содержит начало диапазона; по умолчанию да. */
  head?: boolean;
  /** Кусок содержит конец диапазона; по умолчанию да. */
  tail?: boolean;
}

export interface SourceRangesOptions {
  /** Текст, который разбирался: позиции узлов указывают в него. */
  source: string;
  /** Непересекающиеся, по возрастанию начала. */
  ranges: readonly SourceRange[];
}

export const RANGE_TAG = 'span';

interface Located {
  node: Text;
  parent: Parent;
  start: number;
  end: number;
  exact: boolean;
}

function collectText(tree: Root, source: string): Located[] {
  const found: Located[] = [];
  // Обход в глубину без рекурсии: глубина вложенных списков и цитат не ограничена.
  // Текст блока кода mdast-util-to-hast создаёт без позиции. Единственный ребёнок
  // получает позицию ближайшего предка и считается неделимым; переводы строк между
  // строками таблицы и абзацами цитаты тоже без позиции, но у них есть соседи, и
  // они пропускаются.
  const order: { parent: Parent; index: number; span?: { start: number; end: number } }[] = [
    { parent: tree, index: 0 },
  ];
  while (order.length > 0) {
    const frame = order[order.length - 1];
    if (!frame) break;
    const child = frame.parent.children[frame.index];
    if (!child) {
      order.pop();
      continue;
    }
    frame.index += 1;
    // Сырой HTML выводится текстом; react-markdown сделал бы это после плагинов, а
    // подсветка нужна и ему.
    if (child.type === 'raw') (child as { type: string }).type = 'text';
    if (child.type === 'text') {
      const own = spanOf(child);
      const span = own ?? (frame.parent.children.length === 1 ? frame.span : undefined);
      if (!span) continue;
      found.push({
        node: child,
        parent: frame.parent,
        start: span.start,
        end: span.end,
        exact: own !== undefined && source.slice(span.start, span.end) === child.value,
      });
    } else if ('children' in child) {
      order.push({ parent: child, index: 0, span: spanOf(child) ?? frame.span });
    }
  }
  return found;
}

function spanOf(node: { position?: Position }): { start: number; end: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? undefined : { start, end };
}

function wrap(range: SourceRange, value: string, fragments: Map<SourceRange, Element[]>): Element {
  const element: Element = {
    type: 'element',
    tagName: RANGE_TAG,
    properties: { dataRangeId: range.id, dataRangeKind: range.kind },
    children: value ? [{ type: 'text', value }] : [],
  };
  const list = fragments.get(range);
  if (list) list.push(element);
  else fragments.set(range, [element]);
  return element;
}

const isPoint = (range: SourceRange) => range.start === range.end;

export function applySourceRanges(tree: Root, options: SourceRangesOptions): void {
  const { source, ranges } = options;
  if (ranges.length === 0) return;
  const texts = collectText(tree, source);
  const replaced = new Map<Text, ElementContent[]>();
  const parents = new Set<Parent>();
  const fragments = new Map<SourceRange, Element[]>();
  const replace = (located: Located, nodes: ElementContent[]) => {
    replaced.set(located.node, nodes);
    parents.add(located.parent);
  };
  const append = (located: Located, marker: Element) =>
    replace(located, [...(replaced.get(located.node) ?? [located.node]), marker]);

  let r = 0;
  let previous: Located | null = null;
  for (const located of texts) {
    const { start, end, node } = located;
    // Пустой диапазон, не попавший ни в один узел (например, после блока кода),
    // встаёт после предыдущего узла.
    const nodes: ElementContent[] = [];
    while (r < ranges.length) {
      const range = ranges[r];
      if (!range) break;
      if (isPoint(range) && range.start < start) {
        const marker = wrap(range, '', fragments);
        if (previous) append(previous, marker);
        else nodes.push(marker);
      } else if (isPoint(range) || range.end > start) {
        break;
      }
      r += 1;
    }
    let touched = nodes.length > 0;
    const inside = (range: SourceRange) =>
      isPoint(range) ? range.start <= end : range.start < end;
    if (located.exact) {
      let cursor = start;
      for (let k = r; k < ranges.length; k += 1) {
        const range = ranges[k];
        if (!range || !inside(range)) break;
        const from = Math.max(range.start, start);
        const to = Math.min(range.end, end);
        if (from > cursor) nodes.push({ type: 'text', value: source.slice(cursor, from) });
        nodes.push(wrap(range, source.slice(from, to), fragments));
        cursor = to;
        touched = true;
      }
      if (touched && cursor < end) nodes.push({ type: 'text', value: source.slice(cursor, end) });
    } else {
      let covering: SourceRange | null = null;
      const points: SourceRange[] = [];
      for (let k = r; k < ranges.length; k += 1) {
        const range = ranges[k];
        if (!range || !inside(range)) break;
        if (isPoint(range)) points.push(range);
        else covering ??= range;
      }
      if (covering || points.length > 0 || touched) {
        nodes.push(covering ? wrap(covering, node.value, fragments) : node);
        for (const point of points) nodes.push(wrap(point, '', fragments));
        touched = true;
      }
    }
    if (touched) replace(located, nodes);
    // Дальше остаются только диапазоны, которые продолжаются за концом узла.
    while (r < ranges.length) {
      const range = ranges[r];
      if (!range || (isPoint(range) ? range.start > end : range.end > end)) break;
      r += 1;
    }
    previous = located;
  }
  for (; r < ranges.length && previous; r += 1) {
    const range = ranges[r];
    if (range && isPoint(range)) append(previous, wrap(range, '', fragments));
  }

  for (const parent of parents) {
    parent.children = (parent.children as ElementContent[]).flatMap((child) =>
      child.type === 'text' ? (replaced.get(child) ?? [child]) : [child],
    );
  }
  for (const [range, list] of fragments) {
    const first = list[0];
    const last = list[list.length - 1];
    if (first && range.head !== false) first.properties.dataRangeFirst = 'true';
    if (last && range.tail !== false) last.properties.dataRangeLast = 'true';
  }
}

/** Фабрика для rehypePlugins: дерево каждого разбора своё, поэтому оно меняется на месте. */
export function rehypeSourceRanges(options: SourceRangesOptions) {
  return (tree: Root) => applySourceRanges(tree, options);
}
