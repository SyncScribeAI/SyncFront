import { describe, expect, it } from 'vitest';

import { buildProjection } from './projection';
import type { EditorSuggestion } from './suggestion';

const suggestion = (
  id: string,
  change_type: EditorSuggestion['change_type'],
  original_text: string,
): EditorSuggestion => ({
  id,
  change_type,
  original_text,
  suggested_text: change_type === 'delete' ? null : 'новый текст',
  status: 'pending',
});

const build = (text: string, suggestions: EditorSuggestion[]) =>
  buildProjection({
    text,
    sections: [],
    format: 'txt',
    suggestions,
    statusOf: (item) => item.status,
  });

describe('buildProjection: originOffset', () => {
  it('сохраняет исходные позиции и null для непривязанной правки', () => {
    const later = suggestion('later', 'modify', 'конец');
    const earlier = suggestion('earlier', 'delete', 'начало');
    const missing = suggestion('missing', 'modify', 'нет');
    const result = build('начало и конец', [later, earlier, missing]);

    expect(result.located[later.id]?.originOffset).toBe(9);
    expect(result.located[earlier.id]?.originOffset).toBe(0);
    expect(result.located[missing.id]?.originOffset).toBeNull();
  });

  it('использует точку вставки (конец строки с якорем) для add', () => {
    const add = suggestion('add', 'add', 'первая');
    const result = build('первая строка\nвторая строка', [add]);

    expect(result.located[add.id]?.originOffset).toBe('первая строка'.length);
  });

  it('add с якорем в середине абзаца идёт после modify в том же абзаце', () => {
    const text = 'Начало абзаца. Конец абзаца.';
    const add = suggestion('add', 'add', 'Начало');
    const modify = suggestion('modify', 'modify', 'Конец');
    const result = build(text, [add, modify]);

    expect(result.located[modify.id]?.originOffset).toBe(15);
    expect(result.located[add.id]?.originOffset).toBe(text.length);
    expect(result.located[modify.id]?.documentOrder).toBeLessThan(
      result.located[add.id]?.documentOrder ?? -1,
    );
  });

  it('различает add-якоря внутри одного абзаца по месту в проекции', () => {
    const text = 'первое предложение. второе предложение. третье предложение.';
    const later = suggestion('add-later', 'add', 'третье предложение');
    const earlier = suggestion('add-earlier', 'add', 'первое предложение');
    const result = build(text, [later, earlier]);

    expect(result.located[earlier.id]?.originOffset).toBe(text.length);
    expect(result.located[later.id]?.originOffset).toBe(text.length);
    expect(result.located[earlier.id]?.documentOrder).toBeLessThan(
      result.located[later.id]?.documentOrder ?? -1,
    );
  });
});
