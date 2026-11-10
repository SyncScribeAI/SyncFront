import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { http, HttpResponse } from 'msw';

import { EDITOR_TEXTS, EMPTY_FILTER_TEXTS, FLAG_TEXTS } from '@/features/editor';
import { DocumentPage } from '@/pages/DocumentPage';
import {
  addDocument,
  addFlag,
  addJob,
  addProject,
  addSuggestion,
  backendHandlers,
  createDb,
  type Db,
} from '@/test/msw/backend';
import { server } from '@/test/msw/server';
import { renderWithApp } from '@/test/render';

const TEXT = '# Сроки\nСрок ответа — 10 дней.\nОплата картой.\n';

let db: Db;

beforeEach(() => {
  db = createDb();
  server.use(...backendHandlers(db));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(status: 'awaiting_approval' | 'ready' = 'awaiting_approval') {
  const project = addProject(db);
  const doc = addDocument(db, project.id, {
    name: 'guide.md',
    format: 'markdown',
    status,
    currentJobId: 'job-1',
    text: TEXT,
    sections: [{ ref: 'Сроки', start_offset: 0, end_offset: TEXT.length }],
  });
  const modify = addSuggestion(db, doc, {
    change_type: 'modify',
    original_text: '10 дней',
    suggested_text: '14 дней',
    rationale: 'В регламенте указано 14 дней.',
    section_ref: 'Сроки',
    status: status === 'ready' ? 'accepted' : 'pending',
  });
  const remove = addSuggestion(db, doc, {
    change_type: 'delete',
    original_text: 'Оплата картой.',
    status: status === 'ready' ? 'rejected' : 'pending',
  });
  return { project, doc, modify, remove };
}

function open(projectId: string, documentId: string) {
  return renderWithApp({
    routes: [
      { path: '/projects/:projectId/documents/:documentId', element: <DocumentPage /> },
      { path: '/projects/:projectId', element: <h1>Страница проекта</h1> },
    ],
    initialEntries: [`/projects/${projectId}/documents/${documentId}`],
  });
}

const documentText = () => screen.findByTestId('document-text');
const list = () => screen.getByRole('list', { name: 'Список предложений' });
const reviewRequests = () =>
  db.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('/suggestions/review'));

async function selectCard(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(within(list()).getByText(text));
  return screen.findByRole('region', { name: 'Карточка предложения' });
}

describe('Редактор правок', () => {
  it('показывает режимы просмотра: «Правки» по умолчанию, «Оригинал» и «Чистовик»', async () => {
    const user = userEvent.setup();
    const { project, doc } = setup();
    open(project.id, doc.id);

    const text = await documentText();
    expect(within(text).getByRole('button', { name: 'Изменение' })).toHaveTextContent(
      '10 дней14 дней',
    );
    expect(within(text).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Правки' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Оригинал' }));
    expect(screen.getByText(EDITOR_TEXTS.originalNotice)).toBeInTheDocument();
    expect(within(await documentText()).queryByRole('button')).not.toBeInTheDocument();
    expect(await documentText()).toHaveTextContent('Срок ответа — 10 дней.');

    // В «Чистовике» нерассмотренные правки размечены как в «Правках».
    await user.click(screen.getByRole('radio', { name: 'Чистовик' }));
    const clean = await documentText();
    expect(within(clean).getByRole('button', { name: 'Изменение' })).toBeInTheDocument();
    expect(within(clean).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  });

  it('принимает правку из карточки и сохраняет решение с If-Match', async () => {
    const user = userEvent.setup();
    const { project, doc, modify } = setup();
    open(project.id, doc.id);
    await documentText();

    expect(screen.getByRole('button', { name: /Сохранено/ })).toBeDisabled();
    const card = await selectCard(user, '14 дней');
    expect(within(card).getByText('В регламенте указано 14 дней.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Принять' }));

    expect(screen.queryByRole('region', { name: 'Карточка предложения' })).not.toBeInTheDocument();
    expect(screen.getByText(/^1 принято$/)).toBeInTheDocument();
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
    // Принятая правка ушла из «На рассмотрении».
    expect(within(list()).queryByText('14 дней')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Чистовик' }));
    const clean = await documentText();
    expect(clean).toHaveTextContent('Срок ответа — 14 дней.');
    // Принятая правка — без подсветки, но с быстрой отменой; нерассмотренное удаление размечено.
    expect(within(clean).getByRole('button', { name: 'Изменение, принято' })).toBeInTheDocument();
    expect(within(clean).getByRole('button', { name: 'Отменить решение' })).toBeInTheDocument();
    expect(within(clean).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /^Сохранить$/ })[0]!);
    await waitFor(() => expect(reviewRequests()).toHaveLength(1));
    const [request] = reviewRequests();
    expect(request?.headers?.['if-match']).toBe('0');
    expect(request?.body).toEqual({
      review_version: 0,
      decisions: [{ suggestion_id: modify.id, decision: 'accepted' }],
      finalize: false,
    });
    expect(await screen.findByRole('button', { name: /Сохранено/ })).toBeDisabled();
    expect(modify.status).toBe('accepted');
  });

  it('после решения всех правок завершает ревью и даёт экспортировать', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:export');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { project, doc, remove } = setup();
    open(project.id, doc.id);
    await documentText();

    await user.click(
      within(await selectCard(user, '14 дней')).getByRole('button', { name: 'Принять' }),
    );
    const card = await selectCard(user, 'Оплата картой.');
    expect(within(card).getByText(EDITOR_TEXTS.deleteMessage)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Отклонить' }));

    // Баннера «Все предложения обработаны» больше нет: признак завершения — пустой фильтр «На рассмотрении».
    expect(await screen.findByText(EMPTY_FILTER_TEXTS.pending)).toBeInTheDocument();
    expect(screen.getByText(/^0 на рассмотрении$/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /^Сохранить$/ })[0]!);

    expect(await screen.findByText(EDITOR_TEXTS.completed)).toBeInTheDocument();
    expect(reviewRequests()[0]?.body).toMatchObject({ finalize: true });
    expect(remove.status).toBe('rejected');
    expect(await screen.findByText('Готово')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Экспорт/ }));
    await user.click(await screen.findByRole('menuitem', { name: '.md' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('guide.md');
    const exportRequest = db.requests.find((r) => r.path.includes('/export'));
    expect(exportRequest?.path).not.toContain('export_format');
  });

  it('экспорт до готовности недоступен', async () => {
    const { project, doc } = setup();
    open(project.id, doc.id);
    await documentText();
    expect(screen.getByRole('button', { name: /Экспорт/ })).toBeDisabled();
  });

  it('при конфликте версий показывает баннер, перечитывает данные и сохраняет буфер', async () => {
    const user = userEvent.setup();
    const { project, doc, modify } = setup();
    open(project.id, doc.id);
    await documentText();

    await user.click(
      within(await selectCard(user, '14 дней')).getByRole('button', { name: 'Принять' }),
    );
    doc.reviewVersion = 5;
    await user.click(screen.getAllByRole('button', { name: /^Сохранить$/ })[0]!);

    expect(await screen.findByText(EDITOR_TEXTS.conflictTitle)).toBeInTheDocument();
    expect(modify.status).toBe('pending');
    await user.click(screen.getByRole('radio', { name: /^Решено/ }));
    expect(within(list()).getByText(/не сохранено/)).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^Сохранить$/ })[0]).toBeEnabled(),
    );
    await user.click(screen.getAllByRole('button', { name: /^Сохранить$/ })[0]!);
    await waitFor(() => expect(modify.status).toBe('accepted'));
    expect(reviewRequests().at(-1)?.headers?.['if-match']).toBe('5');
  });

  it('отмена сохранённого решения в готовом документе возвращает его на утверждение', async () => {
    const user = userEvent.setup();
    const { project, doc, modify } = setup('ready');
    open(project.id, doc.id);
    await documentText();
    expect(screen.getByRole('radio', { name: 'Чистовик' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: /^Все/ }));
    const card = await selectCard(user, '14 дней');
    expect(within(card).queryByRole('button', { name: 'Принять' })).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Отменить' }));

    await waitFor(() => expect(modify.status).toBe('pending'));
    expect(
      db.requests.find((r) => r.method === 'PATCH' && r.path.endsWith('/suggestions'))?.body,
    ).toEqual({ ids: [modify.id], status: 'pending' });
    expect(await screen.findByText('Ожидает утверждения')).toBeInTheDocument();
  });

  it('несохранённое решение отменяется локально, без запроса', async () => {
    const user = userEvent.setup();
    const { project, doc } = setup();
    open(project.id, doc.id);
    await documentText();

    await user.click(
      within(await selectCard(user, '14 дней')).getByRole('button', { name: 'Принять' }),
    );
    await user.click(screen.getByRole('radio', { name: /^Решено/ }));
    await user.click(
      within(await selectCard(user, '14 дней')).getByRole('button', { name: 'Отменить' }),
    );

    expect(await screen.findByText(EMPTY_FILTER_TEXTS.decided)).toBeInTheDocument();
    expect(db.requests.some((r) => r.method === 'PATCH')).toBe(false);
    expect(screen.getByRole('button', { name: /Сохранено/ })).toBeDisabled();
  });

  it('сбрасывает все решения после подтверждения', async () => {
    const user = userEvent.setup();
    const { project, doc, modify } = setup('ready');
    open(project.id, doc.id);
    await documentText();

    await user.click(screen.getByRole('button', { name: 'Дополнительные действия' }));
    await user.click(await screen.findByRole('menuitem', { name: EDITOR_TEXTS.resetTitle }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(EDITOR_TEXTS.resetText)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Сбросить' }));

    await waitFor(() => expect(modify.status).toBe('pending'));
    expect(db.requests.some((r) => r.path.endsWith('/editor/reset'))).toBe(true);
    expect(await screen.findByText('Ожидает утверждения')).toBeInTheDocument();
  });

  it('спрашивает подтверждение при уходе с несохранёнными решениями', async () => {
    const user = userEvent.setup();
    const { project, doc } = setup();
    open(project.id, doc.id);
    await documentText();

    await user.click(
      within(await selectCard(user, '14 дней')).getByRole('button', { name: 'Принять' }),
    );
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(EDITOR_TEXTS.leaveText)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Остаться' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Назад' }));
    dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить и выйти' }));
    expect(await screen.findByRole('heading', { name: 'Страница проекта' })).toBeInTheDocument();
    expect(reviewRequests()).toHaveLength(1);
  });

  it('уход без сохранения не отправляет решения', async () => {
    const user = userEvent.setup();
    const { project, doc } = setup();
    open(project.id, doc.id);
    await documentText();

    await user.click(
      within(await selectCard(user, '14 дней')).getByRole('button', { name: 'Отклонить' }),
    );
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Выйти без сохранения' }));
    expect(await screen.findByRole('heading', { name: 'Страница проекта' })).toBeInTheDocument();
    expect(reviewRequests()).toHaveLength(0);
  });

  it('предупреждает о правке, фрагмент которой не найден в тексте', async () => {
    const user = userEvent.setup();
    const { project, doc } = setup();
    addSuggestion(db, doc, {
      change_type: 'modify',
      original_text: 'Такого текста нет',
      suggested_text: 'Новая формулировка',
    });
    open(project.id, doc.id);
    await documentText();

    const card = await selectCard(user, 'Новая формулировка');
    expect(within(card).getByText(/Фрагмент не найден в тексте/)).toBeInTheDocument();
  });

  it('догружает правки сверх первой страницы и виртуализирует длинный список', async () => {
    const { project, doc } = setup();
    for (let i = 0; i < 199; i += 1) {
      addSuggestion(db, doc, { change_type: 'add', suggested_text: `Пункт ${i}` });
    }
    open(project.id, doc.id);
    await documentText();

    expect(screen.getByText(/0\/201/)).toBeInTheDocument();
    expect(
      db.requests.some((r) => r.path.includes('/suggestions?') && r.path.includes('offset=200')),
    ).toBe(true);
    // В DOM только видимая часть списка, кнопки дорисовки больше нет.
    expect(screen.queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument();
    const rendered = within(list()).getAllByRole('listitem');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(201);
  });

  describe('частичный анализ', () => {
    it('показывает, сколько блоков проверено, и причину', async () => {
      const { project, doc } = setup();
      addJob(db, doc.id, {
        id: 'job-1',
        status: 'partial_success',
        partial_success: true,
        error_code: 'PARTIAL_FAILURE',
        error_message: 'недоступны источники: wiki',
        checked_blocks: 3,
        failed_blocks: 1,
      });
      open(project.id, doc.id);
      expect(
        await screen.findByText(
          'Проверено 3 из 4 блоков, часть документа не проверена. недоступны источники: wiki',
        ),
      ).toBeInTheDocument();
    });

    it('без частичного успеха баннера нет', async () => {
      const { project, doc } = setup();
      addJob(db, doc.id, { id: 'job-1', status: 'success' });
      open(project.id, doc.id);
      await documentText();
      await waitFor(() =>
        expect(db.requests.some((r) => r.path.endsWith('/analysis-jobs/job-1'))).toBe(true),
      );
      expect(screen.queryByText(/часть документа не проверена/)).not.toBeInTheDocument();
    });
  });

  describe('флаги «проверьте вручную»', () => {
    const BLOCKS = [
      { ref: 'b1', type: 'heading' as const, start_offset: 0, end_offset: 7, editable: true },
      { ref: 'b2', type: 'paragraph' as const, start_offset: 8, end_offset: 30, editable: true },
      { ref: 'b3', type: 'paragraph' as const, start_offset: 31, end_offset: 45, editable: true },
    ];
    const FLAG_PATH = '/api/v1/projects/:projectId/documents/:documentId/flags/:flagId';

    function setupFlag(status: 'awaiting_approval' | 'ready' = 'awaiting_approval') {
      const base = setup(status);
      base.doc.blocks = BLOCKS;
      const flag = addFlag(db, base.doc, {
        block_id: 'b2',
        reason: 'sources_conflict',
        original_text: 'Срок ответа — 10 дней.',
        rationale: 'Wiki и регламент называют разные сроки.',
        quotes: [{ source_name: 'Регламент', text: 'Срок ответа — 14 дней' }],
      });
      return { ...base, flag };
    }

    const section = () => screen.findByRole('heading', { name: /Проверьте вручную/ });
    const flagList = () => screen.getByRole('list', { name: 'Список флагов' });
    const flagPatches = () =>
      db.requests.filter((r) => r.method === 'PATCH' && r.path.includes('/flags/'));

    it('показывает флаг в панели со счётчиком и подсвечивает блок в тексте', async () => {
      const { project, doc, flag } = setupFlag();
      open(project.id, doc.id);
      expect(await section()).toHaveTextContent('Проверьте вручную (1)');
      expect(within(flagList()).getByText('Источники расходятся')).toBeInTheDocument();
      const text = await documentText();
      expect(text.querySelector(`[data-flag-id="${flag.id}"]`)).not.toBeNull();
    });

    it('без флагов раздела нет', async () => {
      const { project, doc } = setup();
      open(project.id, doc.id);
      await documentText();
      expect(screen.queryByRole('heading', { name: /Проверьте вручную/ })).not.toBeInTheDocument();
    });

    it('клик по блоку в тексте выбирает карточку флага и раскрывает цитаты', async () => {
      const user = userEvent.setup();
      const { project, doc, flag } = setupFlag();
      open(project.id, doc.id);
      const text = await documentText();
      const mark = text.querySelector<HTMLElement>(`[data-flag-id="${flag.id}"]`);
      expect(mark).not.toBeNull();
      await user.click(mark!);
      expect(
        await screen.findByText('Wiki и регламент называют разные сроки.'),
      ).toBeInTheDocument();
      expect(within(flagList()).getByText(/Срок ответа — 14 дней/)).toBeInTheDocument();
    });

    it('«Просмотрено» сразу уменьшает счётчик и отправляет PATCH, «Вернуть» снимает отметку', async () => {
      const user = userEvent.setup();
      const { project, doc, flag } = setupFlag();
      open(project.id, doc.id);
      await section();
      await user.click(within(flagList()).getByRole('button', { name: FLAG_TEXTS.markReviewed }));
      expect(await section()).toHaveTextContent('Проверьте вручную (0)');
      await waitFor(() => expect(flagPatches()).toHaveLength(1));
      expect(flagPatches()[0]?.body).toEqual({ status: 'reviewed' });
      expect(db.flags[0]?.status).toBe('reviewed');
      // Флаг не трогает буфер ревью: решений к сохранению не появилось.
      expect(reviewRequests()).toHaveLength(0);

      await user.click(await within(flagList()).findByRole('button', { name: FLAG_TEXTS.reopen }));
      await waitFor(() => expect(db.flags[0]?.status).toBe('pending'));
      expect(await section()).toHaveTextContent('Проверьте вручную (1)');
      expect(flag.id).toBe(db.flags[0]?.id);
    });

    it('при ошибке сервера откатывает отметку', async () => {
      const user = userEvent.setup();
      const { project, doc } = setupFlag();
      server.use(
        http.patch(FLAG_PATH, () => HttpResponse.json({ detail: 'Сбой' }, { status: 500 })),
      );
      open(project.id, doc.id);
      await section();
      await user.click(within(flagList()).getByRole('button', { name: FLAG_TEXTS.markReviewed }));
      await waitFor(async () => expect(await section()).toHaveTextContent('Проверьте вручную (1)'));
      expect(
        within(flagList()).getByRole('button', { name: FLAG_TEXTS.markReviewed }),
      ).toBeEnabled();
    });

    it('404 — флаг прежнего анализа: сообщает и перечитывает редактор', async () => {
      const user = userEvent.setup();
      const { project, doc } = setupFlag();
      server.use(
        http.patch(FLAG_PATH, () => HttpResponse.json({ detail: 'not found' }, { status: 404 })),
      );
      open(project.id, doc.id);
      await section();
      const editorLoads = () =>
        db.requests.filter((r) => r.method === 'GET' && r.path.includes('/editor')).length;
      const before = editorLoads();
      await user.click(within(flagList()).getByRole('button', { name: FLAG_TEXTS.markReviewed }));
      expect(await screen.findByText(FLAG_TEXTS.stale)).toBeInTheDocument();
      await waitFor(() => expect(editorLoads()).toBeGreaterThan(before));
    });

    it('409 — документ вышел из ревью: сообщает «Документ не в ревью»', async () => {
      const user = userEvent.setup();
      const { project, doc } = setupFlag();
      open(project.id, doc.id);
      await section();
      // Документ ушёл в повторный анализ, пока экран был открыт.
      doc.status = 'in_progress';
      await user.click(within(flagList()).getByRole('button', { name: FLAG_TEXTS.markReviewed }));
      expect(await screen.findByText(FLAG_TEXTS.notInReview)).toBeInTheDocument();
    });

    it('в готовом документе флаг можно отметить, а в «Чистовике» блок не подсвечен', async () => {
      const { project, doc, flag } = setupFlag('ready');
      open(project.id, doc.id);
      await section();
      expect(
        within(flagList()).getByRole('button', { name: FLAG_TEXTS.markReviewed }),
      ).toBeInTheDocument();
      const text = await documentText();
      expect(text.querySelector(`[data-flag-id="${flag.id}"]`)).toBeNull();
    });
  });

  describe('повторяющиеся фразы', () => {
    const PHRASE_TEXT = 'Срок — 10 дней.\nОтвет за 10 дней.\nЕщё 10 дней.\n';

    function setupGroup() {
      const project = addProject(db);
      const doc = addDocument(db, project.id, {
        name: 'guide.md',
        format: 'markdown',
        status: 'awaiting_approval',
        currentJobId: 'job-1',
        text: PHRASE_TEXT,
      });
      const starts: number[] = [];
      for (
        let at = PHRASE_TEXT.indexOf('10 дней');
        at >= 0;
        at = PHRASE_TEXT.indexOf('10 дней', at + 1)
      ) {
        starts.push(at);
      }
      // Сервер отдаёт правки не в порядке документа: навигация должна идти по тексту.
      const [third, first, second] = [starts[2]!, starts[0]!, starts[1]!].map((start, index) =>
        addSuggestion(db, doc, {
          change_type: 'modify',
          original_text: '10 дней',
          suggested_text: '14 дней',
          start_offset: start,
          end_offset: start + '10 дней'.length,
          position: index,
          group_key: 'g-days',
          origin: index === 0 ? 'propagated' : 'model',
        }),
      );
      return { project, doc, first: first!, second: second!, third: third! };
    }

    it('«Принять все (N)» кладёт решение каждой правки в буфер и сохраняет обычным PUT', async () => {
      const user = userEvent.setup();
      const { project, doc, first, second, third } = setupGroup();
      open(project.id, doc.id);
      await documentText();
      await user.click(within(list()).getAllByText('14 дней')[0]!);
      const card = await screen.findByRole('region', { name: 'Карточка предложения' });
      expect(within(card).getByText('ещё 2 таких')).toBeInTheDocument();
      await user.click(within(card).getByRole('button', { name: 'Принять все (3)' }));

      expect(screen.getByText(/^3 принято$/)).toBeInTheDocument();
      expect(db.requests.some((r) => r.method === 'PATCH')).toBe(false);
      await user.click(screen.getAllByRole('button', { name: /^Сохранить$/ })[0]!);
      await waitFor(() => expect(reviewRequests()).toHaveLength(1));
      const body = reviewRequests()[0]?.body as {
        decisions: { suggestion_id: string; decision: string; edited_text?: string }[];
      };
      expect(body.decisions.map((d) => d.suggestion_id).sort()).toEqual(
        [first.id, second.id, third.id].sort(),
      );
      expect(body.decisions.every((d) => d.decision === 'accepted' && !d.edited_text)).toBe(true);
    });

    it('«Следующее вхождение» идёт по порядку документа и по кругу', async () => {
      const user = userEvent.setup();
      const { project, doc, first, second } = setupGroup();
      open(project.id, doc.id);
      await documentText();
      await user.click(within(list()).getAllByText('14 дней')[0]!);
      const pressed = () =>
        within(list())
          .getAllByRole('button', { pressed: true })
          .map((button) =>
            button.closest('[data-suggestion-id]')?.getAttribute('data-suggestion-id'),
          );
      expect(pressed()).toEqual([first.id]);
      await user.click(screen.getByRole('button', { name: 'Следующее вхождение' }));
      await waitFor(() => expect(pressed()).toEqual([second.id]));
    });

    it('правку, найденную бэкендом, помечает «Найдено автоматически»', async () => {
      const { project, doc, third } = setupGroup();
      open(project.id, doc.id);
      await documentText();
      const item = within(list())
        .getAllByRole('listitem')
        .find((li) => li.getAttribute('data-suggestion-id') === third.id);
      expect(item).toHaveTextContent('Найдено автоматически');
    });
  });
});
