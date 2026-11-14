import { describe, expect, it } from 'vitest';

import {
  clearDocxEvidence,
  EVIDENCE_ATTR,
  EVIDENCE_BLOCK_ATTR,
  markDocxEvidence,
} from './docxEvidence';

const HTML =
  '<p>Введение</p><p></p><p>Пароль <b>меняется</b> каждые 90 дней.</p><p>Доступ по второму фактору.</p>';

function host(): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = HTML;
  return element;
}

describe('markDocxEvidence', () => {
  it('точное совпадение оборачивается внутри абзаца с сохранением жирного', () => {
    const root = host();
    const target = markDocxEvidence(root, {
      paragraphs: { first: 1, last: 1 },
      match: 'exact',
      fragment: 'меняется каждые 90',
    });
    expect(target?.getAttribute(EVIDENCE_ATTR)).toBe('true');
    expect(target?.textContent).toBe('меняется каждые 90');
    expect(target?.querySelector('b')?.textContent).toBe('меняется');
    expect(root.querySelector(`[${EVIDENCE_BLOCK_ATTR}]`)).toBeNull();
  });

  it('приближённое основание подсвечивает абзацы целиком', () => {
    const root = host();
    const target = markDocxEvidence(root, {
      paragraphs: { first: 1, last: 2 },
      match: 'approximate',
      fragment: 'Пароль меняется каждые 90 дней.\n\nДоступ по второму фактору.',
    });
    const marked = [...root.querySelectorAll(`[${EVIDENCE_BLOCK_ATTR}]`)].map((p) => p.textContent);
    expect(marked).toEqual(['Пароль меняется каждые 90 дней.', 'Доступ по второму фактору.']);
    expect(target?.textContent).toBe('Пароль меняется каждые 90 дней.');
  });

  it('расхождение текста или номеров возвращает null и ничего не помечает', () => {
    const root = host();
    expect(
      markDocxEvidence(root, {
        paragraphs: { first: 0, last: 0 },
        match: 'exact',
        fragment: 'Доступ',
      }),
    ).toBeNull();
    expect(
      markDocxEvidence(root, {
        paragraphs: { first: 2, last: 5 },
        match: 'exact',
        fragment: 'Доступ',
      }),
    ).toBeNull();
    expect(root.innerHTML).toBe(HTML);
  });

  it('clearDocxEvidence возвращает DOM к исходному виду', () => {
    const root = host();
    markDocxEvidence(root, {
      paragraphs: { first: 1, last: 1 },
      match: 'exact',
      fragment: 'каждые 90',
    });
    markDocxEvidence(root, {
      paragraphs: { first: 2, last: 2 },
      match: 'approximate',
      fragment: 'Доступ',
    });
    clearDocxEvidence(root);
    expect(root.innerHTML).toBe(HTML);
  });
});
