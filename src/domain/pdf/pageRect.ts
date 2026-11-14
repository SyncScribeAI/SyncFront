/**
 * Положение текста на странице PDF так, как его отдаёт сервер.
 *
 * Прямоугольник записан в пространстве страницы PDF: точки, начало внизу слева, без учёта
 * CropBox и /Rotate. Поэтому одна запись подходит для любого поворота страницы, а в
 * экранные координаты её переводит просмотрщик.
 */

export interface PageRect {
  /** Номер страницы с единицы. */
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Размер страницы в точках с учётом CropBox и поворота, как в EditorContent.pages. */
export interface PageSize {
  number: number;
  width: number;
  height: number;
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Прямоугольники из списка [page, x0, y0, x1, y1]. Записи неверной формы пропускаются,
 * как и на сервере: одна испорченная запись должна оставлять остальные видимыми. O(R).
 */
export function parsePageRects(value: unknown): PageRect[] {
  if (!Array.isArray(value)) return [];
  const rects: PageRect[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 5 || !item.every(isNumber)) continue;
    const [page, x0, y0, x1, y1] = item as [number, number, number, number, number];
    if (!Number.isInteger(page) || page < 1 || x1 <= x0 || y1 <= y0) continue;
    rects.push({ page, x0, y0, x1, y1 });
  }
  return rects;
}

/** Прямоугольники поля geometry правки или флага; у других форматов поля нет. */
export function geometryRects(geometry: { rects?: unknown } | null | undefined): PageRect[] {
  return geometry ? parsePageRects(geometry.rects) : [];
}
