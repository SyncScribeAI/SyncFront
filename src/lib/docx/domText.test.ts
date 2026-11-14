import { describe, expect, it } from 'vitest';

import { findBySignature, flatten, letterSignature, nonEmptyParagraphs } from './domText';

function host(html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

describe('letterSignature', () => {
  it('оставляет буквы и цифры в нижнем регистре и помнит их место', () => {
    const signature = letterSignature('# «Срок»: 30 дней!');
    expect(signature.value).toBe('срок30дней');
    expect(signature.origins[0]).toBe(3);
    expect(signature.origins[4]).toBe(10);
  });
});

describe('findBySignature', () => {
  it('находит фрагмент снимка в абзаце DOM несмотря на разметку и пробелы', () => {
    const block = flatten(
      host('<p>Пароль <b>меняется</b>\u00a0каждые 90 дней.</p>').firstElementChild as HTMLElement,
    );
    const found = findBySignature(block, '**меняется** каждые 90');
    expect(found).not.toBeNull();
    expect(block.text.slice(found?.start, found?.end)).toBe('меняется каждые 90');
  });

  it('учитывает суррогатную пару в конце совпадения', () => {
    const block = flatten(host('<p>Итог 𝟗</p>').firstElementChild as HTMLElement);
    const found = findBySignature(block, 'итог 𝟗');
    expect(block.text.slice(found?.start, found?.end)).toBe('Итог 𝟗');
  });

  it('возвращает null, если фрагмента нет или в нём нет букв', () => {
    const block = flatten(host('<p>Текст абзаца</p>').firstElementChild as HTMLElement);
    expect(findBySignature(block, 'другое')).toBeNull();
    expect(findBySignature(block, '| · |')).toBeNull();
  });
});

describe('nonEmptyParagraphs', () => {
  it('пропускает пустые абзацы, нумерация как у DocxParser', () => {
    const blocks = nonEmptyParagraphs(
      host('<p>Один</p><p> </p><h2>Два</h2><table><tr><td><p>Три</p></td></tr></table>'),
    );
    expect(blocks.map((block) => block.text)).toEqual(['Один', 'Два', 'Три']);
  });
});
