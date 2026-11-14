/**
 * Деление Markdown на независимо разбираемые куски.
 *
 * Разбор micromark растёт быстрее длины текста: 200 тыс. символов целиком разбираются
 * 2–3 с, а те же символы по блокам около 1 с при любом размере куска. Кусок к тому же
 * разбирается заново, только если изменился его текст или подсветка, поэтому решение по
 * правке перерисовывает один кусок. Граница ставится на каждом месте, где разметка
 * соседних кусков не может зависеть друг от друга: после пустой строки, перед строкой
 * без отступа, которая не продолжает список, вне блока кода. Границы зависят только от
 * соседних строк, поэтому вставка абзаца не сдвигает куски дальше по тексту.
 * Определения ссылок и сносок действуют на весь документ, поэтому текст с ними
 * разбирается одним куском.
 */

export interface MarkdownChunk {
  /** Смещение начала куска в тексте (UTF-16). */
  start: number;
  text: string;
}

const DEFINITION = /^ {0,3}\[[^\]\n]+\]:/m;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const BLANK = /^[ \t]*$/;

export function splitMarkdownChunks(text: string): MarkdownChunk[] {
  if (DEFINITION.test(text)) return [{ start: 0, text }];
  const chunks: MarkdownChunk[] = [];
  let chunkStart = 0;
  let fence: string | null = null;
  let previousBlank = false;
  let lineStart = 0;
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    const opener = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length) fence = null;
    } else {
      const boundary =
        previousBlank && !BLANK.test(line) && !/^[ \t]/.test(line) && !LIST_ITEM.test(line);
      if (boundary) {
        chunks.push({ start: chunkStart, text: text.slice(chunkStart, lineStart) });
        chunkStart = lineStart;
      }
      if (opener) fence = opener;
    }
    previousBlank = BLANK.test(line);
    lineStart = lineEnd + 1;
  }
  chunks.push({ start: chunkStart, text: text.slice(chunkStart) });
  return chunks;
}

/** Ключ куска по содержимому: вставка выше по тексту не меняет ключи следующих кусков. */
export function chunkKeys(chunks: readonly MarkdownChunk[]): string[] {
  const seen = new Map<number, number>();
  return chunks.map((chunk) => {
    // FNV-1a: совпадение хэшей разного текста только перерисует кусок, ключи уникальны за счёт счётчика.
    let hash = 0x811c9dc5;
    for (let i = 0; i < chunk.text.length; i += 1) {
      hash ^= chunk.text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const count = seen.get(hash) ?? 0;
    seen.set(hash, count + 1);
    return `${hash.toString(36)}.${count}`;
  });
}
