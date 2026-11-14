import { describe, expect, it } from 'vitest';

import { chunkKeys, splitMarkdownChunks } from './chunks';

const texts = (text: string) => splitMarkdownChunks(text).map((chunk) => chunk.text);

describe('splitMarkdownChunks', () => {
  it('куски покрывают текст без пропусков', () => {
    const text = '# Заголовок\n\nАбзац\nпродолжение\n\n- один\n- два\n\nКонец';
    const chunks = splitMarkdownChunks(text);
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
    for (const chunk of chunks)
      expect(text.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
  });

  it('блок кода с пустыми строками остаётся одним куском', () => {
    const text = 'До\n\n```\nа\n\nб\n```\n\nПосле';
    expect(texts(text)).toContain('```\nа\n\nб\n```\n\n');
  });

  it('пункты списка через пустую строку не разделяются', () => {
    const text = '- один\n\n- два\n\n  продолжение\n\nАбзац';
    expect(texts(text)[0]).toBe('- один\n\n- два\n\n  продолжение\n\n');
  });

  it('текст с определением ссылки разбирается целиком', () => {
    const text = 'См. [регламент][r].\n\nДалее.\n\n[r]: https://example.com';
    expect(texts(text)).toEqual([text]);
  });

  it('вставка абзаца не меняет ключи соседних кусков', () => {
    const before = 'Первый.\n\nВторой.\n\nТретий.';
    const after = 'Первый.\n\nНовый.\n\nВторой.\n\nТретий.';
    const keysBefore = chunkKeys(splitMarkdownChunks(before));
    const keysAfter = chunkKeys(splitMarkdownChunks(after));
    expect(keysAfter).toContain(keysBefore[0]);
    expect(keysAfter).toContain(keysBefore[1]);
    expect(keysAfter).toContain(keysBefore[2]);
  });

  it('одинаковые куски получают разные ключи', () => {
    const keys = chunkKeys(splitMarkdownChunks('Да.\n\nДа.\n\n'));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
