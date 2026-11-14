import type { UploadRules } from '@/domain/upload/fileValidation';

import { useCapabilities } from './CapabilitiesProvider';

interface ServerUploadCapabilities {
  document_extensions: readonly string[];
  source_extensions?: readonly string[] | null;
  unsupported_extensions: readonly string[];
  max_size_bytes: number;
  max_size_mb: number;
}

const FRONTEND_SUPPORTED_EXTENSIONS = ['.pdf'] as const;

/**
 * Безопасные правила на случай, если /system/capabilities временно недоступен.
 * Сервер в любом случае повторно проверяет формат и размер файла.
 */
export const FALLBACK_UPLOAD_RULES: UploadRules = {
  extensions: ['.docx', '.md', '.markdown', '.txt', ...FRONTEND_SUPPORTED_EXTENSIONS],
  unsupportedExtensions: ['.doc'],
  maxSizeBytes: 50 * 1024 * 1024,
  maxSizeMb: 50,
};

export function buildUploadRules(
  upload?: ServerUploadCapabilities,
  kind: 'document' | 'source' = 'document',
): UploadRules {
  if (
    !upload ||
    upload.document_extensions.length === 0 ||
    !Number.isFinite(upload.max_size_bytes) ||
    upload.max_size_bytes <= 0 ||
    !Number.isFinite(upload.max_size_mb) ||
    upload.max_size_mb <= 0
  ) {
    return FALLBACK_UPLOAD_RULES;
  }

  const extensions =
    kind === 'source' && upload.source_extensions?.length
      ? upload.source_extensions
      : upload.document_extensions;

  return {
    extensions: [
      ...new Set([
        ...extensions.map((extension) => extension.toLowerCase()),
        ...FRONTEND_SUPPORTED_EXTENSIONS,
      ]),
    ],
    unsupportedExtensions: upload.unsupported_extensions,
    maxSizeBytes: upload.max_size_bytes,
    maxSizeMb: upload.max_size_mb,
  };
}

/**
 * Правила загрузки из capabilities. Пока ответ загружается или при ошибке запроса
 * возвращаются консервативные значения, поэтому выбор файлов не блокируется навсегда.
 */
export function useUploadRules(kind: 'document' | 'source' = 'document'): UploadRules {
  const { capabilities } = useCapabilities();
  return buildUploadRules(capabilities?.upload, kind);
}
