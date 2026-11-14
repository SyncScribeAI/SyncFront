/**
 * Подсветка основания в DOM, который построил docx-preview.
 *
 * Абзацы находятся по порядковым номерам непустых абзацев из локатора и проверяются
 * текстом снимка: подпись букв и цифр фрагмента снимка должна входить в подпись этих
 * абзацев. Проверка ловит расхождение нумерации docx-preview и DocxParser, тогда
 * просмотр показывает текст снимка. При точном совпадении фрагмент ищется внутри одного
 * абзаца и оборачивается; не нашёлся или основание приближённое, подсвечиваются абзацы
 * целиком.
 */
import type { DocxParagraphs, EvidenceMatch } from '@/domain/source/evidence';
import {
  findBySignature,
  letterSignature,
  nonEmptyParagraphs,
  rangeFor,
  wrapRange,
} from '@/lib/docx/domText';

export const EVIDENCE_ATTR = 'data-evidence';
export const EVIDENCE_BLOCK_ATTR = 'data-evidence-block';

export interface DocxEvidenceInput {
  paragraphs: DocxParagraphs;
  match: EvidenceMatch;
  /** Фрагмент текста снимка под основанием. */
  fragment: string;
}

/** Первый подсвеченный элемент или null, если абзацы не нашлись или не прошли проверку. */
export function markDocxEvidence(host: HTMLElement, input: DocxEvidenceInput): HTMLElement | null {
  const { first, last } = input.paragraphs;
  const blocks = nonEmptyParagraphs(host).slice(first, last + 1);
  if (blocks.length !== last - first + 1) return null;
  const expected = letterSignature(input.fragment).value;
  const actual = blocks.map((block) => letterSignature(block.text).value).join('');
  if (!expected || !actual.includes(expected)) return null;

  if (input.match === 'exact') {
    for (const block of blocks) {
      const found = findBySignature(block, input.fragment);
      if (found)
        return wrapRange(
          rangeFor(block, found.start, found.end - found.start),
          EVIDENCE_ATTR,
          'true',
        );
    }
  }
  for (const block of blocks) block.element.setAttribute(EVIDENCE_BLOCK_ATTR, 'true');
  return blocks[0]?.element ?? null;
}

/** Снимает подсветку прошлого основания: обёртки разворачиваются, отметки абзацев снимаются. */
export function clearDocxEvidence(host: HTMLElement): void {
  for (const span of Array.from(host.querySelectorAll<HTMLElement>(`[${EVIDENCE_ATTR}]`))) {
    span.replaceWith(...Array.from(span.childNodes));
  }
  for (const block of Array.from(host.querySelectorAll(`[${EVIDENCE_BLOCK_ATTR}]`))) {
    block.removeAttribute(EVIDENCE_BLOCK_ATTR);
  }
  host.normalize();
}
