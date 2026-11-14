import { describe, expect, it } from 'vitest';

import {
  acceptAttribute,
  fileExtension,
  validateUploadFile,
  type UploadRules,
} from './fileValidation';

const rules: UploadRules = {
  extensions: ['.docx', '.markdown', '.md', '.txt', '.pdf'],
  unsupportedExtensions: ['.doc'],
  maxSizeBytes: 1024,
  maxSizeMb: 1,
};

describe('validateUploadFile', () => {
  it('пропускает поддерживаемый файл в пределах лимита', () => {
    expect(validateUploadFile({ name: 'Guide.MD', size: 10 }, rules)).toEqual({ ok: true });
    expect(validateUploadFile({ name: 'Guide.PDF', size: 10 }, rules)).toEqual({ ok: true });
  });

  it('отклоняет .doc с явным сообщением', () => {
    const result = validateUploadFile({ name: 'old.doc', size: 10 }, rules);
    expect(result).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(!result.ok && result.message).toContain('Формат .doc не поддерживается');
  });

  it('отклоняет файл без расширения', () => {
    expect(validateUploadFile({ name: 'README', size: 10 }, rules)).toMatchObject({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('отклоняет файл больше лимита и пустой файл', () => {
    expect(validateUploadFile({ name: 'a.txt', size: 1025 }, rules)).toMatchObject({
      reason: 'too_large',
    });
    expect(validateUploadFile({ name: 'a.txt', size: 0 }, rules)).toMatchObject({
      reason: 'empty',
    });
  });

  it('вспомогательные функции', () => {
    expect(fileExtension('.env')).toBe('');
    expect(fileExtension('a.b.TXT')).toBe('.txt');
    expect(acceptAttribute(rules.extensions)).toBe('.docx,.markdown,.md,.txt,.pdf');
  });
});
