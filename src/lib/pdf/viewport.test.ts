/**
 * Перевод координат проверяется на настоящем PageViewport из pdf.js: страница с
 * CropBox не от нуля и с каждым из поворотов /Rotate.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';

import { fitScale, MAX_SCALE, MIN_SCALE, toViewportRect } from './viewport';

/** PDF из одной пустой страницы: MediaBox [10 20 210 120], то есть 200 на 100 точек. */
function pagePdf(rotate: number): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [10 20 210 120] /Rotate ${rotate} >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function viewportOf(rotate: number, scale: number) {
  const doc = await getDocument({ data: pagePdf(rotate), verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    return page.getViewport({ scale });
  } finally {
    await doc.destroy();
  }
}

// Строка текста от x 20 до 60 и от y 30 до 40 в пространстве страницы.
const RECT = { page: 1, x0: 20, y0: 30, x1: 60, y1: 40 };

describe('toViewportRect', () => {
  it.each([
    [0, 1, { left: 10, top: 80, width: 40, height: 10 }],
    [90, 1, { left: 10, top: 10, width: 10, height: 40 }],
    [180, 1, { left: 150, top: 10, width: 40, height: 10 }],
    [270, 1, { left: 80, top: 150, width: 10, height: 40 }],
    [0, 2, { left: 20, top: 160, width: 80, height: 20 }],
    [90, 1.5, { left: 15, top: 15, width: 15, height: 60 }],
  ])('поворот %i, масштаб %f', async (rotate, scale, expected) => {
    const viewport = await viewportOf(rotate, scale);
    const box = toViewportRect(viewport, RECT);
    expect(box.left).toBeCloseTo(expected.left);
    expect(box.top).toBeCloseTo(expected.top);
    expect(box.width).toBeCloseTo(expected.width);
    expect(box.height).toBeCloseTo(expected.height);
  });
});

describe('fitScale', () => {
  it('вписывает страницу в ширину области в допустимых пределах', () => {
    expect(fitScale(600, 900)).toBe(1.5);
    expect(fitScale(600, 100)).toBe(MIN_SCALE);
    expect(fitScale(100, 10_000)).toBe(MAX_SCALE);
    expect(fitScale(0, 800)).toBe(1);
  });
});
