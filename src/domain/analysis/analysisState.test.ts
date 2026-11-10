import { describe, expect, it } from 'vitest';

import {
  analysisStateFromJob,
  isTerminalJobStatus,
  needsJobLookup,
  partialWarningText,
} from './analysisState';
import { analysisErrorHint } from './errorCodes';

const job = { id: 'j1', error_code: null, error_message: null };

describe('analysisStateFromJob', () => {
  it('failed: причина с сервера и возможность повтора', () => {
    expect(
      analysisStateFromJob({
        ...job,
        status: 'failed',
        error_code: 'LLM_UNAVAILABLE',
        error_message: 'Таймаут модели',
      }),
    ).toEqual({
      jobId: 'j1',
      phase: 'failed',
      errorCode: 'LLM_UNAVAILABLE',
      errorMessage: 'Таймаут модели',
      canRetry: true,
      warning: null,
    });
  });

  it('failed без кода получает значения по умолчанию как на сервере', () => {
    const state = analysisStateFromJob({ ...job, status: 'failed' });
    expect(state.errorCode).toBe('ANALYSIS_FAILED');
    expect(state.errorMessage).toBe('Ошибка выполнения анализа');
  });

  it('dispatched и processing — обработка без повтора', () => {
    expect(analysisStateFromJob({ ...job, status: 'dispatched' }).phase).toBe('processing');
    expect(analysisStateFromJob({ ...job, status: 'processing' }).canRetry).toBe(false);
  });

  it('cancelled', () => {
    expect(analysisStateFromJob({ ...job, status: 'cancelled' })).toMatchObject({
      phase: 'cancelled',
      canRetry: true,
    });
  });
});

describe('partial_success', () => {
  it('завершён с предупреждением: счётчики блоков и сообщение сервера', () => {
    const state = analysisStateFromJob({
      ...job,
      status: 'partial_success',
      error_code: 'PARTIAL_FAILURE',
      error_message: 'недоступны источники: wiki',
      checked_blocks: 40,
      failed_blocks: 2,
    });
    expect(state.phase).toBe('completed');
    expect(state.errorCode).toBeNull();
    expect(state.warning).toEqual({
      message: 'недоступны источники: wiki',
      checked: 40,
      failed: 2,
    });
    expect(partialWarningText(state.warning!)).toBe(
      'Проверено 40 из 42 блоков, часть документа не проверена. недоступны источники: wiki',
    );
  });

  it('без счётчиков остаётся только сообщение сервера', () => {
    const state = analysisStateFromJob({
      ...job,
      status: 'partial_success',
      error_message: 'недоступны источники: wiki',
    });
    expect(partialWarningText(state.warning!)).toBe('недоступны источники: wiki');
  });

  it('success без предупреждения', () => {
    expect(analysisStateFromJob({ ...job, status: 'success' }).warning).toBeNull();
  });
});

describe('analysisErrorHint: коды конвейера 2.0', () => {
  it.each([
    ['ML_INVALID_REQUEST', 'Ошибка интеграции с конвейером анализа. Сообщите администратору.'],
    [
      'SOURCES_UNAVAILABLE',
      'Не удалось загрузить ни один источник. Проверьте ссылки и файлы источников.',
    ],
    ['SOURCE_NOT_FOUND', 'Источник удалён во время анализа. Запустите анализ ещё раз.'],
  ])('%s', (code, hint) => {
    expect(analysisErrorHint(code)).toBe(hint);
  });

  it('PARTIAL_FAILURE — не ошибка, подсказки нет', () => {
    expect(analysisErrorHint('PARTIAL_FAILURE')).toBeUndefined();
  });
});

describe('needsJobLookup', () => {
  it('только для draft с задачей и без analysis', () => {
    expect(needsJobLookup({ status: 'draft', current_analysis_job_id: 'j1', analysis: null })).toBe(
      true,
    );
    expect(needsJobLookup({ status: 'draft', current_analysis_job_id: null })).toBe(false);
    expect(needsJobLookup({ status: 'ready', current_analysis_job_id: 'j1' })).toBe(false);
  });
});

describe('isTerminalJobStatus', () => {
  it('различает активные и завершённые задачи', () => {
    expect(isTerminalJobStatus('partial_success')).toBe(true);
    expect(isTerminalJobStatus('dispatched')).toBe(false);
  });
});
