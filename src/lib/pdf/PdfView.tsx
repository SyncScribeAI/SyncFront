import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';

import type { PageRect, PageSize } from '@/domain/pdf/pageRect';
import { cn } from '@/lib/cn';

import type { PdfDocument, PdfEngine, PdfPage, PdfTask, PdfViewport } from './engine';
import { pdfjsEngine } from './pdfjs';
import { fitScale, toViewportRect, type CssRect } from './viewport';
import './pdfView.css';

/** Подсвеченная область: правка, флаг или цитата может занимать несколько строк и страниц. */
export interface PdfHighlight {
  id: string;
  rects: readonly PageRect[];
  /** Классы прямоугольников; цвет и состояние задаёт вызывающий код. */
  className?: string;
}

export interface PdfViewProps {
  data: ArrayBuffer;
  highlights: readonly PdfHighlight[];
  /** Подсветка, к которой нужно перейти: её первая страница и прямоугольник встают в центр. */
  focus?: string | null;
  /** Размеры страниц от сервера (EditorContent.pages): разметка готова до отрисовки. */
  pageSizes?: readonly PageSize[];
  onError?: (error: unknown) => void;
  onHighlightClick?: (id: string) => void;
  className?: string;
  /** Подмена pdf.js в тестах. */
  engine?: PdfEngine;
}

interface PageHighlight {
  id: string;
  rect: PageRect;
  className?: string;
}

const DEFAULT_AREA_WIDTH = 768;
const NO_HIGHLIGHTS: readonly PageHighlight[] = [];

/**
 * Просмотр PDF: страница рисуется на canvas средствами pdf.js, поверх лежит слой
 * прямоугольников подсветки. Рисуются только страницы рядом с областью просмотра,
 * остальные остаются заглушками своего размера, поэтому память не растёт с длиной файла.
 */
export function PdfView({
  data,
  highlights,
  focus = null,
  pageSizes,
  onError,
  onHighlightClick,
  className,
  engine = pdfjsEngine,
}: PdfViewProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [firstSize, setFirstSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [areaWidth, setAreaWidth] = useState(DEFAULT_AREA_WIDTH);
  const visible = useVisiblePages(areaRef, doc?.numPages ?? 0);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setFailed(false);
    const loading = engine.open(data);
    loading.promise
      .then(async (opened) => {
        const first = await opened.getPage(1);
        const viewport = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setFirstSize({ width: viewport.width, height: viewport.height });
        setDoc(opened);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFailed(true);
        errorRef.current?.(error);
      });
    return () => {
      cancelled = true;
      void loading.destroy();
    };
  }, [data, engine]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAreaWidth(entry.contentRect.width || DEFAULT_AREA_WIDTH);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const sizes = useMemo(() => {
    if (!doc || !firstSize) return [];
    const known = new Map(pageSizes?.map((size) => [size.number, size]));
    return Array.from({ length: doc.numPages }, (_, i) => known.get(i + 1) ?? firstSize);
  }, [doc, firstSize, pageSizes]);
  const scale = fitScale(sizes[0]?.width ?? 0, areaWidth);

  // Подсветки раскладываются по страницам один раз: O(R), странице достаётся только своё.
  const byPage = useMemo(() => {
    const map = new Map<number, PageHighlight[]>();
    for (const highlight of highlights) {
      for (const rect of highlight.rects) {
        const list = map.get(rect.page) ?? [];
        list.push({ id: highlight.id, rect, className: highlight.className });
        map.set(rect.page, list);
      }
    }
    return map;
  }, [highlights]);

  // Выделение нужно на всех страницах подсветки, а в центр встаёт только первая из них.
  const { focusPage, focusPages } = useMemo(() => {
    const target = focus ? highlights.find((highlight) => highlight.id === focus) : undefined;
    return {
      focusPage: target?.rects[0]?.page ?? null,
      focusPages: new Set(target?.rects.map((rect) => rect.page)),
    };
  }, [focus, highlights]);

  useEffect(() => {
    if (focusPage === null || !doc) return;
    // Страница сначала попадает в видимую область и отрисовывается, затем она сама
    // ставит прямоугольник в центр.
    areaRef.current
      ?.querySelector<HTMLElement>(`[data-page-number="${focusPage}"]`)
      ?.scrollIntoView?.({ block: 'center' });
  }, [focusPage, focus, doc]);

  return (
    <div
      ref={areaRef}
      className={cn('pdf-view h-full overflow-auto bg-muted/40 p-4', className)}
      data-testid="pdf-view"
    >
      {failed ? (
        <p className="text-sm text-muted-foreground">Не удалось открыть PDF.</p>
      ) : !doc ? (
        <div
          className="mx-auto h-[60vh] max-w-3xl animate-pulse rounded-md bg-muted"
          aria-busy="true"
          aria-label="Загрузка PDF"
        />
      ) : (
        sizes.map((size, i) => (
          <PdfPageView
            key={i + 1}
            doc={doc}
            engine={engine}
            number={i + 1}
            width={size.width * scale}
            height={size.height * scale}
            scale={scale}
            visible={visible.has(i + 1)}
            highlights={byPage.get(i + 1) ?? NO_HIGHLIGHTS}
            focus={focusPages.has(i + 1) ? focus : null}
            centre={focusPage === i + 1}
            onHighlightClick={onHighlightClick}
          />
        ))
      )}
    </div>
  );
}

/**
 * Номера страниц рядом с областью просмотра. Один IntersectionObserver на весь документ;
 * без него (старые браузеры) видимыми считаются все страницы.
 */
function useVisiblePages(
  areaRef: RefObject<HTMLDivElement>,
  pageCount: number,
): ReadonlySet<number> {
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    const area = areaRef.current;
    if (!area || pageCount === 0) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.pageNumber);
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        });
      },
      // Соседние страницы рисуются заранее, чтобы при прокрутке не было пустых листов.
      { root: area, rootMargin: '100% 0px' },
    );
    for (const page of Array.from(area.querySelectorAll('[data-page-number]'))) {
      observer.observe(page);
    }
    return () => observer.disconnect();
  }, [areaRef, pageCount]);
  return visible;
}

interface PdfPageViewProps {
  doc: PdfDocument;
  engine: PdfEngine;
  number: number;
  width: number;
  height: number;
  scale: number;
  visible: boolean;
  highlights: readonly PageHighlight[];
  /** Подсветка в фокусе, если у неё есть прямоугольники на этой странице. */
  focus: string | null;
  /** Страница первой части фокуса: она ставит свой прямоугольник в центр. */
  centre: boolean;
  onHighlightClick?: (id: string) => void;
}

const PdfPageView = memo(function PdfPageView({
  doc,
  engine,
  number,
  width,
  height,
  scale,
  visible,
  highlights,
  focus,
  centre,
  onHighlightClick,
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<PdfViewport | null>(null);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    let page: PdfPage | null = null;
    const tasks: PdfTask[] = [];
    const canvas = canvasRef.current;
    const text = textRef.current;
    void doc.getPage(number).then((loaded) => {
      if (cancelled || !canvas) return;
      page = loaded;
      const current = loaded.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(current.width * ratio);
      canvas.height = Math.floor(current.height * ratio);
      setViewport(current);
      const render = loaded.render({
        canvas,
        viewport: current,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      tasks.push(render);
      // Отмена отрисовки при уходе страницы из вида отклоняет promise, это ожидаемо.
      render.promise.catch(() => undefined);
      if (engine.textLayer && text) {
        text.replaceChildren();
        const layer = engine.textLayer(loaded, text, current);
        tasks.push(layer);
        layer.promise.catch(() => undefined);
      }
    });
    return () => {
      cancelled = true;
      for (const task of tasks) task.cancel();
      // Пиксели невидимой страницы освобождаются сразу, остаётся заглушка своего размера.
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      text?.replaceChildren();
      page?.cleanup();
      setViewport(null);
    };
  }, [doc, engine, number, scale, visible]);

  const boxes = useMemo(
    () =>
      viewport
        ? highlights.map((item) => ({ ...item, box: toViewportRect(viewport, item.rect) }))
        : [],
    [highlights, viewport],
  );

  useEffect(() => {
    if (!focus || !centre || !viewport) return;
    overlayRef.current
      ?.querySelector<HTMLElement>(`[data-highlight-id="${CSS.escape(focus)}"]`)
      ?.scrollIntoView?.({ block: 'center', inline: 'center' });
  }, [focus, centre, viewport]);

  const click = useCallback(
    (id: string) => (onHighlightClick ? () => onHighlightClick(id) : undefined),
    [onHighlightClick],
  );

  return (
    <div
      data-page-number={number}
      className="pdf-page relative mx-auto mb-4 bg-white shadow-sm"
      style={
        {
          // Размер заглушки уточняется по самой странице, когда она загружена.
          width: viewport?.width ?? width,
          height: viewport?.height ?? height,
          '--total-scale-factor': scale,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
        } as CSSProperties
      }
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      <div ref={textRef} className="textLayer" />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0 z-[2]">
        {boxes.map(({ id, box, className }, i) => (
          <HighlightBox
            key={`${id}:${i}`}
            id={id}
            box={box}
            className={className}
            focused={id === focus}
            onClick={click(id)}
          />
        ))}
      </div>
    </div>
  );
});

interface HighlightBoxProps {
  id: string;
  box: CssRect;
  className?: string;
  focused: boolean;
  onClick?: () => void;
}

function HighlightBox({ id, box, className, focused, onClick }: HighlightBoxProps) {
  return (
    <div
      data-highlight-id={id}
      data-focused={focused ? 'true' : undefined}
      className={cn(
        'absolute rounded-sm mix-blend-multiply',
        onClick && 'pointer-events-auto cursor-pointer',
        focused && 'ring-2 ring-primary',
        className ?? 'bg-amber-200/60',
      )}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onClick={onClick}
    />
  );
}
