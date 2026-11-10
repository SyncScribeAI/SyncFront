import { describe, expect, it } from 'vitest';

import type { SuggestionResponse } from '@/api/types';
import { buildProjection } from '@/domain/editor/projection';
import type { EditorSuggestion } from '@/domain/editor/suggestion';

import { orderSuggestions } from './orderSuggestions';

const editorSuggestion = (
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

describe('orderSuggestions: add', () => {
  it('порядок в панели совпадает с порядком в тексте для add и modify в одном абзаце', () => {
    const items = [
      editorSuggestion('add-first', 'add', 'Начало'),
      editorSuggestion('modify', 'modify', 'Конец'),
      editorSuggestion('add-second', 'add', 'абзаца.'),
    ];
    const { located, segments } = buildProjection({
      text: 'Начало абзаца. Конец абзаца.',
      sections: [],
      format: 'txt',
      suggestions: items,
      statusOf: (item) => item.status,
    });
    const ordered = orderSuggestions(
      items.map((item) => ({ id: item.id }) as SuggestionResponse),
      located,
    ).map((item) => item.id);
    const inText = segments.flatMap((segment) => (segment.kind === 'change' ? [segment.id] : []));

    expect(ordered).toEqual(inText);
  });
});

describe('orderSuggestions: position', () => {
  const add = (id: string, position: number) =>
    ({ id, change_type: 'add', position }) as SuggestionResponse;

  it('два add на один якорь идут по position, даже если массив пересортирован', () => {
    const items = [add('second', 2), add('first', 1)];
    const located = {
      second: { issue: null, exportable: true, inline: true, originOffset: 10 },
      first: { issue: null, exportable: true, inline: true, originOffset: 10 },
    };
    expect(orderSuggestions(items, located).map((item) => item.id)).toEqual(['first', 'second']);
  });

  it('в тексте и в панели порядок совпадает: 1, 2', () => {
    // Сервер отдаёт правки по (created_at, position, id) — в этом же порядке их применяет экспорт.
    // Правки с границами: add без границ в одну точку экспорт ставит в обратном порядке.
    const items: EditorSuggestion[] = [
      {
        ...editorSuggestion('first', 'add', 'якорь'),
        position: 1,
        start_offset: 9,
        end_offset: 14,
      },
      {
        ...editorSuggestion('second', 'add', 'якорь'),
        position: 2,
        start_offset: 9,
        end_offset: 14,
      },
    ];
    const { located, segments } = buildProjection({
      text: 'Строка с якорь.\nДальше',
      sections: [],
      format: 'txt',
      suggestions: items,
      statusOf: (item) => item.status,
    });
    const inText = segments.flatMap((segment) => (segment.kind === 'change' ? [segment.id] : []));
    const panel = orderSuggestions(
      [...items].reverse().map((item) => ({ ...item }) as SuggestionResponse),
      located,
    ).map((item) => item.id);

    expect(inText).toEqual(['first', 'second']);
    expect(panel).toEqual(['first', 'second']);
  });
});
