import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PDF_RENDER_FAILED } from '@/features/editor/components/PdfDocumentView';
import type { PdfEngine, PdfPage } from '@/lib/pdf/engine';
import { DocumentPage } from '@/pages/DocumentPage';
import {
  addDocument,
  addFlag,
  addProject,
  addSuggestion,
  backendHandlers,
  createDb,
  type Db,
} from '@/test/msw/backend';
import { server } from '@/test/msw/server';
import { renderWithApp } from '@/test/render';

/** pdf.js в jsdom не работает: документ из двух страниц 600 на 800 точек без поворота. */
const engine = vi.hoisted(() => ({ current: null as PdfEngine | null }));
vi.mock('@/lib/pdf/pdfjs', () => ({
  pdfjsEngine: {
    open: (data: ArrayBuffer) => {
      if (!engine.current) throw new Error('движок не задан');
      return engine.current.open(data);
    },
  },
}));

function fakeEngine(failure?: Error): PdfEngine {
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
  return {
    open: () => ({
      promise: failure
        ? Promise.reject(failure)
        : Promise.resolve({ numPages: 2, getPage: () => Promise.resolve(page) }),
      destroy: vi.fn(),
    }),
  };
}

const TEXT = 'Срок ответа 10 дней.\n\nОплата картой.\n\nКонтакты поддержки.\n';

let db: Db;
let fileStatus = 200;

beforeEach(() => {
  db = createDb();
  fileStatus = 200;
  engine.current = fakeEngine();
  server.use(
    ...backendHandlers(db),
    http.get('/api/v1/projects/:projectId/documents/:documentId/file', () =>
      fileStatus === 200
        ? new HttpResponse(new Blob(['%PDF-1.7']), {
            headers: { 'Content-Type': 'application/pdf' },
          })
        : HttpResponse.json({ detail: 'Нет файла' }, { status: fileStatus }),
    ),
  );
});

function setup() {
  const project = addProject(db);
  const doc = addDocument(db, project.id, {
    name: 'Регламент.pdf',
    format: 'pdf',
    status: 'awaiting_approval',
    currentJobId: 'job-1',
    text: TEXT,
    pages: [
      { number: 1, width: 600, height: 800 },
      { number: 2, width: 600, height: 800 },
    ],
  });
  const modify = addSuggestion(db, doc, {
    change_type: 'modify',
    original_text: '10 дней',
    suggested_text: '14 дней',
    rationale: 'В регламенте указано 14 дней.',
    geometry: { rects: [[1, 100, 700, 160, 712]] },
  });
  const accepted = addSuggestion(db, doc, {
    change_type: 'delete',
    original_text: 'Оплата картой.',
    status: 'accepted',
    position: 1,
    geometry: { rects: [[1, 72, 650, 180, 662]] },
  });
  const unplaced = addSuggestion(db, doc, {
    change_type: 'add',
    original_text: 'Контакты поддержки.',
    suggested_text: 'Телефон поддержки.',
    position: 2,
  });
  const flag = addFlag(db, doc, {
    block_id: 'b3',
    original_text: 'Контакты поддержки.',
    rationale: 'Источники расходятся.',
    geometry: { rects: [[2, 72, 400, 300, 412]] },
  });
  return { project, doc, modify, accepted, unplaced, flag };
}

function open(projectId: string, documentId: string) {
  return renderWithApp({
    routes: [{ path: '/projects/:projectId/documents/:documentId', element: <DocumentPage /> }],
    initialEntries: [`/projects/${projectId}/documents/${documentId}`],
  });
}

const view = () => screen.findByTestId('pdf-document');
const mark = (id: string) =>
  document.querySelector<HTMLElement>(`[data-highlight-id="${CSS.escape(id)}"]`);

describe('PDF-документ в редакторе', () => {
  it('в «Правках» показывает страницы с отметками правок и флагов', async () => {
    const { project, doc, modify, accepted, unplaced, flag } = setup();
    open(project.id, doc.id);
    await view();
    await waitFor(() => expect(mark(`s:${modify.id}`)).not.toBeNull());
    expect(mark(`s:${accepted.id}`)).not.toBeNull();
    expect(mark(`f:${flag.id}`)).not.toBeNull();
    // Без прямоугольников правка остаётся только в панели.
    expect(mark(`s:${unplaced.id}`)).toBeNull();
    expect(screen.queryByTestId('document-text')).not.toBeInTheDocument();
    // Размер страниц берётся из EditorContent.pages, отметка встаёт по координатам сервера.
    const box = mark(`s:${modify.id}`);
    expect(box?.style.width).not.toBe('');
  });

  it('щелчок по отметке открывает карточку правки в панели', async () => {
    const user = userEvent.setup();
    const { project, doc, modify } = setup();
    open(project.id, doc.id);
    await view();
    await waitFor(() => expect(mark(`s:${modify.id}`)).not.toBeNull());
    await user.click(mark(`s:${modify.id}`) as HTMLElement);
    const card = await screen.findByRole('region', { name: 'Карточка предложения' });
    expect(within(card).getByText('В регламенте указано 14 дней.')).toBeInTheDocument();
    expect(mark(`s:${modify.id}`)).toHaveAttribute('data-focused', 'true');
  });

  it('выбор правки в панели выделяет её отметку, решение принимается в карточке', async () => {
    const user = userEvent.setup();
    const { project, doc, modify } = setup();
    open(project.id, doc.id);
    await view();
    const list = screen.getByRole('list', { name: 'Список предложений' });
    await user.click(within(list).getByText('14 дней'));
    await waitFor(() => expect(mark(`s:${modify.id}`)).toHaveAttribute('data-focused', 'true'));
    const card = screen.getByRole('region', { name: 'Карточка предложения' });
    await user.click(within(card).getByRole('button', { name: /Принять/ }));
    await waitFor(() => expect(mark(`s:${modify.id}`)?.className).toContain('bg-emerald'));
  });

  it('щелчок по отметке флага выбирает его карточку', async () => {
    const user = userEvent.setup();
    const { project, doc, flag } = setup();
    open(project.id, doc.id);
    await view();
    await waitFor(() => expect(mark(`f:${flag.id}`)).not.toBeNull());
    await user.click(mark(`f:${flag.id}`) as HTMLElement);
    await waitFor(() =>
      expect(
        document.querySelector(`[data-flag-card-id="${flag.id}"] button[aria-pressed]`),
      ).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(mark(`f:${flag.id}`)).toHaveAttribute('data-focused', 'true');
  });

  it('«Чистовик» оставляет только принятые правки, «Оригинал» без отметок', async () => {
    const user = userEvent.setup();
    const { project, doc, modify, accepted, flag } = setup();
    open(project.id, doc.id);
    await view();
    await waitFor(() => expect(mark(`s:${modify.id}`)).not.toBeNull());

    await user.click(screen.getByRole('radio', { name: 'Чистовик' }));
    await waitFor(() => expect(mark(`s:${modify.id}`)).toBeNull());
    expect(mark(`s:${accepted.id}`)).not.toBeNull();
    expect(mark(`f:${flag.id}`)).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Оригинал' }));
    await waitFor(() => expect(mark(`s:${accepted.id}`)).toBeNull());
    expect(await view()).toBeInTheDocument();
  });

  it('если pdf.js не открыл файл, показывает текст с предупреждением', async () => {
    engine.current = fakeEngine(new Error('Invalid PDF'));
    const { project, doc } = setup();
    open(project.id, doc.id);
    expect(await screen.findByText(PDF_RENDER_FAILED)).toBeInTheDocument();
    expect(await screen.findByTestId('document-text')).toHaveTextContent('Оплата картой.');
  });

  it('если файл не скачался, показывает текст с предупреждением', async () => {
    fileStatus = 404;
    const { project, doc } = setup();
    open(project.id, doc.id);
    // useDocumentFile повторяет запрос один раз, поэтому ожидание дольше обычного.
    expect(await screen.findByText(PDF_RENDER_FAILED, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByTestId('document-text')).toBeInTheDocument();
  });
});
