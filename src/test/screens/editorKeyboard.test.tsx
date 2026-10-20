import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReviewBuffer } from '@/features/editor/model/reviewBuffer';
import { DocumentPage } from '@/pages/DocumentPage';
import {
  addDocument,
  addProject,
  addSuggestion,
  backendHandlers,
  createDb,
} from '@/test/msw/backend';
import { server } from '@/test/msw/server';
import { renderWithApp } from '@/test/render';

vi.mock('@/features/editor/lib/renderDocx', () => ({
  renderDocx: vi.fn((_blob: Blob, host: HTMLElement) => {
    host.innerHTML =
      '<section><article><p>Срок ответа — 10 дней.</p><p>Оплата картой.</p></article></section>';
    return Promise.resolve();
  }),
}));

let db = createDb();
beforeEach(() => {
  db = createDb();
  server.use(...backendHandlers(db));
  server.use(
    http.get(
      '/api/v1/projects/:projectId/documents/:documentId/file',
      () => new HttpResponse('docx'),
    ),
  );
});

afterEach(() => vi.restoreAllMocks());

const reviewRequests = () =>
  db.requests.filter((r) => r.method === 'PUT' && r.path.endsWith('/suggestions/review'));
const list = () => screen.getByRole('list', { name: 'Список предложений' });
async function selectCard(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(within(list()).getByText(text));
  return screen.findByRole('region', { name: 'Карточка предложения' });
}
function open(projectId: string, documentId: string) {
  return renderWithApp({
    routes: [{ path: '/projects/:projectId/documents/:documentId', element: <DocumentPage /> }],
    initialEntries: [`/projects/${projectId}/documents/${documentId}`],
  });
}

describe.each(['txt', 'markdown', 'docx'])('Клавиатурное ревью: %s', (format) => {
  function setup() {
    const project = addProject(db);
    const doc = addDocument(db, project.id, {
      name: `guide.${format}`,
      format,
      status: 'awaiting_approval',
      currentJobId: 'job-1',
      text: 'Срок ответа — 10 дней.\nОплата картой.\n',
      sections: [],
    });
    const modify = addSuggestion(db, doc, {
      change_type: 'modify',
      original_text: '10 дней',
      suggested_text: '14 дней',
    });
    const remove = addSuggestion(db, doc, {
      change_type: 'delete',
      original_text: 'Оплата картой.',
    });
    return { project, doc, modify, remove };
  }
  async function documentText() {
    if (format !== 'docx') return screen.findByTestId('document-text');
    await screen.findByTestId('docx-anchor-report');
    return screen.getByTestId('docx-suggestions');
  }
  function expectReviewFocus(marker: HTMLElement) {
    expect(document.activeElement).not.toBe(marker);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toContainElement(marker);
    expect(document.activeElement).toHaveAttribute('tabindex', '-1');
  }
  it('принимает кликнутую в документе правку отдельным Enter без стрелок', async () => {
    const user = userEvent.setup();
    const { project, doc, modify } = setup();
    const decide = vi.spyOn(useReviewBuffer.getState(), 'decide');
    open(project.id, doc.id);
    const text = await documentText();
    const marker = within(text).getByRole('button', { name: 'Изменение' });
    await user.click(marker.querySelector('ins')!);
    expect(marker).toHaveAttribute('aria-pressed', 'true');
    expectReviewFocus(marker);
    expect(screen.getByRole('region', { name: 'Карточка предложения' })).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith(modify.id, 'accepted', undefined);
    expect(within(text).getByRole('button', { name: 'Изменение, принято' })).toBeInTheDocument();
    expect(reviewRequests()).toHaveLength(0);
    await user.click(screen.getAllByRole('button', { name: /^Сохранить$/ })[0]!);
    await waitFor(() => expect(reviewRequests()).toHaveLength(1));
    expect(reviewRequests()[0]?.body).toMatchObject({
      decisions: [{ suggestion_id: modify.id, decision: 'accepted' }],
    });
  });

  it('после выбора A и клика B принимает B, а не A', async () => {
    const user = userEvent.setup();
    const { project, doc, remove } = setup();
    open(project.id, doc.id);
    const text = await documentText();
    await selectCard(user, '14 дней');
    const marker = within(text).getByRole('button', { name: 'Удалить' });
    await user.click(marker.querySelector('del')!);
    expect(marker).toHaveAttribute('aria-pressed', 'true');
    expectReviewFocus(marker);
    await user.keyboard('{Enter}');
    expect(within(text).getByRole('button', { name: 'Удалить, принято' })).toBeInTheDocument();
    expect(within(text).getByRole('button', { name: 'Изменение' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /^Сохранить$/ })[0]!);
    await waitFor(() => expect(reviewRequests()).toHaveLength(1));
    expect(reviewRequests()[0]?.body).toMatchObject({
      decisions: [{ suggestion_id: remove.id, decision: 'accepted' }],
    });
  });

  it('стрелки после клика используют общий выбор, Enter не принимает дважды', async () => {
    const user = userEvent.setup();
    const { project, doc, modify } = setup();
    const decide = vi.spyOn(useReviewBuffer.getState(), 'decide');
    open(project.id, doc.id);
    const text = await documentText();
    await user.click(within(text).getByRole('button', { name: 'Изменение' }));
    await user.keyboard('{ArrowDown}');
    expect(within(text).getByRole('button', { name: 'Удалить' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.keyboard('{ArrowUp}{Enter}{Enter}');
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith(modify.id, 'accepted', undefined);
    expect(within(text).getByRole('button', { name: 'Изменение, принято' })).toBeInTheDocument();
    expect(within(text).getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    expect(reviewRequests()).toHaveLength(0);
    await user.click(screen.getAllByRole('button', { name: /^Сохранить$/ })[0]!);
    await waitFor(() => expect(reviewRequests()).toHaveLength(1));
    expect(reviewRequests()[0]?.body).toMatchObject({
      decisions: [{ suggestion_id: modify.id, decision: 'accepted' }],
    });
  });

  it.each(['{Enter}', ' '])(
    'активация маркера %s только открывает; отдельный Enter принимает',
    async (key) => {
      const user = userEvent.setup();
      const { project, doc } = setup();
      open(project.id, doc.id);
      const text = await documentText();
      const marker = within(text).getByRole('button', { name: 'Изменение' });
      marker.focus();
      expect(document.activeElement).toBe(marker);
      await user.keyboard(key);
      expect(marker).toHaveAttribute('aria-pressed', 'true');
      expect(marker).toHaveAttribute('aria-label', 'Изменение');
      expectReviewFocus(marker);
      await user.keyboard('{Enter}');
      expect(marker).toHaveAttribute('aria-label', 'Изменение, принято');
      expect(reviewRequests()).toHaveLength(0);
    },
  );

  it('скрытая панель не принимает кликнутую правку', async () => {
    window.localStorage.setItem('syncscribe.editor.suggestionsPanel', 'closed');
    const user = userEvent.setup();
    const { project, doc } = setup();
    open(project.id, doc.id);
    const text = await documentText();
    const marker = within(text).getByRole('button', { name: 'Изменение' });
    await user.click(marker);
    expectReviewFocus(marker);
    await user.keyboard('{Enter}');
    expect(marker).toHaveAttribute('aria-label', 'Изменение');
    expect(reviewRequests()).toHaveLength(0);
  });

  it('фильтр «Решено» исключает выбранное pending-предложение', async () => {
    const user = userEvent.setup();
    const { project, doc, remove } = setup();
    remove.status = 'rejected';
    open(project.id, doc.id);
    const text = await documentText();
    await user.click(screen.getByRole('radio', { name: 'Решено' }));
    const marker = within(text).getByRole('button', { name: 'Изменение' });
    await user.click(marker);
    await user.keyboard('{Enter}');
    expect(marker).toHaveAttribute('aria-label', 'Изменение');
    expect(reviewRequests()).toHaveLength(0);
  });

  it('без can_review не принимает даже pending-предложение', async () => {
    const user = userEvent.setup();
    const { project, doc } = setup();
    doc.status = 'ready';
    open(project.id, doc.id);
    const text = await documentText();
    const marker = within(text).getByRole('button', { name: 'Изменение' });
    await user.click(marker);
    await user.keyboard('{Enter}');
    expect(marker).toHaveAttribute('aria-label', 'Изменение');
    expect(screen.queryByRole('button', { name: /^Принять$/ })).not.toBeInTheDocument();
    expect(reviewRequests()).toHaveLength(0);
  });

  it.each(['accepted', 'rejected'] as const)(
    'не принимает повторно %s при can_review',
    async (status) => {
      const user = userEvent.setup();
      const { project, doc, modify } = setup();
      modify.status = status;
      open(project.id, doc.id);
      const text = await documentText();
      await user.click(screen.getByRole('radio', { name: 'Все' }));
      const name = status === 'accepted' ? 'Изменение, принято' : 'Изменение, отклонено';
      const marker = within(text).getByRole('button', { name });
      await user.click(marker);
      await user.keyboard('{Enter}');
      expect(marker).toHaveAttribute('aria-label', name);
      expect(screen.queryByRole('button', { name: /^Сохранить$/ })).not.toBeInTheDocument();
      expect(reviewRequests()).toHaveLength(0);
    },
  );

  it('не принимает и не открывает при IME, modifiers, repeat и обработанных событиях', async () => {
    const user = userEvent.setup();
    const { project, doc } = setup();
    open(project.id, doc.id);
    const text = await documentText();
    const marker = within(text).getByRole('button', { name: 'Изменение' });
    const blocked = [
      { isComposing: true },
      { repeat: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
    ];
    for (const options of blocked) {
      marker.focus();
      fireEvent.keyDown(marker, { key: 'Enter', ...options });
      expect(marker).toHaveAttribute('aria-pressed', 'false');
    }
    await user.click(marker);
    const target = document.activeElement!;
    for (const options of blocked) fireEvent.keyDown(target, { key: 'Enter', ...options });
    const handled = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    handled.preventDefault();
    fireEvent(target, handled);
    expect(marker).toHaveAttribute('aria-label', 'Изменение');
    expect(reviewRequests()).toHaveLength(0);
  });

  it('вложенные поля, ссылки, кнопки и ARIA-виджеты сохраняют клавиши и фокус', async () => {
    const user = userEvent.setup();
    const { project, doc } = setup();
    open(project.id, doc.id);
    const text = await documentText();
    const marker = within(text).getByRole('button', { name: 'Изменение' });
    await user.click(marker);
    const controls = [
      '<input aria-label="input" />',
      '<textarea aria-label="textarea"></textarea>',
      '<select><option>value</option></select>',
      '<div contenteditable="true" tabindex="0">editable</div>',
      '<button type="button"><span>button</span></button>',
      '<a href="#native"><span>link</span></a>',
      ...[
        'button',
        'link',
        'menuitem',
        'option',
        'radio',
        'checkbox',
        'switch',
        'slider',
        'spinbutton',
        'combobox',
        'listbox',
        'textbox',
      ].map((role) => `<span role="${role}" tabindex="0"><span>widget</span></span>`),
    ];
    for (const html of controls) {
      const container = document.createElement('span');
      container.innerHTML = html;
      const control = container.firstElementChild as HTMLElement;
      marker.appendChild(control);
      const target = (
        control.firstElementChild?.tagName === 'SPAN' ? control.firstElementChild : control
      ) as HTMLElement;
      const nativeAction = vi.fn();
      control.addEventListener('click', nativeAction);
      control.focus();
      for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        fireEvent(target, event);
        expect(event.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(control);
      }
      await user.click(target);
      expect(nativeAction).toHaveBeenCalledTimes(1);
      if (control.tagName === 'BUTTON' || control.tagName === 'A') {
        await user.keyboard('{Enter}');
        expect(nativeAction).toHaveBeenCalledTimes(2);
      }
      if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
        await user.type(control, 'обычный ввод');
        expect(control).toHaveValue('обычный ввод');
      }
      expect(document.activeElement).toBe(control);
      expect(marker).toHaveAttribute('aria-label', 'Изменение');
      control.remove();
    }
    expect(reviewRequests()).toHaveLength(0);
  });
});
