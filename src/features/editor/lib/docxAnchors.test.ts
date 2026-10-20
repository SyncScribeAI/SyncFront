import { describe, expect, it } from 'vitest';

import type { DocumentSection } from '@/domain/editor/projection';
import type { EditorSuggestion } from '@/domain/editor/suggestion';

import { ANCHOR_ATTR, anchorSuggestions } from './docxAnchors';

let counter = 0;
function s(
  partial: Partial<EditorSuggestion> & Pick<EditorSuggestion, 'change_type'>,
): EditorSuggestion {
  counter += 1;
  return { id: `s${counter}`, status: 'pending', ...partial };
}

function host(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const anchorOf = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLElement>(`[${ANCHOR_ATTR}="${id}"]`);

const run = (
  root: HTMLElement,
  suggestions: EditorSuggestion[],
  plainText = '',
  sections: DocumentSection[] = [],
) => anchorSuggestions(root, { suggestions, sections, plainText });

describe('anchorSuggestions', () => {
  it('оборачивает первое вхождение внутри абзаца и не трогает остальной текст', () => {
    const root = host('<p>Срок — 10 дней. Ещё 10 дней.</p>');
    const m = s({ change_type: 'modify', original_text: '10 дней', suggested_text: '14 дней' });
    const report = run(root, [m]);
    const anchor = anchorOf(root, m.id);
    expect(report.anchored.get(m.id)).toBe(anchor);
    expect(anchor?.textContent).toBe('10 дней');
    expect(root.textContent).toBe('Срок — 10 дней. Ещё 10 дней.');
    expect(root.querySelectorAll(`[${ANCHOR_ATTR}]`)).toHaveLength(1);
  });

  it('сохраняет форматирование ранов, когда фрагмент пересекает их границу', () => {
    const root = host('<p><span style="font-weight:bold">Жирный</span> и обычный текст</p>');
    const m = s({ change_type: 'delete', original_text: 'ный и обыч' });
    run(root, [m]);
    const anchor = anchorOf(root, m.id);
    expect(anchor?.textContent).toBe('ный и обыч');
    expect(anchor?.querySelector('span')?.textContent).toBe('ный');
    expect(root.textContent).toBe('Жирный и обычный текст');
  });

  it('ищет в ячейках таблиц так же, как в абзацах', () => {
    const root = host('<table><tr><td><p>Цена</p></td><td><p>100 руб.</p></td></tr></table>');
    const m = s({ change_type: 'modify', original_text: '100 руб.', suggested_text: '120 руб.' });
    run(root, [m]);
    expect(anchorOf(root, m.id)?.closest('td')).not.toBeNull();
  });

  it('не ищет через границу абзаца и помечает отсутствие фрагмента', () => {
    const root = host('<p>Первый</p><p>Второй</p>');
    const multi = s({
      change_type: 'modify',
      original_text: 'Первый\nВторой',
      suggested_text: 'x',
    });
    const cross = s({ change_type: 'modify', original_text: 'ПервыйВторой', suggested_text: 'x' });
    const report = run(root, [multi, cross]);
    expect(report.missed.get(multi.id)).toBe('not_applicable');
    expect(report.missed.get(cross.id)).toBe('not_found');
  });

  it('неразрывный пробел в документе совпадает с обычным в правке', () => {
    const root = host('<p>10&nbsp;дней</p>');
    const m = s({ change_type: 'modify', original_text: '10 дней', suggested_text: 'x' });
    const report = run(root, [m]);
    expect(report.anchored.has(m.id)).toBe(true);
  });

  it('пересечение с уже привязанной правкой — overlap, обёртка не создаётся', () => {
    const root = host('<p>красный дом</p>');
    const first = s({ change_type: 'modify', original_text: 'красный дом', suggested_text: 'дом' });
    const second = s({ change_type: 'delete', original_text: 'дом' });
    const report = run(root, [first, second]);
    expect(report.anchored.has(first.id)).toBe(true);
    expect(report.missed.get(second.id)).toBe('overlap');
    expect(root.querySelectorAll(`[${ANCHOR_ATTR}]`)).toHaveLength(1);
  });

  it('вставляет add после абзаца с original_text, а не в конец раздела или документа', () => {
    const root = host(
      '<article><p>Раздел A</p><p>якорь A</p><p>хвост A</p><p>Раздел B</p></article>',
    );
    const plainText = 'Раздел A\nякорь A\nхвост A\nРаздел B';
    const sections = [{ ref: 'A', start_offset: 0, end_offset: plainText.indexOf('Раздел B') }];
    const add = s({
      change_type: 'add',
      original_text: 'якорь A',
      suggested_text: 'новое',
      section_ref: 'A',
    });
    const report = run(root, [add], plainText, sections);
    const anchor = report.anchored.get(add.id);
    expect(anchor?.previousElementSibling?.textContent).toBe('якорь A');
    expect(anchor?.nextElementSibling?.textContent).toBe('хвост A');
    expect(anchor?.parentElement?.tagName).toBe('ARTICLE');
    expect(root.children).toHaveLength(1);
    expect(report.originals.get(anchor!)?.childNodes).toHaveLength(0);
  });

  it('находит первое вхождение якоря внутри форматированных ранов без section_ref', () => {
    const root = host('<p>До <b>якоря</b> и после.</p><p>До якоря и после.</p><p>Конец</p>');
    const add = s({ change_type: 'add', original_text: 'якоря', suggested_text: 'новое' });
    const report = run(root, [add]);
    expect(report.anchored.get(add.id)?.previousElementSibling).toBe(root.firstElementChild);
    expect(root.querySelector('b')?.textContent).toBe('якоря');
    expect(root.lastElementChild?.textContent).toBe('Конец');
  });

  it.each([null, '', '   ', 'нет в документе', 'Якорь', 'якорь\nконец'])(
    'не придумывает место для add с якорем %j, даже если section_ref существует',
    (original_text) => {
      const root = host('<p>якорь</p><p>конец</p>');
      const html = root.innerHTML;
      const add = s({
        change_type: 'add',
        original_text,
        suggested_text: 'новое',
        section_ref: 'A',
      });
      const report = run(root, [add], 'якорь\nконец', [
        { ref: 'A', start_offset: 0, end_offset: 11 },
      ]);
      expect(report.missed.get(add.id)).toBe('not_found');
      expect(report.anchored.has(add.id)).toBe(false);
      expect(root.innerHTML).toBe(html);
    },
  );

  it.each(['\u00a0', '\u202f', '\u2007', '\u2009'])(
    'нормализует специальный пробел %j в add и DOM как backend',
    (space) => {
      const root = host(`<p>Срок${space}10 дней</p><p>Конец</p>`);
      const add = s({
        change_type: 'add',
        original_text: '  Срок 10 дней  ',
        suggested_text: 'новое',
      });
      expect(run(root, [add]).anchored.get(add.id)?.previousElementSibling).toBe(
        root.firstElementChild,
      );
      const second = host('<p>Срок 10 дней</p><p>Конец</p>');
      const inverse = s({
        change_type: 'add',
        original_text: `Срок${space}10 дней`,
        suggested_text: 'новое',
      });
      expect(run(second, [inverse]).anchored.has(inverse.id)).toBe(true);
    },
  );

  it('нормализует NFC и невидимые символы, не меняя исходный DOM', () => {
    const root = host('<p>Резервны<b>и</b>\u0306\u200b план\ufeff</p><p>Конец</p>');
    const original = root.firstElementChild?.innerHTML;
    const add = s({ change_type: 'add', original_text: 'Резервный план', suggested_text: 'новое' });
    const report = run(root, [add]);
    expect(report.anchored.get(add.id)?.previousElementSibling).toBe(root.firstElementChild);
    expect(root.firstElementChild?.innerHTML).toBe(original);
  });

  it('не использует раздел вместо отсутствующего original_text и не ищет через границу абзацев', () => {
    const root = host('<p>Первая</p><p>Вторая</p>');
    const add = s({ change_type: 'add', original_text: 'ПерваяВторая', suggested_text: 'новое' });
    expect(run(root, [add]).missed.get(add.id)).toBe('not_found');
    expect(root.children).toHaveLength(2);
  });

  it('несколько add после одного абзаца размещает как экспортёр — последняя ближе к якорю', () => {
    const root = host('<p>якорь</p><p>конец</p>');
    const first = s({ change_type: 'add', original_text: 'якорь', suggested_text: 'первое' });
    const second = s({ change_type: 'add', original_text: 'якорь', suggested_text: 'второе' });
    const report = run(root, [first, second]);
    expect(Array.from(root.children)).toEqual([
      root.firstElementChild,
      report.anchored.get(second.id),
      report.anchored.get(first.id),
      root.lastElementChild,
    ]);
  });

  it('находит add-якорь в абзаце, где уже обёрнута modify/delete правка', () => {
    const root = host('<p>красный дом</p><p>конец</p>');
    const modify = s({ change_type: 'modify', original_text: 'красный', suggested_text: 'синий' });
    const add = s({ change_type: 'add', original_text: 'красный дом', suggested_text: 'новое' });
    const report = run(root, [modify, add]);
    expect(report.anchored.has(modify.id)).toBe(true);
    expect(report.anchored.get(add.id)?.previousElementSibling).toBe(root.firstElementChild);
    expect(root.textContent).toBe('красный домконец');
  });

  it('не создаёт добавление без нового текста', () => {
    const root = host('<p>якорь</p>');
    const add = s({ change_type: 'add', original_text: 'якорь', suggested_text: '' });
    expect(run(root, [add]).missed.get(add.id)).toBe('not_applicable');
    expect(root.children).toHaveLength(1);
  });

  it('исходное содержимое якоря сохраняется для отрисовки', () => {
    const root = host('<p>a <b>b</b> c</p>');
    const m = s({ change_type: 'modify', original_text: 'a b', suggested_text: 'x' });
    const report = run(root, [m]);
    const anchor = anchorOf(root, m.id);
    const original = anchor ? report.originals.get(anchor) : undefined;
    expect(original?.textContent).toBe('a b');
    expect(original?.querySelector('b')?.textContent).toBe('b');
  });
});
