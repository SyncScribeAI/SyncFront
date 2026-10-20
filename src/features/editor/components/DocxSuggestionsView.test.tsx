import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EditorSuggestion, SuggestionStatus } from '@/domain/editor/suggestion';

import { ANCHOR_ATTR } from '../lib/docxAnchors';

import { DocxSuggestionsView } from './DocxSuggestionsView';

const file = new Blob(['docx']);
const sections = [{ ref: 'A', start_offset: 0, end_offset: 100 }];
const add: EditorSuggestion = {
  id: 'add-1',
  change_type: 'add',
  status: 'pending',
  original_text: 'якорь',
  suggested_text: 'Новый текст',
  section_ref: 'A',
};
const suggestions = [add];
const statusOf = (suggestion: EditorSuggestion) => suggestion.status;
const newTextOf = (suggestion: EditorSuggestion) => suggestion.suggested_text ?? '';

function props(items: EditorSuggestion[] = suggestions) {
  return {
    file,
    loading: false,
    error: null,
    mode: 'suggestions' as const,
    suggestions: items,
    sections,
    plainText: 'якорь\nхвост раздела',
    statusOf,
    newTextOf,
    selectedId: null,
    onSelect: vi.fn(),
    fallback: <p>Плоский текст</p>,
    render: vi.fn((_blob: Blob, host: HTMLElement) => {
      host.innerHTML = '<section><article><p>якорь</p><p>хвост раздела</p></article></section>';
      return Promise.resolve();
    }),
  };
}

async function addition(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: 'Добавить' });
}

const countMessage = 'Показано в тексте: 1 из 1';

describe('DocxSuggestionsView', () => {
  it('рисует зелёное добавление после якоря внутри страницы, не в конце раздела', () => {
    render(<DocxSuggestionsView {...props()} />);
    const anchor = await addition();
    expect(anchor).toHaveTextContent('Новый текст');
    expect(anchor.previousElementSibling).toHaveTextContent('якорь');
    expect(anchor.nextElementSibling).toHaveTextContent('хвост раздела');
    expect(anchor.parentElement?.tagName).toBe('ARTICLE');
    expect(screen.getByTestId('docx-anchor-report')).toHaveTextContent(countMessage);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('не показывает непривязанное добавление в документе и объясняет причину', async () => {
    render(<DocxSuggestionsView {...props([{ ...add, original_text: 'отсутствующий якорь' }])} />);
    const report = await screen.findByTestId('docx-anchor-report');
    expect(report).toHaveTextContent('Показано в тексте: 0 из 1');
    expect(report).toHaveTextContent('остальные доступны в панели справа');
    expect(report).toHaveAttribute('title', 'add-1: not_found');
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось определить место вставки');
    expect(screen.queryByText('Новый текст')).not.toBeInTheDocument();
    expect(screen.getByText('хвост раздела').nextElementSibling).toBeNull();
  });

  it('переключает решения, режим, выделение и текст без повторного рендера DOCX', async () => {
    const base = props();
    let status: SuggestionStatus = 'pending';
    const { rerender } = render(<DocxSuggestionsView {...base} statusOf={() => status} />);
    const anchor = await addition();

    status = 'accepted';
    rerender(
      <DocxSuggestionsView
        {...base}
        statusOf={() => status}
        mode="clean"
        selectedId={add.id}
        newTextOf={() => 'Исправленный текст'}
      />,
    );
    expect(anchor).toHaveTextContent('Исправленный текст');
    expect(anchor).toHaveAttribute('aria-pressed', 'true');
    expect(anchor.nextElementSibling).toHaveTextContent('хвост раздела');

    status = 'rejected';
    rerender(<DocxSuggestionsView {...base} statusOf={() => status} />);
    expect(anchor).not.toBeVisible();

    status = 'pending';
    rerender(<DocxSuggestionsView {...base} statusOf={() => status} />);
    expect(anchor).toBeVisible();
    expect(anchor).toHaveTextContent('Новый текст');
    expect(base.render).toHaveBeenCalledTimes(1);
  });

  it('выбирает вставку по клику, Enter и Space, не изменяя её положение', async () => {
    const base = props();
    render(<DocxSuggestionsView {...base} />);
    const anchor = await addition();
    fireEvent.click(anchor.querySelector('ins')!);
    fireEvent.keyDown(anchor, { key: 'Enter' });
    fireEvent.keyDown(anchor, { key: ' ' });
    expect(base.onSelect).toHaveBeenCalledTimes(3);
    expect(base.onSelect).toHaveBeenLastCalledWith(add.id);
    expect(anchor.previousElementSibling).toHaveTextContent('якорь');
  });

  it('пересчитывает привязки и убирает предупреждение после нового анализа', async () => {
    const base = props([{ ...add, original_text: null }]);
    const { rerender } = render(<DocxSuggestionsView {...base} />);
    await screen.findByRole('alert');
    rerender(<DocxSuggestionsView {...base} suggestions={suggestions} />);
    await addition();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByTestId('docx-anchor-report')).toHaveTextContent(countMessage);
    expect(base.render).toHaveBeenCalledTimes(2);
  });

  it('предупреждает только о непривязанных добавлениях, не о modify', async () => {
    render(
      <DocxSuggestionsView
        {...props([{ ...add, change_type: 'modify', original_text: 'отсутствует' }])}
      />,
    );
    await screen.findByTestId('docx-anchor-report');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.querySelector(`[${ANCHOR_ATTR}]`)).toBeNull();
  });
});
