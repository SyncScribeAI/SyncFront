import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AnalysisJobResponse } from '@/api/types';
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

const TEXT = 'Срок ответа 10 дней.\nОплата картой.\nДоставка курьером.\n';

let db: Db;

beforeEach(() => {
  db = createDb();
  server.use(...backendHandlers(db));
});

function setup(
  incremental: AnalysisJobResponse['incremental'],
  runStats?: AnalysisJobResponse['run_stats'],
) {
  const project = addProject(db);
  const baseline = addJob(db, 'doc', {
    status: 'success',
    created_at: '2026-11-10T08:00:00Z',
    finished_at: '2026-11-10T09:00:00Z',
  });
  const doc = addDocument(db, project.id, {
    name: 'guide.txt',
    format: 'txt',
    status: 'awaiting_approval',
    text: TEXT,
    blocks: [{ ref: 'p-2', type: 'paragraph', start_offset: 37, end_offset: 55, editable: true }],
  });
  const job = addJob(db, doc.id, {
    status: 'success',
    finished_at: '2026-11-14T09:00:00Z',
    incremental: incremental ? { baseline_job_id: baseline.id, ...incremental } : incremental,
    run_stats: runStats ?? null,
  });
  doc.currentJobId = job.id;
  return { project, doc };
}

function open(projectId: string, documentId: string) {
  return renderWithApp({
    routes: [{ path: '/projects/:projectId/documents/:documentId', element: <DocumentPage /> }],
    initialEntries: [`/projects/${projectId}/documents/${documentId}`],
  });
}

const list = () => screen.getByRole('list', { name: 'Список предложений' });
const stats = { segments_total: 40, segments_sent: 3, chars_total: 4000, chars_sent: 300 };

describe('Редактор: инкрементальный анализ', () => {
  it('сводка выборочной задачи называет проверенные блоки и дату прошлого анализа', async () => {
    const { project, doc } = setup(
      { mode: 'delta', reason: 'input_changed', stale: 1 },
      { ...stats, blocks_total: 240, blocks_checked: 12 },
    );
    open(project.id, doc.id);
    const summary = await screen.findByText(/из анализа от 10 нояб/);
    expect(summary).toHaveTextContent(
      /^Проверено блоков: 12 из 240, остальные результаты перенесены из анализа от 10 нояб\. 2026/,
    );
    expect(summary).toHaveTextContent('Перенесённых решений с изменившимся основанием: 1');
  });

  it('при переходе к полному анализу сводка показывает причину', async () => {
    const { project, doc } = setup({
      mode: 'full',
      reason: 'input_changed',
      fallback_reason: 'chain_limit',
    });
    open(project.id, doc.id);
    expect(
      await screen.findByText(
        'Выполнен полный анализ: достигнут предел выборочных проверок подряд.',
      ),
    ).toBeInTheDocument();
  });

  it('первый анализ и ответ старого сервера сводку не показывают', async () => {
    const { project, doc } = setup(null);
    addSuggestion(db, db.documents[0]!, {
      change_type: 'modify',
      original_text: '10 дней',
      suggested_text: '14 дней',
    });
    open(project.id, doc.id);
    expect(
      await within(await screen.findByTestId('document-text')).findByText('10 дней'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/перенесены|полный анализ/)).not.toBeInTheDocument();
  });

  it('перенесённая правка и правка с изменившимся основанием отмечены в списке и карточке', async () => {
    const user = userEvent.setup();
    const { project, doc } = setup({ mode: 'delta', reason: 'input_changed' });
    addSuggestion(db, doc, {
      change_type: 'modify',
      original_text: '10 дней',
      suggested_text: '14 дней',
      carried_from_id: 'old-1',
    });
    addSuggestion(db, doc, {
      change_type: 'delete',
      original_text: 'Оплата картой.',
      carried_from_id: 'old-2',
      stale: true,
      status: 'accepted',
    });
    addFlag(db, doc, { block_id: 'p-2', reason: 'evidence_removed' });
    open(project.id, doc.id);

    await screen.findByTestId('document-text');
    expect(within(list()).getByText('Перенесена')).toBeInTheDocument();
    expect(screen.getByText('Основание удалено из источника')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Решено' }));
    expect(within(list()).getByText('Основание изменилось')).toBeInTheDocument();
    await user.click(within(list()).getByText('Оплата картой.'));
    const card = await screen.findByRole('region', { name: 'Карточка предложения' });
    expect(within(card).getByText('Перенесена')).toBeInTheDocument();
    expect(within(card).getByText(/Решение стоит пересмотреть/)).toBeInTheDocument();
  });
});
