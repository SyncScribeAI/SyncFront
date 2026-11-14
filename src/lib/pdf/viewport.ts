/**
 * Перевод прямоугольника страницы PDF в координаты отрисованной страницы.
 *
 * Перевод делает сам pdf.js (PageViewport.convertToViewportRectangle): он учитывает
 * CropBox, поворот и масштаб так же, как при отрисовке canvas, поэтому подсветка ложится
 * на нарисованный текст при любом повороте.
 */
import type { PageRect } from '@/domain/pdf/pageRect';

export interface ViewportLike {
  width: number;
  height: number;
  convertToViewportRectangle(rect: number[]): number[];
}

export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function toViewportRect(viewport: ViewportLike, rect: PageRect): CssRect {
  const [ax = 0, ay = 0, bx = 0, by = 0] = viewport.convertToViewportRectangle([
    rect.x0,
    rect.y0,
    rect.x1,
    rect.y1,
  ]);
  // После поворота углы меняются местами, поэтому границы берутся через min и max.
  const left = Math.min(ax, bx);
  const top = Math.min(ay, by);
  return { left, top, width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/** Масштаб, при котором страница шириной pageWidth точек занимает ширину области. */
export function fitScale(pageWidth: number, areaWidth: number): number {
  if (pageWidth <= 0 || areaWidth <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, areaWidth / pageWidth));
}

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2.5;
