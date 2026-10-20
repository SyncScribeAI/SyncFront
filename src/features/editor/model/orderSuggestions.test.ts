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
