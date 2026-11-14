import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Evidence } from '@/domain/source/evidence';

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
