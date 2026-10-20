import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SuggestionResponse } from '@/api/types';
import type { LocatedSuggestion } from '@/domain/editor/projection';

import { orderSuggestions } from '../model/orderSuggestions';

import { SuggestionsPanel } from './SuggestionsPanel';

const makeSuggestion = (
  id: string,
  text: string,
  status: SuggestionResponse['status'] = 'pending',
) =>
  ({
    id,
    document_id: 'd-0001-4000-8000-000000000000',
    analysis_job_id: 'j-0001-4000-8000-000000000000',
    section_ref: null,
    change_type: 'modify',
    original_text: text,
    suggested_text: text,
    rationale: null,
    confidence_score: null,
    block_id: null,
    start_offset: null,
    end_offset: null,
    status,
    decided_by: null,
    decided_at: null,
    created_at: '2026-10-16T03:00:00Z',
  }) satisfies SuggestionResponse;

const loc = (originOffset: number | null): LocatedSuggestion => ({
  issue: originOffset === null ? 'not_found' : null,
  exportable: originOffset !== null,
  inline: originOffset !== null,
  originOffset,
});

const suggestions = [
  makeSuggestion('late', 'Позже'),
  makeSuggestion('missing-1', 'Без позиции 1'),
  makeSuggestion('early', 'Раньше'),
  makeSuggestion('same', 'Та же позиция'),
  makeSuggestion('missing-2', 'Без позиции 2'),
];
const located = {
  late: loc(20),
  'missing-1': loc(null),
  early: loc(5),
  same: loc(20),
  'missing-2': loc(null),
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof SuggestionsPanel>> = {},
  container?: HTMLElement,
) {
  const onSelect = vi.fn();
  const onDecide = vi.fn();
  render(
    <SuggestionsPanel
      suggestions={suggestions}
      statusOf={(s) => s.status}
      unsavedIds={new Set()}
      located={located}
      progress={{
        total: suggestions.length,
        decided: 0,
        pending: suggestions.length,
        accepted: 0,
        rejected: 0,
        percent: 0,
      }}
      selectedId="early"
      onSelect={onSelect}
      canReview
      onDecide={onDecide}
      {...overrides}
    />,
    { container },
  );
  return { onSelect, onDecide };
}

describe('SuggestionsPanel', () => {
  it('сортирует по позиции и стабильно отправляет непривязанные предложения в конец', () => {
    expect(orderSuggestions(suggestions, located).map((s) => s.id)).toEqual([
      'early',
      'late',
      'same',
      'missing-1',
      'missing-2',
    ]);
  });

  it('применяет фильтр после сортировки', () => {
    renderPanel({
      suggestions: [suggestions[0]!, { ...suggestions[2]!, status: 'accepted' }],
      progress: { total: 2, decided: 1, pending: 1, accepted: 1, rejected: 0, percent: 50 },
    });
    expect(screen.getByText('Позже')).toBeInTheDocument();
    expect(screen.queryByText('Раньше')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Все' }));
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Раньше');
    expect(items[1]).toHaveTextContent('Позже');
  });

  it('переключает выбор стрелками и принимает выбранную правку по Enter', () => {
    const { onSelect, onDecide } = renderPanel();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('late');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(onSelect).toHaveBeenCalledWith('early');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onDecide).toHaveBeenCalledWith('early', 'accepted');
  });

  it('переводит фокус с карточки на панель, чтобы стрелки работали после клика', () => {
    const { onSelect } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Раньше/ }));
    expect(document.activeElement).toBe(screen.getByRole('complementary'));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenLastCalledWith('late');
  });

  it('не перехватывает клавиши, когда панель скрыта', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-hidden', 'true');
    document.body.appendChild(wrapper);
    const { onSelect, onDecide } = renderPanel({}, wrapper);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDecide).not.toHaveBeenCalled();
    wrapper.remove();
  });

  it.each(['input', 'textarea', 'select', 'button', 'a'])(
    'не перехватывает клавиши в %s',
    (tag) => {
      const { onSelect, onDecide } = renderPanel();
      const element = document.createElement(tag);
      if (element instanceof HTMLAnchorElement) element.href = '#test';
      document.body.appendChild(element);
      fireEvent.keyDown(element, { key: 'ArrowDown' });
      fireEvent.keyDown(element, { key: 'Enter' });
      expect(onSelect).not.toHaveBeenCalled();
      expect(onDecide).not.toHaveBeenCalled();
      element.remove();
    },
  );

  it('не перехватывает клавиши в contenteditable', () => {
    const { onSelect, onDecide } = renderPanel();
    const element = document.createElement('div');
    element.setAttribute('contenteditable', 'true');
    document.body.appendChild(element);
    fireEvent.keyDown(element, { key: 'ArrowDown' });
    fireEvent.keyDown(element, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDecide).not.toHaveBeenCalled();
    element.remove();
  });

  it('не перехватывает клавиши у элемента со встроенной клавиатурной семантикой', () => {
    const { onSelect, onDecide } = renderPanel();
    const element = document.createElement('div');
    element.setAttribute('role', 'slider');
    element.tabIndex = 0;
    document.body.appendChild(element);
    fireEvent.keyDown(element, { key: 'ArrowDown' });
    fireEvent.keyDown(element, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDecide).not.toHaveBeenCalled();
    element.remove();
  });

  it('прокручивает выбранную карточку короткого списка в видимую область', () => {
    const scrollIntoView = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      renderPanel({ selectedId: 'late' });
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });
});
