import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TextRange } from '@/domain/editor/textRange';

import { MarkdownView, type RangeRenderer } from './MarkdownView';

/** Каждый фрагмент диапазона помечается, чтобы проверять, какой текст под него попал. */
const mark: RangeRenderer = ({ range, first, last, children }) => (
  <mark data-id={range.id} data-first={String(first)} data-last={String(last)}>
    {children}
  </mark>
);

function rangeOf(text: string, needle: string, id = 'r'): TextRange {
  const start = text.indexOf(needle);
  if (start < 0) throw new Error(`нет «${needle}» в тексте`);
  return { id, kind: 'suggestion', start, end: start + needle.length };
}

function view(text: string, ranges: TextRange[] = []) {
  return render(<MarkdownView text={text} ranges={ranges} renderRange={mark} />).container;
}

function marked(container: HTMLElement, id = 'r') {
  return [...container.querySelectorAll<HTMLElement>(`mark[data-id="${id}"]`)];
}

describe('MarkdownView: диапазоны по исходнику', () => {
  it('режет текст внутри жирного', () => {
    const text = 'До **важного слова** после.';
    const container = view(text, [rangeOf(text, 'важного')]);
    const [part] = marked(container);
    expect(part?.textContent).toBe('важного');
    expect(part?.closest('strong')).not.toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('важного слова');
  });

  it('диапазон через границу узлов даёт несколько фрагментов, первый и последний помечены', () => {
    const text = 'Один *два* три.';
    const container = view(text, [rangeOf(text, 'дин *два* т')]);
    const parts = marked(container);
    expect(parts.map((part) => part.textContent)).toEqual(['дин ', 'два', ' т']);
    expect(parts.map((part) => part.dataset.first)).toEqual(['true', 'false', 'false']);
    expect(parts.map((part) => part.dataset.last)).toEqual(['false', 'false', 'true']);
    expect(parts[1]?.closest('em')).not.toBeNull();
  });

  it('подсвечивает фрагмент в ячейке таблицы GFM', () => {
    const text = '| Поле | Срок |\n| --- | --- |\n| Ответ | 10 дней |\n';
    const container = view(text, [rangeOf(text, '10 дней')]);
    const [part] = marked(container);
    expect(part?.textContent).toBe('10 дней');
    expect(part?.closest('td')).not.toBeNull();
  });

  it('подсвечивает фрагмент в цитате', () => {
    const text = '> Первая строка цитаты\n';
    const container = view(text, [rangeOf(text, 'Первая')]);
    const [part] = marked(container);
    expect(part?.textContent).toBe('Первая');
    expect(part?.closest('blockquote')).not.toBeNull();
  });

  it('узел, который не совпадает с исходником один к одному, оборачивается целиком', () => {
    // Значение текстового узла цитаты без «> » на второй строке короче среза исходника.
    const text = '> Первая строка\n> вторая строка\n';
    const container = view(text, [rangeOf(text, 'вторая')]);
    const [part] = marked(container);
    expect(part?.textContent).toBe('Первая строка\nвторая строка');
  });

  it('содержимое блока кода неделимо и остаётся в pre', () => {
    const text = '```js\nconst a = 1;\nconst b = 2;\n```\n';
    const container = view(text, [rangeOf(text, 'b = 2')]);
    const [part] = marked(container);
    expect(part?.closest('pre')).not.toBeNull();
    expect(part?.textContent).toContain('const a = 1;');
    expect(part?.textContent).toContain('const b = 2;');
  });

  it('подсвечивает строчный код', () => {
    const text = 'Вызовите `run()` дважды.';
    const container = view(text, [rangeOf(text, 'run()')]);
    expect(marked(container)[0]?.closest('code')).not.toBeNull();
  });

  it('пустой диапазон рисуется в точке вставки', () => {
    const text = 'Первый абзац.\n\nВторой абзац.';
    const at = text.indexOf('\n\n');
    const container = view(text, [{ id: 'r', kind: 'suggestion', start: at, end: at }]);
    const parts = marked(container);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.dataset.first).toBe('true');
    expect(parts[0]?.dataset.last).toBe('true');
  });

  it('диапазон через границу кусков сохраняет первый и последний фрагмент', () => {
    const text = 'Первый абзац.\n\nВторой абзац.';
    const container = view(text, [rangeOf(text, 'абзац.\n\nВторой')]);
    const parts = marked(container);
    expect(parts[0]?.dataset.first).toBe('true');
    expect(parts.at(-1)?.dataset.last).toBe('true');
    expect(parts.filter((part) => part.dataset.first === 'true')).toHaveLength(1);
    expect(parts.filter((part) => part.dataset.last === 'true')).toHaveLength(1);
  });
});

describe('MarkdownView: безопасность и элементы', () => {
  it('сырой HTML остаётся текстом', () => {
    const container = view('Текст <script>alert(1)</script> и <b>тег</b>.');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('ссылки открываются в новой вкладке без доступа к opener', () => {
    const container = view('[сайт](https://example.com) и [почта](mailto:a@example.com)');
    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com',
      'mailto:a@example.com',
    ]);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('ссылка с другой схемой становится текстом', () => {
    const container = view('[опасно](javascript:alert(1)) и [файл](./local.md)');
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('опасно');
    expect(container.textContent).toContain('файл');
  });

  it('изображение заменяется подписью alt', () => {
    const container = view('![Схема процесса](https://example.com/a.png)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('[Схема процесса]');
  });

  it('рисует списки, таблицы, задачи и зачёркивание GFM', () => {
    const container = view(
      '- один\n- два\n\n1. первый\n\n- [x] готово\n\n~~старое~~\n\n| a |\n| - |\n| b |\n',
    );
    expect(container.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('ol li')?.textContent).toBe('первый');
    expect(container.querySelector('input[type="checkbox"]')).toBeChecked();
    expect(container.querySelector('del')?.textContent).toBe('старое');
    expect(container.querySelector('table td')?.textContent).toBe('b');
  });
});

describe('MarkdownView: снимок', () => {
  it('фикстура с правкой и флагом', () => {
    const text = [
      '# Регламент',
      '',
      'Срок ответа **10 дней** с даты [заявки](https://example.com).',
      '',
      '| Канал | Срок |',
      '| --- | --- |',
      '| Почта | 5 дней |',
      '',
      '> Примечание: `code` <i>raw</i>',
      '',
    ].join('\n');
    const container = view(text, [
      rangeOf(text, '10 дней', 's1'),
      { ...rangeOf(text, '5 дней', 'f1'), kind: 'flag' },
    ]);
    expect(container.innerHTML).toMatchSnapshot();
  });
});
