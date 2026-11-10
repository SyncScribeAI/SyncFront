import { describe, expect, it } from 'vitest';

import { buildProjection } from '@/domain/editor/projection';

import { flagChunks } from './flagMarks';

const text = 'Первый абзац.\nВторой абзац.\nТретий.';

describe('flagChunks', () => {
  it('выделяет блок флага внутри текстового сегмента', () => {
    const { segments } = buildProjection({
      text,
      sections: [],
      format: 'txt',
      suggestions: [],
      statusOf: () => 'pending',
    });
    const chunks = flagChunks(segments, [{ id: 'f1', start: 14, end: 27 }]);
    expect(chunks[0]).toEqual([
      { text: 'Первый абзац.\n', flagId: null },
      { text: 'Второй абзац.', flagId: 'f1' },
      { text: '\nТретий.', flagId: null },
    ]);
  });

  it('флаг через правку разрезается на куски по обе стороны от неё', () => {
    const { segments } = buildProjection({
      text,
      sections: [],
      format: 'txt',
      suggestions: [
        {
          id: 's1',
          change_type: 'modify',
          original_text: 'абзац',
          suggested_text: 'раздел',
          start_offset: 21,
          end_offset: 26,
          status: 'pending',
        },
      ],
      statusOf: () => 'pending',
    });
    const chunks = flagChunks(segments, [{ id: 'f1', start: 14, end: 27 }]);
    const flagged = chunks.flatMap((list) =>
      (list ?? []).filter((chunk) => chunk.flagId === 'f1').map((chunk) => chunk.text),
    );
    expect(flagged).toEqual(['Второй ', '.']);
    expect(segments[1]?.kind).toBe('change');
    expect(chunks[1]).toBeNull();
  });

  it('без флагов сегменты не трогает', () => {
    const segments = [{ kind: 'text' as const, text, origin: 0 }];
    expect(flagChunks(segments, [])).toEqual([null]);
  });

  it('вложенный флаг того же места не подсвечивается повторно', () => {
    const segments = [{ kind: 'text' as const, text, origin: 0 }];
    const chunks = flagChunks(segments, [
      { id: 'a', start: 0, end: 13 },
      { id: 'b', start: 5, end: 10 },
    ]);
    expect(chunks[0]?.map((chunk) => chunk.flagId)).toEqual(['a', null]);
  });
});
