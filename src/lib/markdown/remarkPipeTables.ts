/**
 * Плагин remark для текста снимка: строки «| a | b |» без строки-разделителя GFM
 * становятся таблицей.
 *
 * Единый формат источника отдаёт таблицы DOCX, HTML и PDF такими строками, а remark-gfm
 * без разделителя считает их абзацем. Абзац превращается в таблицу, когда в нём две и
 * более строк, каждая начинается и заканчивается вертикальной чертой и у всех одинаковое
 * число ячеек; первая строка становится шапкой. Текст ячейки берётся из исходника с его
 * позицией, поэтому подсветка по смещениям снимка остаётся верной. Для документов
 * Markdown плагин не подключается: там таблица без разделителя остаётся абзацем, как в
 * любом редакторе Markdown.
 */
import type {
  Paragraph,
  Parent,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
} from 'mdast';
import type { Point } from 'unist';

interface CellSlice {
  start: number;
  end: number;
}

/** Ячейки строки таблицы со смещениями в исходнике или null, если строка не таблица. */
function rowCells(source: string, from: number, to: number): CellSlice[] | null {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(source.charAt(start))) start += 1;
  while (end > start && /\s/.test(source.charAt(end - 1))) end -= 1;
  if (end - start < 2 || source.charAt(start) !== '|' || source.charAt(end - 1) !== '|') {
    return null;
  }
  const cells: CellSlice[] = [];
  let cellStart = start + 1;
  for (let i = start + 1; i < end; i += 1) {
    if (source.charAt(i) !== '|') continue;
    let a = cellStart;
    let b = i;
    while (a < b && /\s/.test(source.charAt(a))) a += 1;
    while (b > a && /\s/.test(source.charAt(b - 1))) b -= 1;
    cells.push({ start: a, end: b });
    cellStart = i + 1;
  }
  return cells;
}

function pointAt(
  lineStarts: readonly number[],
  firstLine: number,
  offset: number,
  row: number,
): Point {
  const lineStart = lineStarts[row] ?? 0;
  return { line: firstLine + row, column: offset - lineStart + 1, offset };
}

/** Таблица из абзаца или null, если абзац не состоит из строк таблицы. */
function tableFrom(paragraph: Paragraph, source: string): Table | null {
  const from = paragraph.position?.start.offset;
  const to = paragraph.position?.end.offset;
  const firstLine = paragraph.position?.start.line;
  if (from === undefined || to === undefined || firstLine === undefined) return null;
  const lineStarts: number[] = [];
  const rows: CellSlice[][] = [];
  let lineStart = from;
  while (lineStart <= to) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline === -1 || newline > to ? to : newline;
    const cells = rowCells(source, lineStart, lineEnd);
    if (!cells || (rows[0] && rows[0].length !== cells.length)) return null;
    lineStarts.push(lineStart);
    rows.push(cells);
    lineStart = lineEnd + 1;
  }
  const width = rows[0]?.length ?? 0;
  if (rows.length < 2 || width === 0) return null;
  return {
    type: 'table',
    align: Array.from({ length: width }, () => null),
    position: paragraph.position,
    children: rows.map((cells, row) => ({
      type: 'tableRow',
      children: cells.map((cell): TableCell => {
        const children: PhrasingContent[] =
          cell.end > cell.start
            ? [
                {
                  type: 'text',
                  value: source.slice(cell.start, cell.end),
                  position: {
                    start: pointAt(lineStarts, firstLine, cell.start, row),
                    end: pointAt(lineStarts, firstLine, cell.end, row),
                  },
                },
              ]
            : [];
        return { type: 'tableCell', children };
      }),
    })),
  };
}

export function applyPipeTables(tree: Root, source: string): void {
  // Обход без рекурсии: таблица может стоять в цитате или пункте списка.
  const stack: Parent[] = [tree];
  for (let parent = stack.pop(); parent; parent = stack.pop()) {
    const children: RootContent[] = parent.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!child) continue;
      if (child.type === 'paragraph') {
        const table = tableFrom(child, source);
        if (table) children[i] = table;
      } else if ('children' in child && child.type !== 'table') {
        stack.push(child);
      }
    }
  }
}

/** Фабрика для remarkPlugins: исходник берётся из разбираемого файла. */
export function remarkPipeTables() {
  return (tree: Root, file: { value: unknown }) => {
    applyPipeTables(tree, String(file.value));
  };
}
