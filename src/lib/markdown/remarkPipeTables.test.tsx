import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TextRange } from '@/domain/editor/textRange';

import { MarkdownView, type RangeRenderer } from './MarkdownView';

const mark: RangeRenderer = ({ children }) => <mark>{children}</mark>;

function view(text: string, pipeTables: boolean, ranges: TextRange[] = []) {
  return render(
    <MarkdownView text={text} ranges={ranges} renderRange={mark} pipeTables={pipeTables} />,
  ).container;
}

const TABLE = 'Тарифы\n\n| План | Цена |\n| Базовый | 100 |\n| Про | 250 |\n\nКонец';

describe('remarkPipeTables', () => {
  it('строки с вертикальными чертами становятся таблицей с шапкой', () => {
    const container = view(TABLE, true);
    expect([...container.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual([
      'План',
      'Цена',
    ]);
    expect([...container.querySelectorAll('tbody td')].map((cell) => cell.textContent)).toEqual([
      'Базовый',
      '100',
      'Про',
      '250',
    ]);
  });

  it('подсветка по смещениям снимка попадает в ячейку', () => {
    const start = TABLE.indexOf('250');
    const container = view(TABLE, true, [{ id: 'e', kind: 'evidence', start, end: start + 3 }]);
    const marked = container.querySelector('mark');
    expect(marked?.textContent).toBe('250');
    expect(marked?.closest('td')).not.toBeNull();
  });

  it.each([
    ['одна строка', '| a | b |'],
    ['разное число ячеек', '| a | b |\n| c |'],
    ['строка без черты', '| a | b |\nтекст'],
  ])('%s остаётся абзацем', (_name, text) => {
    expect(view(text, true).querySelector('table')).toBeNull();
  });

  it('для документов плагин выключен', () => {
    expect(view(TABLE, false).querySelector('table')).toBeNull();
  });
});
