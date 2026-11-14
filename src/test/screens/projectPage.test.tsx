import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { REANALYSIS_TITLE } from '@/features/analysis';
import {
  addDocument,
  addJob,
  addProject,
  addSource,
  backendHandlers,
  createDb,
  type Db,
} from '@/test/msw/backend';
import { server } from '@/test/msw/server';
import { renderWithApp } from '@/test/render';

import { screenRoutes } from './routes';

let db: Db;

beforeEach(() => {
  db = createDb();
  server.use(...backendHandlers(db));
});

function setup() {
  const project = addProject(db, { name: 'Платёжный шлюз' });
  addSource(db, project.id, { name: 'Спецификация API' });
  const draft = addDocument(db, project.id, { name: 'draft.md', status: 'draft' });
  const review = addDocument(db, project.id, { name: 'review.md', status: 'awaiting_approval' });
  const ready = addDocument(db, project.id, { name: 'ready.md', status: 'ready' });
  addSource(db, project.id, { name: 'Тикет PAY-12', scope: 'document', documentId: review.id });
  const view = renderWithApp({ routes: screenRoutes, initialEntries: [`/projects/${project.id}`] });
  return { project, draft, review, ready, ...view };
}

describe('Страница проекта', () => {
  it('показывает цепочку, базовые источники и кнопку запуска у каждого документа не в работе', async () => {
    setup();
    expect(
      await screen.findByRole('heading', { name: 'Платёжный шлюз', level: 1 }),
    ).toBeInTheDocument();
    const breadcrumbs = screen.getByRole('navigation', { name: 'Навигационная цепочка' });
    expect(within(breadcrumbs).getByRole('link', { name: 'Проекты' })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(screen.getByText(/3 документа/)).toBeInTheDocument();
    expect(screen.getByText('Спецификация API')).toBeInTheDocument();
    // ▶ есть у черновика и у документа на ревью; у готового — повторная проверка.
    expect(screen.getByRole('button', { name: 'Анализировать: draft.md' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Анализировать: review.md' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Проверить актуальность: ready.md' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Рассмотреть правки' })).not.toBeInTheDocument();
  });

  it('раскрывает только одну строку источников; на ревью источники можно менять', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('heading', { level: 1 });
    const toggles = screen.getAllByRole('button', { name: /Специфичные источники/ });
    const [draftToggle, reviewToggle] = toggles;
    if (!draftToggle || !reviewToggle) throw new Error('нет кнопок источников');

    await user.click(draftToggle);
    expect(draftToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Добавить файл' })).toBeInTheDocument();

    await user.click(reviewToggle);
    expect(draftToggle).toHaveAttribute('aria-expanded', 'false');
    expect(reviewToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Тикет PAY-12')).toBeInTheDocument();
    // Источники заблокированы только во время анализа: на ревью их можно добавлять и удалять.
    expect(screen.getByRole('button', { name: 'Добавить файл' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Удалить источник Тикет PAY-12' }),
    ).toBeInTheDocument();
  });

  it('423 при добавлении базового источника показывает текст сервера, список не меняется', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/sources', () =>
        HttpResponse.json(
          { detail: 'Источники заблокированы: идёт анализ документов проекта' },
          { status: 423 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { project } = setup();
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await user.click(screen.getByRole('tab', { name: 'Ссылка' }));
    await user.type(screen.getByLabelText('Адрес ссылки'), 'https://wiki.example.com/pay');
    await user.click(screen.getByRole('button', { name: 'Добавить ссылку' }));

    expect(
      await screen.findByText('Источники заблокированы: идёт анализ документов проекта'),
    ).toBeInTheDocument();
    expect(screen.getByText('Спецификация API')).toBeInTheDocument();
    expect(
      db.sources.filter((s) => s.project_id === project.id && s.scope === 'project'),
    ).toHaveLength(1);
  });

  it('групповой анализ берёт draft и ready, а ready запускает после подтверждения', async () => {
    const user = userEvent.setup();
    const { draft, ready } = setup();
    await user.click(await screen.findByRole('button', { name: 'Анализ всех документов' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/Текущие результаты анализа будут заменены/),
    ).toBeInTheDocument();
    const firstCall = db.requests.find((r) => r.path.endsWith('/analysis-jobs/bulk'));
    expect(firstCall?.body).toEqual({
      document_ids: [draft.id, ready.id],
      force: false,
      strategy: 'auto',
    });

    await user.click(within(dialog).getByRole('button', { name: 'Запустить анализ' }));
    await waitFor(() =>
      expect(
        db.requests.filter((r) => r.path.endsWith('/analysis-jobs/bulk')).at(-1)?.body,
      ).toEqual({
        document_ids: [ready.id],
        force: true,
        strategy: 'auto',
      }),
    );
    expect(await screen.findAllByText('Идёт анализ')).toHaveLength(2);
  });

  it('повторная проверка готового документа идёт через подтверждение и Idempotency-Key', async () => {
    const user = userEvent.setup();
    const { ready } = setup();
    await user.click(await screen.findByRole('button', { name: /Проверить актуальность/ }));
    const dialog = await screen.findByRole('alertdialog', { name: REANALYSIS_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'Запустить анализ' }));
    await waitFor(() => {
      const call = db.requests.find((r) => r.path.endsWith(`/documents/${ready.id}/analysis-jobs`));
      expect(call?.body).toEqual({ force: true, strategy: 'auto' });
      expect(call?.headers?.['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('запуск анализа из «Ожидает утверждения» идёт сразу, без подтверждения', async () => {
    const user = userEvent.setup();
    const { review } = setup();
    await user.click(await screen.findByRole('button', { name: 'Анализировать: review.md' }));
    await waitFor(() => {
      const call = db.requests.find((r) =>
        r.path.endsWith(`/documents/${review.id}/analysis-jobs`),
      );
      expect(call?.body).toEqual({ force: false, strategy: 'auto' });
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('показывает причину неудачного анализа у черновика', async () => {
    const project = addProject(db);
    const doc = addDocument(db, project.id, { name: 'failed.md', status: 'draft' });
    const job = addJob(db, doc.id, {
      status: 'failed',
      error_code: 'LLM_UNAVAILABLE',
      error_message: 'Модель не ответила вовремя',
    });
    doc.currentJobId = job.id;
    renderWithApp({ routes: screenRoutes, initialEntries: [`/projects/${project.id}`] });
    expect(
      await screen.findByLabelText('Анализ не удался: Модель не ответила вовремя'),
    ).toBeInTheDocument();
  });

  it('несуществующий проект — страница 404', async () => {
    renderWithApp({ routes: screenRoutes, initialEntries: ['/projects/unknown'] });
    expect(await screen.findByText(/не найден/i)).toBeInTheDocument();
  });
});
