/**
 * Подключение pdf.js без обращений за пределы своего origin.
 *
 * Библиотека загружается динамическим импортом отдельным чанком, чтобы основной бандл
 * оставался прежним. Воркер берётся из пакета через импорт Vite с суффиксом ?url, а
 * cmaps, стандартные шрифты, wasm и ICC-профили копируются из пакета в /pdfjs/ при
 * сборке (плагин pdfjsAssets в vite.config.ts).
 */
import type * as Pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import type { PdfDocument, PdfEngine, PdfLoading, PdfPage, PdfTask, PdfViewport } from './engine';

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

type PdfjsModule = typeof Pdfjs;
let pdfjsModule: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsModule ??= import('pdfjs-dist').then((module) => {
    module.GlobalWorkerOptions.workerSrc = workerUrl;
    return module;
  });
  return pdfjsModule;
}

function open(data: ArrayBuffer): PdfLoading {
  let destroyed = false;
  let task: ReturnType<PdfjsModule['getDocument']> | null = null;
  const promise = loadPdfjs().then((pdfjs) => {
    if (destroyed) throw new Error('PDF закрыт до загрузки');
    task = pdfjs.getDocument({
      // pdf.js передаёт буфер воркеру и отсоединяет его; копия оставляет данные кеша целыми.
      data: new Uint8Array(data.slice(0)),
      cMapUrl: `${ASSETS}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ASSETS}standard_fonts/`,
      wasmUrl: `${ASSETS}wasm/`,
      iccUrl: `${ASSETS}iccs/`,
      isEvalSupported: false,
      enableXfa: false,
    });
    return task.promise as unknown as Promise<PdfDocument>;
  });
  return {
    promise,
    destroy: () => {
      destroyed = true;
      return task?.destroy();
    },
  };
}

function textLayer(page: PdfPage, container: HTMLElement, viewport: PdfViewport): PdfTask {
  let layer: InstanceType<PdfjsModule['TextLayer']> | null = null;
  let cancelled = false;
  const promise = loadPdfjs().then((pdfjs) => {
    if (cancelled) return undefined;
    const real = page as unknown as Pdfjs.PDFPageProxy;
    layer = new pdfjs.TextLayer({
      textContentSource: real.streamTextContent(),
      container,
      viewport: viewport as unknown as Pdfjs.PageViewport,
    });
    return layer.render();
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      layer?.cancel();
    },
  };
}

export const pdfjsEngine: PdfEngine = { open, textLayer };
