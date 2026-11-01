import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { queryKeys } from '@/api/queryKeys';
import { backendHandlers, createDb, type Db } from '@/test/msw/backend';
import { server } from '@/test/msw/server';
import { renderWithApp } from '@/test/render';

import { screenRoutes } from './routes';

let db: Db;
beforeEach(() => {
  db = createDb();
  server.use(...backendHandlers(db));
});

async function openCreate() {
  const user = userEvent.setup();
  const app = renderWithApp({ routes: screenRoutes, initialEntries: ['/projects'] });
  const [trigger] = await screen.findAllByRole('button', { name: 'Новый проект' });
  if (!trigger) throw new Error('Create-project trigger is missing');
  await user.click(trigger);
  const dialog = within(await screen.findByRole('dialog', { name: 'Новый проект' }));
  await user.type(dialog.getByLabelText('Название проекта'), 'Источники проекта');
  return { user, dialog, ...app };
}

async function expectCreated(router: ReturnType<typeof renderWithApp>['router'], count: number) {
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/projects\/p-/));
  expect(db.sources).toHaveLength(count);
  expect(
    db.sources.every((s) => s.scope === 'project' && s.project_id === db.projects[0]?.id),
  ).toBe(true);
}

describe('Источники при создании проекта', () => {
  it('отправляет выбранный файл без отдельного нажатия «Добавить файл»', async () => {
    const { user, dialog, router } = await openCreate();
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Выбрать файл' })).toBeEnabled());
    await user.upload(
      dialog.getByLabelText('Файл источника'),
      new File(['test rules'], 'rules.txt', { type: 'text/plain' }),
    );
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    await expectCreated(router, 1);
    expect(db.requests.find((r) => r.path.endsWith('/sources/file'))?.body).toMatchObject({
      scope: 'project',
      name: 'rules.txt',
    });
  });

  it('отправляет заполненную ссылку без отдельного нажатия «Добавить ссылку»', async () => {
    const { user, dialog, router } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Ссылка' }));
    await user.type(dialog.getByLabelText('Адрес ссылки'), 'https://example.com/rules');
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    await expectCreated(router, 1);
    expect(db.requests.find((r) => r.path.endsWith('/sources'))?.body).toMatchObject({
      scope: 'project',
      url: 'https://example.com/rules',
    });
  });

  it('отправляет заполненную заметку без отдельного нажатия «Добавить заметку»', async () => {
    const { user, dialog, router } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Заметка' }));
    await user.type(dialog.getByLabelText('Название', { exact: true }), 'Правила');
    await user.type(dialog.getByLabelText('Текст заметки'), 'Искусственные тестовые правила');
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    await expectCreated(router, 1);
    expect(db.requests.find((r) => r.path.endsWith('/sources/note'))?.body).toMatchObject({
      scope: 'project',
      name: 'Правила',
      text_content: 'Искусственные тестовые правила',
    });
  });

  it('сохраняет файл, ссылку и заметку после переключения вкладок', async () => {
    const { user, dialog, router } = await openCreate();
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Выбрать файл' })).toBeEnabled());
    await user.upload(
      dialog.getByLabelText('Файл источника'),
      new File(['rules'], 'rules.txt', { type: 'text/plain' }),
    );
    await user.click(dialog.getByRole('tab', { name: 'Ссылка' }));
    await user.type(dialog.getByLabelText('Адрес ссылки'), 'https://example.com/rules');
    await user.click(dialog.getByRole('tab', { name: 'Заметка' }));
    await user.type(dialog.getByLabelText('Название', { exact: true }), 'Заметка');
    await user.type(dialog.getByLabelText('Текст заметки'), 'Правила');
    await user.click(dialog.getByRole('tab', { name: 'Файл' }));
    expect(dialog.getByText(/rules.txt/)).toBeInTheDocument();
    await user.click(dialog.getByRole('tab', { name: 'Ссылка' }));
    expect(dialog.getByLabelText('Адрес ссылки')).toHaveValue('https://example.com/rules');
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    await expectCreated(router, 3);
  });

  it('отправляет очередь и незавершённый источник ровно по одному разу', async () => {
    const { user, dialog, router } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Ссылка' }));
    await user.type(dialog.getByLabelText('Адрес ссылки'), 'https://example.com/first');
    await user.click(dialog.getByRole('button', { name: 'Добавить ссылку' }));
    await waitFor(() => expect(dialog.getByLabelText('Адрес ссылки')).toHaveValue(''));
    await user.type(dialog.getByLabelText('Адрес ссылки'), 'https://example.com/second');
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    await expectCreated(router, 2);
    expect(
      db.requests
        .filter((r) => r.method === 'POST' && r.path.endsWith('/sources'))
        .map((r) => (r.body as { url: string }).url),
    ).toEqual(['https://example.com/first', 'https://example.com/second']);
  });

  it('пустые вкладки не мешают создать проект без источников', async () => {
    const { user, dialog, router } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Заметка' }));
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    await expectCreated(router, 0);
  });

  it('не создаёт проект с невалидной ссылкой на скрытой вкладке', async () => {
    const { user, dialog, router } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Ссылка' }));
    await user.type(dialog.getByLabelText('Адрес ссылки'), 'invalid');
    await user.click(dialog.getByRole('tab', { name: 'Файл' }));
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    expect(await dialog.findByText('Некорректная ссылка')).toBeInTheDocument();
    expect(dialog.getByRole('tab', { name: 'Ссылка' })).toHaveAttribute('data-state', 'active');
    expect(router.state.location.pathname).toBe('/projects');
    expect(db.projects).toHaveLength(0);
  });

  it('не создаёт проект с незавершённой заметкой', async () => {
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Заметка' }));
    await user.type(dialog.getByLabelText('Текст заметки'), 'Без названия');
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    expect(await dialog.findByText('Укажите название заметки')).toBeInTheDocument();
    expect(db.projects).toHaveLength(0);
  });

  it('не теряет неотправленный ввод при ошибке создания проекта', async () => {
    server.use(
      http.post('/api/v1/projects', () =>
        HttpResponse.json({ detail: 'Недоступно' }, { status: 503 }),
      ),
    );
    const { user, dialog } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Ссылка' }));
    await user.type(dialog.getByLabelText('Адрес ссылки'), 'https://example.com/retry');
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    expect(await dialog.findByText('Недоступно')).toBeInTheDocument();
    expect(dialog.getByLabelText('Адрес ссылки')).toHaveValue('https://example.com/retry');
    expect(dialog.getByRole('button', { name: 'Создать проект' })).toBeEnabled();
    server.use(...backendHandlers(db));
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    await waitFor(() => expect(db.sources).toHaveLength(1));
    expect(db.projects).toHaveLength(1);
  });

  it('ждёт загрузки источника, блокирует повторную отправку и обновляет счётчики', async () => {
    let release!: () => void;
    let started = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/v1/projects/:projectId/sources', async () => {
        started = true;
        await gate;
        return undefined;
      }),
    );
    const { user, dialog, router, queryClient } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Ссылка' }));
    await user.type(dialog.getByLabelText('Адрес ссылки'), 'https://example.com/slow');
    await user.dblClick(dialog.getByRole('button', { name: 'Создать проект' }));
    await waitFor(() => expect(started).toBe(true));
    expect(router.state.location.pathname).toBe('/projects');
    expect(dialog.getByRole('button', { name: 'Добавляем источники…' })).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Отмена' })).toBeDisabled();
    act(() => {
      release();
    });
    await expectCreated(router, 1);
    expect(db.projects).toHaveLength(1);
    const list = queryClient.getQueryData<{
      pages: { items: { id: string; source_count: number }[] }[];
    }>(queryKeys.projects.list({ limit: 30 }));
    expect(
      list?.pages.flatMap((p) => p.items).find((p) => p.id === db.projects[0]?.id)?.source_count,
    ).toBe(1);
  });

  it('сообщает об ошибке одного источника и сохраняет остальные', async () => {
    server.use(
      http.post('/api/v1/projects/:projectId/sources', () =>
        HttpResponse.json({ detail: 'Источник отклонён' }, { status: 422 }),
      ),
    );
    const { user, dialog, router } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Ссылка' }));
    await user.type(dialog.getByLabelText('Адрес ссылки'), 'https://example.com/rejected');
    await user.click(dialog.getByRole('tab', { name: 'Заметка' }));
    await user.type(dialog.getByLabelText('Название', { exact: true }), 'Заметка');
    await user.type(dialog.getByLabelText('Текст заметки'), 'Правила');
    await user.click(dialog.getByRole('button', { name: 'Создать проект' }));
    await expectCreated(router, 1);
    expect(
      await screen.findByText('Проект создан, но часть источников не добавилась'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Источник отклонён/)).toBeInTheDocument();
  });

  it('после отмены и повторного открытия не отправляет старые черновики', async () => {
    const { user, dialog, router } = await openCreate();
    await user.click(dialog.getByRole('tab', { name: 'Ссылка' }));
    await user.type(dialog.getByLabelText('Адрес ссылки'), 'https://example.com/cancelled');
    await user.click(dialog.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const [trigger] = screen.getAllByRole('button', { name: 'Новый проект' });
    if (!trigger) throw new Error('Create-project trigger is missing');
    await user.click(trigger);
    const reopened = within(await screen.findByRole('dialog', { name: 'Новый проект' }));
    await user.type(reopened.getByLabelText('Название проекта'), 'Без источников');
    await user.click(reopened.getByRole('button', { name: 'Создать проект' }));
    await expectCreated(router, 0);
  });
});
