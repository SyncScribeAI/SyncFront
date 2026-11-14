import { describe, expect, it } from 'vitest';

import type { EditorSuggestion } from '@/domain/editor/suggestion';

import { flagMarkId, markTarget, pdfMarks, suggestionMarkId } from './pdfMarks';

const rect = [1, 10, 10, 50, 20];
const suggestion = (patch: Partial<EditorSuggestion>): EditorSuggestion => ({
  id: 'g',
  change_type: 'modify',
  status: 'pending',
  geometry: { rects: [rect] },
  ...patch,
});
const statusOf = (s: EditorSuggestion) => s.status;
const suggestions = [
  suggestion({ id: 'm' }),
  suggestion({ id: 'a', status: 'accepted' }),
  suggestion({ id: 'r', status: 'rejected' }),
  suggestion({ id: 'n', geometry: null }),
];
const flags = [
  { id: 'f1', geometry: { rects: [rect] } },
  { id: 'f2', geometry: null },
];

describe('pdfMarks', () => {
  it('«Оригинал» без отметок', () => {
    expect(pdfMarks({ mode: 'original', suggestions, statusOf, flags })).toEqual([]);
  });

  it('«Правки»: флаги снизу, правки сверху, без прямоугольников пропускаются', () => {
    const marks = pdfMarks({ mode: 'suggestions', suggestions, statusOf, flags });
    expect(marks.map((m) => m.id)).toEqual(['f:f1', 's:m', 's:a', 's:r']);
    expect(marks[0]?.rects).toEqual([{ page: 1, x0: 10, y0: 10, x1: 50, y1: 20 }]);
  });

  it('цвет зависит от решения и типа правки', () => {
    const classOf = (id: string, list = suggestions) =>
      pdfMarks({ mode: 'suggestions', suggestions: list, statusOf, flags: [] }).find(
        (m) => m.id === suggestionMarkId(id),
      )?.className;
    expect(classOf('m')).toContain('amber');
    expect(classOf('a')).toContain('emerald');
    expect(classOf('r')).toContain('slate');
    expect(classOf('d', [suggestion({ id: 'd', change_type: 'delete' })])).toContain('red');
    expect(classOf('p', [suggestion({ id: 'p', change_type: 'add' })])).toContain('border-2');
  });

  it('решение из буфера важнее сохранённого статуса', () => {
    const marks = pdfMarks({
      mode: 'clean',
      suggestions: [suggestion({ id: 'm' })],
      statusOf: () => 'accepted',
      flags,
    });
    expect(marks.map((m) => m.id)).toEqual(['s:m']);
  });

  it('«Чистовик»: только принятые правки и без флагов', () => {
    const marks = pdfMarks({ mode: 'clean', suggestions, statusOf, flags });
    expect(marks.map((m) => m.id)).toEqual(['s:a']);
  });

  it('id отметки однозначно возвращает правку или флаг', () => {
    expect(markTarget(suggestionMarkId('x:1'))).toEqual({ kind: 'suggestion', id: 'x:1' });
    expect(markTarget(flagMarkId('y'))).toEqual({ kind: 'flag', id: 'y' });
    expect(markTarget('z')).toBeNull();
  });
});
