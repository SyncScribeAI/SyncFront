import { describe, expect, it } from 'vitest';

import {
  docxParagraphs,
  evidenceOfSource,
  evidenceRange,
  pdfRects,
  showsInDocx,
  showsInPdf,
  snapshotFormat,
  type Evidence,
} from './evidence';

function evidence(patch: Partial<Evidence> = {}): Evidence {
  return {
    source_id: 's1',
    source_name: 'Регламент.docx',
    snapshot_id: 'n1',
    quote: 'цитата',
    match: 'exact',
    start_offset: 0,
    end_offset: 6,
    locator: { kind: 'docx_paragraphs', first: 0, last: 0 },
    original_file_available: true,
    ...patch,
  };
}

describe('snapshotFormat', () => {
  it.each([
    [{ name: 'https://example.com', type: 'url' as const }, 'structured'],
    [{ name: 'README.md', type: 'file' as const }, 'markdown'],
    [{ name: 'notes.MARKDOWN', type: 'file' as const }, 'markdown'],
    [{ name: 'лог.txt', type: 'file' as const }, 'plain'],
    [{ name: 'Заметка аналитика', type: 'file' as const }, 'plain'],
    [{ name: 'Регламент.docx', type: 'file' as const }, 'structured'],
    [{ name: 'Отчёт.pdf', type: 'file' as const }, 'structured'],
    [{ name: 'page.html', type: 'file' as const }, 'structured'],
  ])('%o рисуется как %s', (source, format) => {
    expect(snapshotFormat(source)).toBe(format);
  });
});

describe('evidenceOfSource', () => {
  it('берёт основания источника по порядку текста, ненайденные в конце', () => {
    const list = [
      evidence({ quote: 'b', start_offset: 40 }),
      evidence({ quote: 'x', match: 'not_found', start_offset: null }),
      evidence({ quote: 'чужое', source_id: 's2', start_offset: 1 }),
      evidence({ quote: 'a', start_offset: 3 }),
      evidence({ quote: 'без источника', source_id: null }),
    ];
    expect(evidenceOfSource(list, 's1').map((item) => item.quote)).toEqual(['a', 'b', 'x']);
  });
});

describe('evidenceRange', () => {
  it('переводит кодовые точки в UTF-16: эмодзи до цитаты сдвигает диапазон', () => {
    const text = '😀 срок 30 дней';
    // В кодовых точках «срок» начинается с 2, в UTF-16 с 3.
    const range = evidenceRange(text, evidence({ start_offset: 2, end_offset: 6 }), 'e');
    expect(range).toEqual({ id: 'e', kind: 'evidence', start: 3, end: 7 });
    expect(text.slice(range?.start, range?.end)).toBe('срок');
  });

  it.each([
    evidence({ match: 'not_found' }),
    evidence({ start_offset: null }),
    evidence({ start_offset: 5, end_offset: 5 }),
  ])('без места в снимке диапазона нет', (item) => {
    expect(evidenceRange('какой-то текст', item, 'e')).toBeNull();
  });
});

describe('docxParagraphs и showsInDocx', () => {
  it('читает номера абзацев из локатора', () => {
    expect(
      docxParagraphs(evidence({ locator: { kind: 'docx_paragraphs', first: 2, last: 4 } })),
    ).toEqual({
      first: 2,
      last: 4,
    });
  });

  it.each([
    null,
    { kind: 'pdf_rects', rects: [] },
    { kind: 'docx_paragraphs', first: 3, last: 1 },
    { kind: 'docx_paragraphs', first: -1, last: 1 },
    { kind: 'docx_paragraphs', first: '1', last: 2 },
  ])('локатор %o не даёт абзацев', (locator) => {
    expect(docxParagraphs(evidence({ locator }))).toBeNull();
  });

  const docx = { name: 'Регламент.docx', type: 'file' as const };
  it('оригинал DOCX показывается только для того же файла с номерами абзацев', () => {
    expect(showsInDocx(docx, evidence())).toBe(true);
    expect(showsInDocx(docx, evidence({ original_file_available: false }))).toBe(false);
    expect(showsInDocx(docx, evidence({ match: 'not_found' }))).toBe(false);
    expect(showsInDocx(docx, evidence({ locator: null }))).toBe(false);
    expect(showsInDocx({ name: 'Регламент.pdf', type: 'file' }, evidence())).toBe(false);
    expect(showsInDocx({ name: 'https://a.ru/x.docx', type: 'url' }, evidence())).toBe(false);
  });
});

describe('pdfRects и showsInPdf', () => {
  const rects = [
    [2, 72, 700, 300, 712],
    [2, 72, 686, 250, 698],
  ];
  const pdfEvidence = (patch: Partial<Evidence> = {}) =>
    evidence({ source_name: 'Регламент.pdf', locator: { kind: 'pdf_rects', rects }, ...patch });

  it('читает прямоугольники строк из локатора', () => {
    expect(pdfRects(pdfEvidence())).toEqual([
      { page: 2, x0: 72, y0: 700, x1: 300, y1: 712 },
      { page: 2, x0: 72, y0: 686, x1: 250, y1: 698 },
    ]);
  });

  it('пропускает испорченные записи и чужие локаторы', () => {
    const locator = { kind: 'pdf_rects', rects: [[0, 1, 1, 2, 2], 'x', [1, 10, 10, 20, 20]] };
    expect(pdfRects(pdfEvidence({ locator }))).toEqual([
      { page: 1, x0: 10, y0: 10, x1: 20, y1: 20 },
    ]);
    expect(pdfRects(evidence())).toEqual([]);
    expect(pdfRects(pdfEvidence({ locator: null }))).toEqual([]);
  });

  const pdf = { name: 'Регламент.pdf', type: 'file' as const };
  it('оригинал PDF показывается только для того же файла с прямоугольниками', () => {
    expect(showsInPdf(pdf, pdfEvidence())).toBe(true);
    expect(showsInPdf({ name: 'Регламент.PDF', type: 'file' }, pdfEvidence())).toBe(true);
    expect(showsInPdf(pdf, pdfEvidence({ original_file_available: false }))).toBe(false);
    expect(showsInPdf(pdf, pdfEvidence({ match: 'not_found' }))).toBe(false);
    expect(showsInPdf(pdf, pdfEvidence({ locator: { kind: 'pdf_rects', rects: [] } }))).toBe(false);
    expect(showsInPdf({ name: 'Регламент.docx', type: 'file' }, pdfEvidence())).toBe(false);
    expect(showsInPdf({ name: 'https://a.ru/x.pdf', type: 'url' }, pdfEvidence())).toBe(false);
  });
});
