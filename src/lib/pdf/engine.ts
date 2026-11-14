/**
 * Минимальный интерфейс pdf.js, на который опирается просмотр. Через него тесты
 * подставляют поддельный документ: jsdom не умеет canvas и воркеры pdf.js.
 */
import type { ViewportLike } from './viewport';

export interface PdfViewport extends ViewportLike {
  rotation: number;
}

export interface PdfTask {
  promise: Promise<unknown>;
  cancel(): void;
}

export interface PdfPage {
  getViewport(params: { scale: number }): PdfViewport;
  render(params: {
    canvas: HTMLCanvasElement;
    viewport: PdfViewport;
    transform?: number[];
  }): PdfTask;
  cleanup(): unknown;
}

export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

export interface PdfLoading {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void> | void;
}

export interface PdfEngine {
  open(data: ArrayBuffer): PdfLoading;
  /** Текстовый слой ради выделения и копирования; подсветка на него не опирается. */
  textLayer?(page: PdfPage, container: HTMLElement, viewport: PdfViewport): PdfTask;
}
