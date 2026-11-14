/**
 * Ключи TanStack Query. Иерархия позволяет инвалидировать срезами:
 * queryKeys.documents.all сбрасывает все списки и детали документов.
 */
import type { PageParams } from './types';

export interface MyDocumentsParams extends PageParams {
  status?: string;
  search?: string;
  outdated?: boolean;
  sort_by?: 'created_at' | 'updated_at' | 'name';
  sort_dir?: 'asc' | 'desc';
}

export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  system: {
    capabilities: ['system', 'capabilities'] as const,
  },
  projects: {
    all: ['projects'] as const,
    list: (params: PageParams = {}) => ['projects', 'list', params] as const,
    detail: (projectId: string) => ['projects', 'detail', projectId] as const,
    /** Вложен в detail: инвалидация страницы проекта обновляет и этот запрос. */
    baseSources: (projectId: string) => ['projects', 'detail', projectId, 'sources'] as const,
  },
  documents: {
    all: ['documents'] as const,
    my: (params: MyDocumentsParams = {}) => ['documents', 'my', params] as const,
    byProject: (projectId: string, params: PageParams & { status?: string } = {}) =>
      ['documents', 'project', projectId, params] as const,
    detail: (projectId: string, documentId: string) =>
      ['documents', 'detail', projectId, documentId] as const,
    content: (projectId: string, documentId: string) =>
      ['documents', 'content', projectId, documentId] as const,
    /** Исходный файл (Blob) для режима «Оригинал»; файл не меняется — кешируется на сессию. */
    file: (projectId: string, documentId: string) =>
      ['documents', 'file', projectId, documentId] as const,
    editor: (projectId: string, documentId: string) =>
      ['documents', 'editor', projectId, documentId] as const,
  },
  sources: {
    all: ['sources'] as const,
    byProject: (projectId: string, params: PageParams & { scope?: string } = {}) =>
      ['sources', 'project', projectId, params] as const,
    /** Текст источника для просмотра; источник неизменяем — кешируется надолго. */
    content: (projectId: string, sourceId: string) =>
      ['sources', 'content', projectId, sourceId] as const,
    /** Текст снимка неизменен: снимок фиксирует вход конкретного анализа. */
    file: (projectId: string, sourceId: string) =>
      ['sources', 'file', projectId, sourceId] as const,
    fileBytes: (projectId: string, sourceId: string) =>
      ['sources', 'fileBytes', projectId, sourceId] as const,
    snapshot: (projectId: string, snapshotId: string) =>
      ['sources', 'snapshot', projectId, snapshotId] as const,
  },
  analysisJobs: {
    all: ['analysis-jobs'] as const,
    byDocument: (projectId: string, documentId: string) =>
      ['analysis-jobs', projectId, documentId] as const,
    detail: (projectId: string, documentId: string, jobId: string) =>
      ['analysis-jobs', projectId, documentId, jobId] as const,
  },
  suggestions: {
    list: (projectId: string, documentId: string, params: PageParams & { status?: string } = {}) =>
      ['suggestions', projectId, documentId, params] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    summary: ['dashboard', 'summary'] as const,
    attention: ['dashboard', 'attention'] as const,
    recent: ['dashboard', 'recent'] as const,
  },
} as const;
