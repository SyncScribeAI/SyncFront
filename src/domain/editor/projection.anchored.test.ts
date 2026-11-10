import { describe, expect, it } from 'vitest';

import { buildProjection, exportedText, type ChangeSegment } from './projection';
import type { EditorSuggestion, SuggestionStatus } from './suggestion';

/** Правка с границами по кодовым точкам — как их считает сервер. */
function spanned(
  id: string,
  text: string,
  original: string,
  occurrence: number,
  extra: Partial<EditorSuggestion> = {},
): EditorSuggestion {
  const points = Array.from(text);
  const needle = Array.from(original);
  let found = -1;
  let seen = 0;
  for (let i = 0; i + needle.length <= points.length; i += 1) {
    if (points.slice(i, i + needle.length).join('') !== original) continue;
    if (seen === occurrence) {
      found = i;
      break;
    }
    seen += 1;
  }
  if (found === -1) throw new Error(`нет вхождения ${occurrence} для ${original}`);
  return {
    id,
    change_type: 'modify',
    original_text: original,
    suggested_text: 'NEW',
    start_offset: found,
    end_offset: found + needle.length,
    status: 'pending',
    ...extra,
  };
}

const build = (
  text: string,
  suggestions: EditorSuggestion[],
  format = 'txt',
  statusOf: (s: EditorSuggestion) => SuggestionStatus = (s) => s.status,
) => buildProjection({ text, sections: [], format, suggestions, statusOf });

const changes = (projection: ReturnType<typeof build>) =>
  projection.segments.filter((s): s is ChangeSegment => s.kind === 'change').map((s) => s.id);

describe('buildProjection: правки с границами', () => {
  const text = 'Срок 10 дней.\nСрок 10 дней и Срок 10 дней.\nИтог: Срок 10 дней.';

  it('подсвечивает каждое из повторов фразы на своём месте, без overlap', () => {
    const items = [0, 1, 2, 3].map((n) => spanned(`s${n}`, text, 'Срок 10 дней', n));
    const result = build(text, items);

    expect(changes(result)).toEqual(['s0', 's1', 's2', 's3']);
    for (const item of items) {
      expect(result.located[item.id]).toMatchObject({
        issue: null,
        exportable: true,
        inline: true,
      });
    }
    expect(items.map((item) => result.located[item.id]?.originOffset)).toEqual([0, 14, 29, 49]);
  });

  it('«Чистовик» меняет все принятые вхождения, как TextExporter', () => {
    const items = [0, 1, 2, 3].map((n) =>
      spanned(`s${n}`, text, 'Срок 10 дней', n, { status: n === 2 ? 'rejected' : 'accepted' }),
    );
    expect(exportedText(build(text, items), 'txt')).toBe('NEW.\nNEW и Срок 10 дней.\nИтог: NEW.');
  });

  it('то же в docx: правки внутри своих абзацев', () => {
    const items = [0, 1, 2].map((n) =>
      spanned(`s${n}`, text, 'Срок 10 дней', n, { status: 'accepted' }),
    );
    expect(exportedText(build(text, items, 'docx'), 'docx')).toBe(
      'NEW.\nNEW и NEW.\nИтог: Срок 10 дней.',
    );
  });

  it('пропускает правку, начало которой внутри уже применённой: экспорт её не применит', () => {
    const wide = spanned('wide', text, 'Срок 10 дней', 0);
    const inner = spanned('inner', text, '10 дней', 0);
    const result = build(text, [inner, wide]);

    expect(result.located.wide).toMatchObject({ issue: null, inline: true });
    expect(result.located.inner).toMatchObject({
      issue: 'overlap',
      exportable: false,
      inline: false,
    });
  });

  it('переводит кодовые точки в UTF-16 при суррогатных парах', () => {
    const emoji = '😀 Срок 10 дней 😀 Срок 10 дней';
    const second = spanned('second', emoji, 'Срок 10 дней', 1, { status: 'accepted' });
    // Во втором вхождении сервер насчитал на два символа меньше, чем UTF-16.
    expect(second.start_offset).toBe(emoji.indexOf('Срок 10 дней', 5) - 2);

    const result = build(emoji, [second]);
    expect(result.located.second).toMatchObject({ issue: null, inline: true });
    expect(exportedText(result, 'txt')).toBe('😀 Срок 10 дней 😀 NEW');
  });

  it('при рассинхроне границ ищет первое вхождение, как экспорт', () => {
    const stale = { ...spanned('stale', text, 'Срок 10 дней', 1), start_offset: 2, end_offset: 9 };
    const result = build(text, [stale]);
    expect(result.located.stale?.originOffset).toBe(0);
  });

  it('в docx фрагмент с переводом строки по границам не применяется', () => {
    const multi = spanned('multi', text, 'дней.\nСрок', 0);
    expect(build(text, [multi], 'docx').located.multi?.issue).toBe('not_applicable');
    expect(build(text, [multi], 'txt').located.multi).toMatchObject({ issue: null, inline: true });
  });

  it('не ставит outside_section правке с границами: место известно точно', () => {
    const third = spanned('third', text, 'Срок 10 дней', 3, { section_ref: 'Первый' });
    const result = buildProjection({
      text,
      sections: [{ ref: 'Первый', start_offset: 0, end_offset: 13 }],
      format: 'txt',
      suggestions: [third],
      statusOf: (s) => s.status,
    });
    expect(result.located.third?.issue).toBeNull();
  });

  it('несколько add после одного якоря идут в порядке выдачи', () => {
    const lines = 'Первая строка\n\nВторая строка';
    const first = spanned('a1', lines, 'Первая', 0, {
      change_type: 'add',
      suggested_text: 'Абзац 1',
      status: 'accepted',
    });
    const second = spanned('a2', lines, 'строка', 0, {
      change_type: 'add',
      suggested_text: 'Абзац 2',
      status: 'accepted',
    });
    const result = build(lines, [first, second]);

    expect(changes(result)).toEqual(['a1', 'a2']);
    expect(result.located.a1?.originOffset).toBe(13);
    expect(result.located.a2?.originOffset).toBe(13);
    expect(exportedText(result, 'txt')).toBe(
      'Первая строка\n\nАбзац 1\n\nАбзац 2\n\nВторая строка',
    );
  });

  it('правка без границ применяется после правок с границами к изменённому тексту', () => {
    const anchored = spanned('anchored', text, 'Срок 10 дней', 0, { status: 'accepted' });
    const legacy: EditorSuggestion = {
      id: 'legacy',
      change_type: 'modify',
      original_text: 'Срок 10 дней',
      suggested_text: 'OLD',
      status: 'accepted',
    };
    const result = build(text, [legacy, anchored]);

    expect(result.located.legacy?.originOffset).toBe(14);
    expect(exportedText(result, 'txt')).toBe('NEW.\nOLD и Срок 10 дней.\nИтог: Срок 10 дней.');
  });

  it('линейно на 2 000 блоков и 500 правок с повторами', () => {
    const blocks = Array.from({ length: 2000 }, (_, i) => `Абзац ${i}: срок 10 дней.`);
    const big = blocks.join('\n');
    const items: EditorSuggestion[] = [];
    let offset = 0;
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i] ?? '';
      if (i % 4 === 0) {
        const start = offset + block.indexOf('срок 10 дней');
        items.push({
          id: `b${i}`,
          change_type: 'modify',
          original_text: 'срок 10 дней',
          suggested_text: 'срок 5 дней',
          start_offset: start,
          end_offset: start + 'срок 10 дней'.length,
          status: 'accepted',
        });
      }
      offset += block.length + 1;
    }
    expect(items).toHaveLength(500);

    const started = performance.now();
    const result = build(big, items);
    const elapsed = performance.now() - started;

    expect(Object.values(result.located).every((item) => item.issue === null)).toBe(true);
    expect(exportedText(result, 'txt').split('срок 5 дней')).toHaveLength(501);
    // Запас на медленный CI; квадратичный поиск по тексту на этих размерах заметно дольше.
    expect(elapsed).toBeLessThan(500);
  });
});
