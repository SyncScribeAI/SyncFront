import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Evidence } from '@/domain/source/evidence';
import type { PdfEngine, PdfPage } from '@/lib/pdf/engine';

import { SourceViewer, type PreviewableSource } from './SourceViewer';

const api = vi.hoisted(() => ({
  getSnapshotContent: vi.fn(),
  getSourceFile: vi.fn(),
}));
vi.mock('@/api/resources/sourceSnapshots', () => ({ getSnapshotContent: api.getSnapshotContent }));
vi.mock('@/api/resources/sourceFiles', () => ({ getSourceFile: api.getSourceFile }));

const SNAPSHOT = 'Пароль меняется каждые 90 дней.\n\nДоступ по второму фактору.';

function at(needle: string, patch: Partial<Evidence> = {}): Evidence {
  const start = SNAPSHOT.indexOf(needle);
  return {
    source_id: 's1',
    source_name: 'x',
    snapshot_id: 'n1',
    quote: needle,
    match: 'exact',
    start_offset: start,
    end_offset: start + needle.length,
    original_file_available: false,
    ...patch,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function open(
  source: PreviewableSource,
  evidence: Evidence[],
  renderDocx?: (blob: Blob, host: HTMLElement) => Promise<void>,
) {
  return render(
    <SourceViewer
      projectId="p1"
      source={source}
      evidence={evidence}
      open
      onOpenChange={vi.fn()}
      renderDocx={renderDocx}
    />,
    { wrapper },
  );
}

const body = () => screen.getByTestId('source-viewer-body');
const highlighted = () => body().querySelector('[data-evidence="first"]')?.textContent;

beforeEach(() => {
  api.getSnapshotContent.mockReset().mockResolvedValue({
    id: 'n1',
    text: SNAPSHOT,
    chars: SNAPSHOT.length,
    taken_at: '2026-11-01T10:00:00Z',
  });
  api.getSourceFile.mockReset();
});

describe('SourceViewer с основаниями', () => {
  const note: PreviewableSource = { id: 's1', name: 'Заметка', type: 'file' };

  it('показывает текст снимка и подсвечивает цитату', async () => {
    open(note, [at('каждые 90 дней')]);
    await waitFor(() => expect(highlighted()).toBe('каждые 90 дней'));
    expect(screen.getByText(/Текст на момент анализа, снимок от/)).toBeInTheDocument();
    expect(screen.getByText('Точное совпадение')).toBeInTheDocument();
    expect(api.getSnapshotContent).toHaveBeenCalledWith('p1', 'n1');
  });

  it('листает основания по кругу', async () => {
    const user = userEvent.setup();
    open(note, [at('Пароль'), at('второму фактору', { match: 'approximate' })]);
    await waitFor(() => expect(highlighted()).toBe('Пароль'));
    expect(screen.getByText('Основание 1 из 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Следующее основание' }));
    expect(highlighted()).toBe('второму фактору');
    expect(screen.getByText('Подсвечен абзац целиком')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Следующее основание' }));
    expect(highlighted()).toBe('Пароль');
    await user.click(screen.getByRole('button', { name: 'Предыдущее основание' }));
    expect(screen.getByText('Основание 2 из 2')).toBeInTheDocument();
  });

  it('ненайденная цитата показывается отдельно без подсветки', async () => {
    open(note, [at('x', { match: 'not_found', quote: 'Срок хранения 5 лет', start_offset: null })]);
    expect(screen.getByText('Цитата в источнике не найдена')).toBeInTheDocument();
    expect(screen.getByText('Срок хранения 5 лет').tagName).toBe('BLOCKQUOTE');
    await waitFor(() => expect(within(body()).getByText(/Доступ по второму/)).toBeInTheDocument());
    expect(highlighted()).toBeUndefined();
  });

  it('у ссылки есть кнопка «Открыть оригинал»', async () => {
    open({ id: 's1', name: 'Регламент', type: 'url', url: 'https://example.com/p' }, [
      at('Пароль'),
    ]);
    expect(screen.getByRole('link', { name: 'Открыть оригинал' })).toHaveAttribute(
      'href',
      'https://example.com/p',
    );
    await waitFor(() => expect(highlighted()).toBe('Пароль'));
  });

  it('прокручивает подсветку в центр', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      open(note, [at('второму фактору')]);
      await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'center' }));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  const docx: PreviewableSource = { id: 's1', name: 'Регламент.docx', type: 'file' };
  const inDocx = (needle: string, paragraph: number) =>
    at(needle, {
      original_file_available: true,
      locator: { kind: 'docx_paragraphs', first: paragraph, last: paragraph },
    });

  it('DOCX показывается оригиналом с подсветкой внутри абзаца', async () => {
    api.getSourceFile.mockResolvedValue({ blob: new Blob(['docx']), filename: 'Регламент.docx' });
    const renderDocx = vi.fn((_blob: Blob, host: HTMLElement) => {
      host.innerHTML =
        '<p>Пароль меняется <b>каждые</b> 90 дней.</p><p>Доступ по второму фактору.</p>';
      return Promise.resolve();
    });
    open(docx, [inDocx('каждые 90', 0)], renderDocx);
    await waitFor(() =>
      expect(screen.getByTestId('source-docx').querySelector('[data-evidence]')?.textContent).toBe(
        'каждые 90',
      ),
    );
    expect(screen.getByText(/Оригинал файла/)).toBeInTheDocument();
    expect(api.getSourceFile).toHaveBeenCalledWith('p1', 's1', 'Регламент.docx');
  });

  it('если абзац в DOCX не совпал, показывает текст снимка с пояснением', async () => {
    api.getSourceFile.mockResolvedValue({ blob: new Blob(['docx']), filename: 'Регламент.docx' });
    const renderDocx = vi.fn((_blob: Blob, host: HTMLElement) => {
      host.innerHTML = '<p>Совсем другой текст</p>';
      return Promise.resolve();
    });
    open(docx, [inDocx('Пароль', 0)], renderDocx);
    await waitFor(() =>
      expect(
        screen.getByText('Абзац в оригинале не найден, показан текст на момент анализа.'),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(highlighted()).toBe('Пароль'));
    expect(screen.queryByTestId('source-docx')).not.toBeInTheDocument();
  });

  it('ошибка рендера DOCX тоже ведёт к тексту снимка', async () => {
    api.getSourceFile.mockResolvedValue({ blob: new Blob(['docx']), filename: 'Регламент.docx' });
    open(docx, [inDocx('Пароль', 0)], () => Promise.reject(new Error('bad zip')));
    await waitFor(() => expect(highlighted()).toBe('Пароль'));
  });
});

/** pdf.js в jsdom не работает: документ из двух страниц 600 на 800 точек без поворота. */
function pdfEngine(failure?: Error): PdfEngine & { opened: ReturnType<typeof vi.fn> } {
  const page: PdfPage = {
    getViewport: ({ scale }) => ({
      width: 600 * scale,
      height: 800 * scale,
      rotation: 0,
      convertToViewportRectangle: ([x0 = 0, y0 = 0, x1 = 0, y1 = 0]) => [
        x0 * scale,
        (800 - y0) * scale,
        x1 * scale,
        (800 - y1) * scale,
      ],
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    cleanup: vi.fn(),
  };
  const opened = vi.fn();
  return {
    opened,
    open: (data) => {
      opened(data);
      return {
        promise: failure
          ? Promise.reject(failure)
          : Promise.resolve({ numPages: 2, getPage: () => Promise.resolve(page) }),
        destroy: vi.fn(),
      };
    },
  };
}

describe('SourceViewer с основаниями в PDF', () => {
  const pdf: PreviewableSource = { id: 's1', name: 'Регламент.pdf', type: 'file' };
  const inPdf = (needle: string, rects: number[][], patch: Partial<Evidence> = {}) =>
    at(needle, { original_file_available: true, locator: { kind: 'pdf_rects', rects }, ...patch });
  const first = inPdf('каждые 90 дней', [[1, 100, 700, 300, 712]]);
  const second = inPdf('второму фактору', [
    [2, 50, 400, 200, 412],
    [2, 50, 386, 120, 398],
  ]);

  function openPdf(evidence: Evidence[], engine = pdfEngine()) {
    render(
      <SourceViewer
        projectId="p1"
        source={pdf}
        evidence={evidence}
        open
        onOpenChange={vi.fn()}
        pdfEngine={engine}
      />,
      { wrapper },
    );
    return engine;
  }

  const boxes = (id: string) => [
    ...screen
      .getByTestId('source-pdf')
      .querySelectorAll<HTMLElement>(`[data-highlight-id="${id}"]`),
  ];

  beforeEach(() => {
    api.getSourceFile.mockResolvedValue({
      blob: new Blob(['%PDF-1.7']),
      filename: 'Регламент.pdf',
    });
  });

  it('показывает оригинал PDF и ставит прямоугольники всех оснований, текущее в фокусе', async () => {
    const engine = openPdf([first, second]);
    await waitFor(() => expect(boxes('0')).toHaveLength(1));
    expect(boxes('1')).toHaveLength(2);
    expect(boxes('0')[0]).toHaveAttribute('data-focused', 'true');
    expect(boxes('1')[0]).not.toHaveAttribute('data-focused');
    expect(screen.getByText('Оригинал файла', { exact: false })).toBeInTheDocument();
    expect(api.getSourceFile).toHaveBeenCalledWith('p1', 's1', 'Регламент.pdf');
    expect(engine.opened).toHaveBeenCalledTimes(1);
  });

  it('переход к следующему основанию переносит фокус, не открывая файл заново', async () => {
    const user = userEvent.setup();
    const engine = openPdf([first, second]);
    await waitFor(() => expect(boxes('0')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Следующее основание' }));
    await waitFor(() => expect(boxes('1')[0]).toHaveAttribute('data-focused', 'true'));
    expect(boxes('0')[0]).not.toHaveAttribute('data-focused');
    expect(engine.opened).toHaveBeenCalledTimes(1);
  });

  it('щелчок по прямоугольнику выбирает его основание', async () => {
    const user = userEvent.setup();
    openPdf([first, second]);
    await waitFor(() => expect(boxes('1')).toHaveLength(2));
    const target = boxes('1')[1];
    if (!target) throw new Error('нет прямоугольника');
    await user.click(target);
    expect(screen.getByText('Основание 2 из 2')).toBeInTheDocument();
  });

  it('если pdf.js не открыл файл, показывает текст снимка с пояснением', async () => {
    openPdf([first], pdfEngine(new Error('Invalid PDF')));
    await waitFor(() => expect(highlighted()).toBe('каждые 90 дней'));
    expect(
      screen.getByText('Файл не открылся, показан текст на момент анализа.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('source-pdf')).not.toBeInTheDocument();
  });

  it('если файл не скачался, показывает текст снимка', async () => {
    api.getSourceFile.mockRejectedValue(new Error('404'));
    openPdf([first]);
    await waitFor(() => expect(highlighted()).toBe('каждые 90 дней'));
  });

  it('без прямоугольников или с другим файлом подсветка идёт по тексту снимка', async () => {
    openPdf([
      inPdf('каждые 90 дней', [[1, 100, 700, 300, 712]], { original_file_available: false }),
    ]);
    await waitFor(() => expect(highlighted()).toBe('каждые 90 дней'));
    expect(screen.queryByTestId('source-pdf')).not.toBeInTheDocument();
    expect(api.getSourceFile).not.toHaveBeenCalled();
  });

  it('ненайденная цитата из PDF показывается отдельно, файл не открывается', async () => {
    openPdf([
      inPdf('нет такого', [[1, 1, 1, 2, 2]], {
        match: 'not_found',
        start_offset: null,
        end_offset: null,
      }),
    ]);
    await waitFor(() =>
      expect(screen.getByText('Цитата в источнике не найдена')).toBeInTheDocument(),
    );
    expect(screen.getByText('нет такого')).toBeInTheDocument();
    expect(api.getSourceFile).not.toHaveBeenCalled();
  });
});
