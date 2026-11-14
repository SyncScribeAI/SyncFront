import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { CANCEL_ANALYSIS_TITLE } from '@/features/analysis';
import { DocumentPage } from '@/pages/DocumentPage';
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

const routes = [{ path: '/projects/:projectId/documents/:documentId', element: <DocumentPage /> }];

let db: Db;

beforeEach(() => {
  db = createDb();
  server.use(...backendHandlers(db));
});

function open(projectId: string, documentId: string) {
  return renderWithApp({
    routes,
    initialEntries: [`/projects/${projectId}/documents/${documentId}`],
  });
}

describe('Страница документа', () => {
  it('показывает цепочку, источники и отмечает открытие документа', async () => {
    const project = addProject(db, { name: 'Платёжный шлюз' });
    const doc = addDocument(db, project.id, { name: 'guide.md' });
    addSource(db, project.id, { name: 'Спецификация API' });
    addSource(db, project.id, { name: 'Тикет PAY-7', scope: 'document', documentId: doc.id });
    open(project.id, doc.id);

    expect(await screen.findByRole('heading', { name: 'guide.md', level: 1 })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Навигационная цепочка' });
    expect(await within(crumbs).findByRole('link', { name: 'Платёжный шлюз' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    );
    expect(await screen.findByText('Спецификация API')).toBeInTheDocument();
    expect(screen.getByText('Тикет PAY-7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Анализировать/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        db.requests.filter((r) => r.method === 'POST' && r.path.endsWith(`/${doc.id}/open`)),
      ).toHaveLength(1),
    );
  });

  it('отменяет анализ после подтверждения и показывает причину в черновике', async () => {
    const user = userEvent.setup();
    const project = addProject(db);
    const doc = addDocument(db, project.id, { name: 'guide.md', status: 'in_progress' });
    const job = addJob(db, doc.id, { status: 'processing' });
    doc.currentJobId = job.id;
    open(project.id, doc.id);

    await user.click(await screen.findByRole('button', { name: 'Отменить анализ' }));
    const dialog = await screen.findByRole('alertdialog', { name: CANCEL_ANALYSIS_TITLE });
    await user.click(within(dialog).getByRole('button', { name: 'Отменить анализ' }));

    expect(await screen.findByText('Анализ отменён')).toBeInTheDocument();
    expect(screen.getByText('Документ вернулся в статус "Черновик".')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Повторить анализ/ })).toBeInTheDocument();
    expect(
      db.requests.some((r) => r.method === 'DELETE' && r.path.endsWith(`/analysis-jobs/${job.id}`)),
    ).toBe(true);
  });

  it('если задача уже завершилась (409), сообщает об этом и перечитывает документ', async () => {
    const user = userEvent.setup();
    const project = addProject(db);
    const doc = addDocument(db, project.id, { name: 'guide.md', status: 'in_progress' });
    const job = addJob(db, doc.id, { status: 'processing' });
    doc.currentJobId = job.id;
    open(project.id, doc.id);

    await user.click(await screen.findByRole('button', { name: 'Отменить анализ' }));
    // Пока пользователь думал, воркер успел закончить.
    job.status = 'success';
    doc.status = 'awaiting_approval';
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Отменить анализ' }));

    expect(await screen.findByText('Анализ уже завершился, отменять нечего.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Предложения ИИ' })).toBeInTheDocument();
  });

  it('404 ведёт на страницу «не найдено»', async () => {
    const project = addProject(db);
    open(project.id, 'missing');
    expect(await screen.findByText(/не найден/i)).toBeInTheDocument();
  });
});
