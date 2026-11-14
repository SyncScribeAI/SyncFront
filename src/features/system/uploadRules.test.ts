import { describe, expect, it } from 'vitest';

import { buildUploadRules, FALLBACK_UPLOAD_RULES } from './uploadRules';

describe('buildUploadRules', () => {
  it('возвращает безопасные правила, пока capabilities недоступны', () => {
    expect(buildUploadRules()).toEqual(FALLBACK_UPLOAD_RULES);
    expect(buildUploadRules().extensions).toContain('.docx');
    expect(buildUploadRules().extensions).toContain('.md');
    expect(buildUploadRules().extensions).toContain('.pdf');
  });

  it('возвращает безопасные правила при некорректном ответе', () => {
    expect(
      buildUploadRules({
        document_extensions: [],
        unsupported_extensions: ['.doc'],
        max_size_bytes: 0,
        max_size_mb: 0,
      }),
    ).toEqual(FALLBACK_UPLOAD_RULES);
  });

  it('использует правила, полученные от сервера', () => {
    expect(
      buildUploadRules({
        document_extensions: ['.docx', '.txt'],
        unsupported_extensions: ['.doc'],
        max_size_bytes: 10_000,
        max_size_mb: 1,
      }),
    ).toEqual({
      extensions: ['.docx', '.txt', '.pdf'],
      unsupportedExtensions: ['.doc'],
      maxSizeBytes: 10_000,
      maxSizeMb: 1,
    });
  });

  it('использует список форматов источников и добавляет поддержку PDF на фронте', () => {
    expect(
      buildUploadRules(
        {
          document_extensions: ['.docx', '.txt'],
          source_extensions: ['.txt', '.pdf'],
          unsupported_extensions: ['.doc'],
          max_size_bytes: 10_000,
          max_size_mb: 1,
        },
        'source',
      ),
    ).toEqual({
      extensions: ['.txt', '.pdf'],
      unsupportedExtensions: ['.doc'],
      maxSizeBytes: 10_000,
      maxSizeMb: 1,
    });
  });
});
