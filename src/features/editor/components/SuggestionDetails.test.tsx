import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import * as snapshots from '@/api/resources/sourceSnapshots';
import type { SuggestionResponse } from '@/api/types';

import { SuggestionDetails } from './SuggestionDetails';

const suggestion: SuggestionResponse = {
  id: 'g-0001-4000-8000-000000000000',
  document_id: 'd-0001-4000-8000-000000000000',
  analysis_job_id: 'j-0001-4000-8000-000000000000',
  sources: [
    {
      id: 's-0001-4000-8000-000000000000',
      project_id: 'p-0001-4000-8000-000000000000',
      name: 'Регламент безопасности',
      type: 'url',
      url: 'https://example.com/security-policy',
    },
  ],
  section_ref: 'Общие положения и доступ',
  change_type: 'modify',
  original_text: 'Для входа достаточно логина и пароля.',
  suggested_text: 'Для входа обязателен второй фактор аутентификации.',
  rationale: 'Введен обязательный второй фактор аутентификации.',
  confidence_score: 0.95,
  block_id: null,
  start_offset: null,
  end_offset: null,
  position: 0,
  group_key: null,
  origin: 'model',
  stale: false,
  status: 'pending',
  decided_by: null,
  decided_at: null,
  created_at: '2026-10-16T03:00:00Z',
};

describe('SuggestionDetails', () => {
  it('показывает кликабельный источник и оставляет краткое описание под ним', () => {
    render(
      <SuggestionDetails
        suggestion={suggestion}
        status="pending"
        unsaved={false}
        newText={suggestion.suggested_text ?? ''}
        located={undefined}
        canReview
        undoing={false}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const link = screen.getByRole('link', { name: 'Источник: Регламент безопасности' });
    expect(link).toHaveAttribute('href', 'https://example.com/security-policy');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.getByText('Введен обязательный второй фактор аутентификации.'),
    ).toBeInTheDocument();
  });

  it.each([
    [0.95, false],
    [0.6, true],
    [null, false],
  ])('при уверенности %s бейдж «Проверьте внимательно»: %s', (score, shown) => {
    render(
      <SuggestionDetails
        suggestion={{ ...suggestion, confidence_score: score }}
        status="pending"
        unsaved={false}
        newText={suggestion.suggested_text ?? ''}
        located={undefined}
        canReview
        undoing={false}
        onDecide={vi.fn()}
        onUndo={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(Boolean(screen.queryByText('Проверьте внимательно'))).toBe(shown);
  });

  it('ссылка с основаниями открывает просмотр снимка с подсветкой цитаты', async () => {
    const text = 'Для входа обязателен второй фактор.';
    vi.spyOn(snapshots, 'getSnapshotContent').mockResolvedValue({
      id: 'n1',
      text,
      chars: text.length,
      taken_at: '2026-11-01T10:00:00Z',
    });
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SuggestionDetails
          suggestion={{
            ...suggestion,
            evidence: [
              {
                source_id: 's-0001-4000-8000-000000000000',
                source_name: 'Регламент безопасности',
                snapshot_id: 'n1',
                quote: 'второй фактор',
                match: 'exact',
                start_offset: 21,
                end_offset: 34,
                original_file_available: false,
              },
            ],
          }}
          status="pending"
          unsaved={false}
          newText={suggestion.suggested_text ?? ''}
          located={undefined}
          canReview
          undoing={false}
          onDecide={vi.fn()}
          onUndo={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('link', { name: 'Источник: Регламент безопасности' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Источник: Регламент безопасности' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(dialog.querySelector('[data-evidence="first"]')?.textContent).toBe('второй фактор'),
    );
    expect(within(dialog).getByRole('link', { name: 'Открыть оригинал' })).toHaveAttribute(
      'href',
      'https://example.com/security-policy',
    );
  });
});
