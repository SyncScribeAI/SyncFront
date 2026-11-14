import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PdfDocument, PdfEngine, PdfPage, PdfViewport } from './engine';
import { PdfView, type PdfHighlight } from './PdfView';

/** Страница 600 на 800 точек без поворота: перевод как у pdf.js при CropBox от нуля. */
function viewport(scale: number): PdfViewport {
  return {
    width: 600 * scale,
    height: 800 * scale,
    rotation: 0,
    convertToViewportRectangle: ([x0 = 0, y0 = 0, x1 = 0, y1 = 0]) => [
      x0 * scale,
      (800 - y0) * scale,
      x1 * scale,
      (800 - y1) * scale,
    ],
  };
}

interface FakeEngine extends PdfEngine {
  pagesRequested: number[];
  renderTasks: Map<number, { promise: Promise<void>; cancel: ReturnType<typeof vi.fn> }>;
  cleanups: number[];
  destroy: ReturnType<typeof vi.fn>;
}

function fakeEngine(numPages: number, failure?: Error): FakeEngine {
  const engine: FakeEngine = {
    pagesRequested: [],
    renderTasks: new Map(),
    cleanups: [],
    destroy: vi.fn(),
    open: () => ({
      promise: failure ? Promise.reject(failure) : Promise.resolve(doc),
      destroy: engine.destroy,
    }),
  };
  const page = (number: number): PdfPage => ({
    getViewport: ({ scale }) => viewport(scale),
    render: () => {
      const task = { promise: new Promise<void>(() => undefined), cancel: vi.fn() };
      engine.renderTasks.set(number, task);
      return task;
    },
    cleanup: () => engine.cleanups.push(number),
  });
  const doc: PdfDocument = {
    numPages,
    getPage: (number) => {
      engine.pagesRequested.push(number);
      return Promise.resolve(page(number));
    },
  };
  return engine;
}

/** IntersectionObserver, видимостью которого управляет тест. */
class FakeObserver {
  static current: FakeObserver | null = null;
  readonly targets: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.current = this;
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  disconnect() {}
  show(pages: number[], visible = true) {
    const entries = this.targets
      .filter((target) => pages.includes(Number((target as HTMLElement).dataset.pageNumber)))
      .map((target) => ({ target, isIntersecting: visible }) as IntersectionObserverEntry);
    act(() => this.callback(entries, this as unknown as IntersectionObserver));
  }
}

const data = new ArrayBuffer(8);
const highlight: PdfHighlight = {
  id: 'g1',
  rects: [
    { page: 2, x0: 100, y0: 700, x1: 300, y1: 712 },
    { page: 3, x0: 50, y0: 100, x1: 80, y1: 110 },
  ],
  className: 'bg-suggestion',
};

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  FakeObserver.current = null;
});

const pages = () => [...document.querySelectorAll<HTMLElement>('[data-page-number]')];

/** Разметка появляется раньше, чем пассивный эффект подписывает страницы на наблюдатель. */
async function pagesObserved(count: number) {
  await waitFor(() => {
    expect(pages()).toHaveLength(count);
    expect(FakeObserver.current?.targets).toHaveLength(count);
  });
}

describe('PdfView', () => {
  it('размечает все страницы, а рисует только видимые', async () => {
    const engine = fakeEngine(5);
    render(<PdfView data={data} highlights={[]} engine={engine} />);
    await pagesObserved(5);
    // Первая страница запрашивается ради размера разметки, отрисовки нет.
    expect(engine.pagesRequested).toEqual([1]);
    expect(engine.renderTasks.size).toBe(0);

    FakeObserver.current?.show([2, 3]);
    await waitFor(() => expect([...engine.renderTasks.keys()].sort()).toEqual([2, 3]));
    expect(engine.pagesRequested).not.toContain(5);
  });

  it('уход страницы из вида отменяет отрисовку и освобождает страницу', async () => {
    const engine = fakeEngine(3);
    render(<PdfView data={data} highlights={[]} engine={engine} />);
    await pagesObserved(3);
    FakeObserver.current?.show([2]);
    await waitFor(() => expect(engine.renderTasks.has(2)).toBe(true));

    FakeObserver.current?.show([2], false);
    expect(engine.renderTasks.get(2)?.cancel).toHaveBeenCalled();
    expect(engine.cleanups).toContain(2);
    const canvas = pages()[1]?.querySelector('canvas');
    expect(canvas?.width).toBe(0);
  });

  it('кладёт прямоугольники подсветки в координаты страницы', async () => {
    const engine = fakeEngine(3);
    render(<PdfView data={data} highlights={[highlight]} engine={engine} />);
    await pagesObserved(3);
    FakeObserver.current?.show([2]);

    const box = await waitFor(() => {
      const found = pages()[1]?.querySelector<HTMLElement>('[data-highlight-id="g1"]');
      expect(found).toBeTruthy();
      return found!;
    });
    // Масштаб по ширине области 800 px за вычетом отступов: (800 - 32) / 600 = 1.28.
    expect(box.style.left).toBe(`${100 * 1.28}px`);
    expect(parseFloat(box.style.top)).toBeCloseTo(88 * 1.28);
    expect(parseFloat(box.style.width)).toBeCloseTo(200 * 1.28);
    expect(box).toHaveClass('bg-suggestion');
    // Прямоугольник третьей страницы появляется только с её отрисовкой.
    expect(pages()[2]?.querySelector('[data-highlight-id]')).toBeNull();
  });

  it('переход к подсветке ставит её страницу и прямоугольник в центр', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      const engine = fakeEngine(4);
      render(<PdfView data={data} highlights={[highlight]} focus="g1" engine={engine} />);
      await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'center' }));
      expect(scroll.mock.contexts[0]).toBe(pages()[1]);

      FakeObserver.current?.show([2]);
      await waitFor(() =>
        expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'center' }),
      );
      const rect = pages()[1]?.querySelector('[data-highlight-id="g1"]');
      expect(scroll.mock.contexts.at(-1)).toBe(rect);
      expect(rect).toHaveAttribute('data-focused', 'true');

      // Продолжение на третьей странице выделено, но прокрутку не перехватывает.
      const centred = scroll.mock.calls.length;
      FakeObserver.current?.show([3]);
      await waitFor(() =>
        expect(pages()[2]?.querySelector('[data-highlight-id="g1"]')).toHaveAttribute(
          'data-focused',
          'true',
        ),
      );
      expect(scroll).toHaveBeenCalledTimes(centred);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it('клик по подсветке сообщает её id', async () => {
    const onClick = vi.fn();
    const engine = fakeEngine(2);
    render(
      <PdfView data={data} highlights={[highlight]} engine={engine} onHighlightClick={onClick} />,
    );
    await pagesObserved(2);
    FakeObserver.current?.show([2]);
    const rect = await screen.findByTestId('pdf-view').then(() =>
      waitFor(() => {
        const found = pages()[1]?.querySelector<HTMLElement>('[data-highlight-id="g1"]');
        expect(found).toBeTruthy();
        return found!;
      }),
    );
    fireEvent.click(rect);
    expect(onClick).toHaveBeenCalledWith('g1');
  });

  it('размеры страниц от сервера заменяют размер первой страницы', async () => {
    const engine = fakeEngine(2);
    render(
      <PdfView
        data={data}
        highlights={[]}
        engine={engine}
        pageSizes={[{ number: 2, width: 800, height: 600 }]}
      />,
    );
    await pagesObserved(2);
    expect(parseFloat(pages()[0]!.style.height)).toBeCloseTo(800 * 1.28);
    expect(parseFloat(pages()[1]!.style.height)).toBeCloseTo(600 * 1.28);
  });

  it('ошибка открытия показывает сообщение и вызывает onError', async () => {
    const onError = vi.fn();
    const error = new Error('Invalid PDF');
    render(<PdfView data={data} highlights={[]} engine={fakeEngine(1, error)} onError={onError} />);
    expect(await screen.findByText('Не удалось открыть PDF.')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('размонтирование закрывает документ', async () => {
    const engine = fakeEngine(1);
    const { unmount } = render(<PdfView data={data} highlights={[]} engine={engine} />);
    await pagesObserved(1);
    unmount();
    expect(engine.destroy).toHaveBeenCalled();
  });
});
