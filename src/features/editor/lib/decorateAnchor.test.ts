import { describe, expect, it } from 'vitest';

import { decorateAnchor } from './decorateAnchor';

describe('оформление добавлений DOCX', () => {
  it.each(['pending', 'accepted'] as const)('сохраняет компактную подсветку: %s', (status) => {
    const paragraph = document.createElement('p');
    paragraph.style.fontFamily = 'Arial';
    paragraph.style.fontSize = '11pt';
    decorateAnchor(
      paragraph,
      document.createDocumentFragment(),
      {
        changeType: 'add',
        status,
        newText: 'Новый абзац',
        selected: false,
      },
      'suggestions',
    );
    expect(paragraph.classList.contains('px-0.5')).toBe(true);
    expect(paragraph.classList.contains('w-fit')).toBe(true);
    expect(paragraph.classList.contains('py-1')).toBe(false);
    expect(paragraph.classList.contains('my-2')).toBe(false);
    expect(paragraph.style.fontFamily).toBe('Arial');
    expect(paragraph.style.fontSize).toBe('11pt');
  });

  it('в чистовике снимает цвет и скрывает отклонённое добавление без пустого абзаца', () => {
    const paragraph = document.createElement('p');
    const state = {
      changeType: 'add' as const,
      status: 'accepted' as const,
      newText: 'Новый абзац',
      selected: false,
    };
    decorateAnchor(paragraph, document.createDocumentFragment(), state, 'clean');
    expect(paragraph.className).not.toContain('bg-emerald');
    expect(paragraph.textContent).toBe('Новый абзац');
    decorateAnchor(
      paragraph,
      document.createDocumentFragment(),
      {
        ...state,
        status: 'rejected',
      },
      'clean',
    );
    expect(paragraph.hidden).toBe(true);
  });
});
