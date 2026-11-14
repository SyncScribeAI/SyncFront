/**
 * Небольшой бэкенд в памяти для интеграционных тестов экранов проектов и документов.
 * Повторяет контракт SyncBack: счётчики проекта считаются по документам и базовым источникам,
 * цвет назначается по кругу палитры, вложенный detail у 409 confirmation_required.
 * analysis в списках не заполняется — так проверяется запасной путь через задачу анализа.
 */
import { HttpResponse, http } from 'msw';

import type {
  AnalysisFlagResponse,
  AnalysisJobResponse,
  DocumentListItem,
  DocumentResponse,
  EditorBlockResponse,
  ProjectResponse,
  SourceResponse,
  SuggestionResponse,
} from '@/api/types';
import type { DocumentStatus } from '@/domain/document/status';
import { PROJECT_COLORS } from '@/domain/project/appearance';

import { TEST_USER } from './handlers';

interface DbDocument {
  id: string;
  projectId: string;
  name: string;
  format: string;
  size: number;
  status: DocumentStatus;
  uploadedAt: string;
  currentJobId: string | null;
  suggestions: { total: number; pending: number; accepted: number; rejected: number };
  lastOpenedAt: string | null;
  /** Текст и разделы для /editor; review_version растёт с каждым PUT /review. */
  text: string;
  sections: { ref: string; start_offset: number; end_offset: number }[];
  /** Блоки EditorContent.blocks; у документов прежнего конвейера их нет. */
  blocks: EditorBlockResponse[];
  /** Размеры страниц PDF для EditorContent.pages; у других форматов их нет. */
  pages?: { number: number; width: number; height: number }[];
  reviewVersion: number;
}

interface DbSource extends SourceResponse {
  documentId: string | null;
}

export interface Db {
  projects: ProjectResponse[];
  documents: DbDocument[];
  sources: DbSource[];
  jobs: AnalysisJobResponse[];
  suggestions: SuggestionResponse[];
  flags: AnalysisFlagResponse[];
  requests: { method: string; path: string; body?: unknown; headers?: Record<string, string> }[];
}

let seq = 0;
export const id = (prefix: string) => {
  seq += 1;
  return `${prefix}-${String(seq).padStart(4, '0')}-4000-8000-000000000000`;
};

export function createDb(): Db {
  return {
    projects: [],
    documents: [],
    sources: [],
    jobs: [],
    suggestions: [],
    flags: [],
    requests: [],
  };
}

export function addProject(db: Db, patch: Partial<ProjectResponse> = {}): ProjectResponse {
  const project: ProjectResponse = {
    id: id('p'),
    name: 'Платёжный шлюз',
    description: 'Документация API',
    owner_id: TEST_USER.id,
    created_at: '2026-09-01T10:00:00Z',
    document_count: 0,
    source_count: 0,
    color: null,
    icon: null,
    ...patch,
  };
  db.projects.push(project);
  return project;
}

/** Проект в виде ответа сервера: счётчики считаются по текущему состоянию базы. */
function projectView(db: Db, project: ProjectResponse): ProjectResponse {
  return {
    ...project,
    document_count: db.documents.filter((d) => d.projectId === project.id).length,
    source_count: db.sources.filter((s) => s.project_id === project.id && s.scope === 'project')
      .length,
  };
}

export function addDocument(
  db: Db,
  projectId: string,
  patch: Partial<DbDocument> = {},
): DbDocument {
  const doc: DbDocument = {
    id: id('d'),
    projectId,
    name: 'api-guide.md',
    format: 'markdown',
    size: 2048,
    status: 'draft',
    uploadedAt: '2026-09-10T09:00:00Z',
    currentJobId: null,
    suggestions: { total: 0, pending: 0, accepted: 0, rejected: 0 },
    lastOpenedAt: null,
    text: '',
    sections: [],
    blocks: [],
    reviewVersion: 0,
    ...patch,
  };
  db.documents.push(doc);
  return doc;
}

export function addSource(db: Db, projectId: string, patch: Partial<DbSource> = {}): DbSource {
  const source: DbSource = {
    id: id('s'),
    project_id: projectId,
    name: 'confluence.example.com/api',
    type: 'url',
    scope: 'project',
    created_at: '2026-09-02T10:00:00Z',
    documentId: null,
    ...patch,
  };
  db.sources.push(source);
  return source;
}

export function addJob(
  db: Db,
  documentId: string,
  patch: Partial<AnalysisJobResponse> = {},
): AnalysisJobResponse {
  const job: AnalysisJobResponse = {
    id: id('j'),
    document_id: documentId,
    status: 'pending',
    error_code: null,
    error_message: null,
    retry_count: 0,
    created_at: '2026-09-10T09:05:00Z',
    started_at: null,
    finished_at: null,
    partial_success: false,
    strategy: 'auto',
    ...patch,
  };
  db.jobs.push(job);
  return job;
}

export function addSuggestion(
  db: Db,
  doc: DbDocument,
  patch: Partial<SuggestionResponse> & Pick<SuggestionResponse, 'change_type'>,
): SuggestionResponse {
  const suggestion: SuggestionResponse = {
    id: id('g'),
    document_id: doc.id,
    analysis_job_id: doc.currentJobId ?? 'job',
    section_ref: null,
    original_text: null,
    suggested_text: null,
    rationale: null,
    confidence_score: null,
    block_id: null,
    start_offset: null,
    end_offset: null,
    position: 0,
    group_key: null,
    origin: 'model',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    created_at: `2026-09-10T09:10:${String(db.suggestions.length).padStart(2, '0')}Z`,
    ...patch,
  };
  db.suggestions.push(suggestion);
  return suggestion;
}

export function addFlag(
  db: Db,
  doc: DbDocument,
  patch: Partial<AnalysisFlagResponse> & Pick<AnalysisFlagResponse, 'block_id'>,
): AnalysisFlagResponse {
  const flag: AnalysisFlagResponse = {
    id: id('f'),
    document_id: doc.id,
    analysis_job_id: doc.currentJobId ?? 'job',
    section_ref: 'Раздел',
    reason: 'source_conflict',
    original_text: '',
    rationale: null,
    quotes: [],
    position: db.flags.filter((f) => f.document_id === doc.id).length,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    created_at: '2026-09-10T09:10:00Z',
    ...patch,
  };
  db.flags.push(flag);
  return flag;
}

function flagsOf(db: Db, doc: DbDocument) {
  return db.flags.filter((f) => f.document_id === doc.id).sort((a, b) => a.position - b.position);
}

/** Как SyncBack: группы по всем правкам анализа, а не по странице; группы из одной правки нет. */
function groupsOf(list: SuggestionResponse[]) {
  const groups = new Map<string, { group_key: string; size: number; pending: number }>();
  for (const s of list) {
    if (!s.group_key) continue;
    const group = groups.get(s.group_key) ?? { group_key: s.group_key, size: 0, pending: 0 };
    group.size += 1;
    if (s.status === 'pending') group.pending += 1;
    groups.set(s.group_key, group);
  }
  return Array.from(groups.values()).filter((group) => group.size > 1);
}

function suggestionsOf(db: Db, doc: DbDocument) {
  return db.suggestions.filter((s) => s.document_id === doc.id);
}

function countersOf(db: Db, doc: DbDocument) {
  const list = suggestionsOf(db, doc);
  const count = (status: SuggestionResponse['status']) =>
    list.filter((s) => s.status === status).length;
  return {
    total: list.length,
    pending: count('pending'),
    accepted: count('accepted'),
    rejected: count('rejected'),
  };
}

const VIEW_MODES: Record<DocumentStatus, string> = {
  draft: 'original',
  in_progress: 'original',
  awaiting_approval: 'suggested',
  ready: 'clean',
};

function toResponse(doc: DbDocument): DocumentResponse {
  return {
    id: doc.id,
    project_id: doc.projectId,
    name: doc.name,
    format: doc.format,
    size_bytes: doc.size,
    uploaded_at: doc.uploadedAt,
    status: doc.status,
    current_analysis_job_id: doc.currentJobId,
    review_version: doc.reviewVersion,
    analysis: null,
  };
}

function toListItem(db: Db, doc: DbDocument, withCounters: boolean): DocumentListItem {
  const project = db.projects.find((p) => p.id === doc.projectId);
  return {
    id: doc.id,
    name: doc.name,
    format: doc.format,
    size_bytes: doc.size,
    status: doc.status,
    current_analysis_job_id: doc.currentJobId,
    uploaded_at: doc.uploadedAt,
    updated_at: doc.uploadedAt,
    project: { id: doc.projectId, name: project?.name ?? '' },
    suggestions: withCounters
      ? doc.suggestions
      : { total: 0, pending: 0, accepted: 0, rejected: 0 },
    sources: db.sources
      .filter((s) => s.documentId === doc.id)
      .map((s) => ({ id: s.id, name: s.name, type: s.type })),
    analysis: null,
  };
}

const notFound = () => HttpResponse.json({ detail: 'Ресурс не найден' }, { status: 404 });

function stripSource(source: DbSource): SourceResponse {
  return {
    id: source.id,
    project_id: source.project_id,
    name: source.name,
    type: source.type,
    scope: source.scope,
    created_at: source.created_at,
  };
}

export function backendHandlers(db: Db) {
  const log = (request: Request, body?: unknown) => {
    const url = new URL(request.url);
    db.requests.push({
      method: request.method,
      path: url.pathname + url.search,
      body,
      headers: Object.fromEntries(request.headers.entries()),
    });
  };

  return [
    http.get('/api/v1/projects', ({ request }) => {
      log(request);
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return HttpResponse.json({
        items: db.projects.slice(offset, offset + limit).map((p) => projectView(db, p)),
        total: db.projects.length,
        limit,
        offset,
      });
    }),
    http.post('/api/v1/projects', async ({ request }) => {
      const body = (await request.json()) as { name: string; description: string | null };
      log(request, body);
      const project = addProject(db, {
        name: body.name,
        description: body.description,
        color: PROJECT_COLORS[db.projects.length % PROJECT_COLORS.length],
      });
      return HttpResponse.json(projectView(db, project), { status: 201 });
    }),
    http.get('/api/v1/projects/:projectId', ({ request, params }) => {
      log(request);
      const project = db.projects.find((p) => p.id === params.projectId);
      if (!project) return notFound();
      const include = new URL(request.url).searchParams.getAll('include');
      return HttpResponse.json({
        ...projectView(db, project),
        sources: include.includes('sources')
          ? db.sources
              .filter((s) => s.project_id === project.id && s.scope === 'project')
              .map(stripSource)
          : null,
        documents: include.includes('documents')
          ? db.documents
              .filter((d) => d.projectId === project.id)
              .map((d) => toListItem(db, d, false))
          : null,
      });
    }),
    http.patch('/api/v1/projects/:projectId', async ({ request, params }) => {
      const body = (await request.json()) as { name?: string };
      log(request, body);
      const project = db.projects.find((p) => p.id === params.projectId);
      if (!project) return notFound();
      if (body.name) project.name = body.name;
      return HttpResponse.json(projectView(db, project));
    }),
    http.delete('/api/v1/projects/:projectId', ({ request, params }) => {
      log(request);
      db.projects = db.projects.filter((p) => p.id !== params.projectId);
      db.documents = db.documents.filter((d) => d.projectId !== params.projectId);
      return new HttpResponse(null, { status: 204 });
    }),

    http.get('/api/v1/documents', ({ request }) => {
      log(request);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const search = url.searchParams.get('search')?.toLowerCase();
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const items = db.documents
        .filter((d) => !status || d.status === status)
        .filter((d) => !search || d.name.toLowerCase().includes(search));
      return HttpResponse.json({
        items: items.slice(offset, offset + limit).map((d) => toListItem(db, d, true)),
        total: items.length,
        limit,
        offset,
      });
    }),
    http.post('/api/v1/projects/:projectId/documents', async ({ request, params }) => {
      const form = await request.formData();
      const file = form.get('file');
      log(request, { file: file instanceof File ? file.name : null });
      if (!(file instanceof File))
        return HttpResponse.json({ detail: 'file required' }, { status: 422 });
      const doc = addDocument(db, String(params.projectId), {
        name: file.name,
        size: file.size,
        format: file.name.endsWith('.docx')
          ? 'docx'
          : file.name.endsWith('.txt')
            ? 'txt'
            : 'markdown',
      });
      return HttpResponse.json(toResponse(doc), { status: 201 });
    }),
    http.get('/api/v1/projects/:projectId/documents/:documentId', ({ request, params }) => {
      log(request);
      const doc = db.documents.find((d) => d.id === params.documentId);
      return doc ? HttpResponse.json(toResponse(doc)) : notFound();
    }),
    http.delete('/api/v1/projects/:projectId/documents/:documentId', ({ request, params }) => {
      log(request);
      const doc = db.documents.find((d) => d.id === params.documentId);
      if (!doc) return notFound();
      if (doc.status === 'in_progress') {
        return HttpResponse.json({ detail: 'Документ анализируется' }, { status: 409 });
      }
      db.documents = db.documents.filter((d) => d.id !== doc.id);
      return new HttpResponse(null, { status: 204 });
    }),

    http.post('/api/v1/projects/:projectId/sources', async ({ request, params }) => {
      const body = (await request.json()) as {
        name: string;
        scope: 'project' | 'document';
        document_id?: string | null;
      };
      log(request, body);
      const source = addSource(db, String(params.projectId), {
        name: body.name,
        type: 'url',
        scope: body.scope,
        documentId: body.document_id ?? null,
      });
      return HttpResponse.json(stripSource(source), { status: 201 });
    }),
    http.post('/api/v1/projects/:projectId/sources/note', async ({ request, params }) => {
      const body = (await request.json()) as {
        name: string;
        scope: 'project' | 'document';
        document_id?: string | null;
      };
      log(request, body);
      const source = addSource(db, String(params.projectId), {
        name: body.name,
        type: 'file',
        scope: body.scope,
        documentId: body.document_id ?? null,
      });
      return HttpResponse.json(stripSource(source), { status: 201 });
    }),
    http.post('/api/v1/projects/:projectId/sources/file', async ({ request, params }) => {
      const form = await request.formData();
      const scope = form.get('scope') as 'project' | 'document';
      log(request, { name: form.get('name'), scope, document_id: form.get('document_id') });
      const source = addSource(db, String(params.projectId), {
        name: form.get('name') as string,
        type: 'file',
        scope,
        documentId: (form.get('document_id') as string | null) ?? null,
      });
      return HttpResponse.json(stripSource(source), { status: 201 });
    }),
    http.delete('/api/v1/projects/:projectId/sources/:sourceId', ({ request, params }) => {
      log(request);
      db.sources = db.sources.filter((s) => s.id !== params.sourceId);
      return new HttpResponse(null, { status: 204 });
    }),

    http.post(
      '/api/v1/projects/:projectId/documents/:documentId/analysis-jobs',
      async ({ request, params }) => {
        const body = (await request.json()) as { force?: boolean };
        log(request, body);
        const doc = db.documents.find((d) => d.id === params.documentId);
        if (!doc) return notFound();
        if (doc.status === 'ready' && !body.force) {
          return HttpResponse.json(
            { detail: { detail: 'Документ уже проверен', confirmation_required: true } },
            { status: 409 },
          );
        }
        const job = addJob(db, doc.id);
        doc.status = 'in_progress';
        doc.currentJobId = job.id;
        return HttpResponse.json(job, { status: 202 });
      },
    ),
    http.get(
      '/api/v1/projects/:projectId/documents/:documentId/analysis-jobs/:jobId',
      ({ request, params }) => {
        log(request);
        const job = db.jobs.find((j) => j.id === params.jobId);
        return job ? HttpResponse.json(job) : notFound();
      },
    ),
    http.delete(
      '/api/v1/projects/:projectId/documents/:documentId/analysis-jobs/:jobId',
      ({ request, params }) => {
        log(request);
        const job = db.jobs.find((j) => j.id === params.jobId);
        const doc = db.documents.find((d) => d.id === params.documentId);
        if (!job || !doc) return notFound();
        const cancellable = ['pending', 'dispatched', 'processing', 'cancelled'];
        if (!cancellable.includes(job.status)) {
          return HttpResponse.json(
            { detail: 'Завершённую задачу анализа отменить нельзя' },
            { status: 409 },
          );
        }
        job.status = 'cancelled';
        job.error_code = 'ANALYSIS_CANCELLED';
        job.error_message = 'Анализ отменён';
        doc.status = 'draft';
        return HttpResponse.json(job);
      },
    ),
    http.get('/api/v1/projects/:projectId/documents/:documentId/editor', ({ request, params }) => {
      log(request);
      const doc = db.documents.find((d) => d.id === params.documentId);
      if (!doc) return notFound();
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get('suggestions_limit') ?? 50);
      const offset = Number(url.searchParams.get('suggestions_offset') ?? 0);
      const list = suggestionsOf(db, doc);
      const content = {
        plain_text: doc.text,
        sections: doc.sections,
        blocks: doc.blocks,
        ...(doc.pages ? { pages: doc.pages } : {}),
      };
      const withResults = doc.status === 'awaiting_approval' || doc.status === 'ready';
      return HttpResponse.json({
        document: {
          id: doc.id,
          title: doc.name,
          format: doc.format,
          status: doc.status,
          current_analysis_job_id: doc.currentJobId,
          created_at: doc.uploadedAt,
          updated_at: doc.uploadedAt,
          review_version: doc.reviewVersion,
          view_mode: VIEW_MODES[doc.status],
        },
        content,
        original_content: content,
        suggestions: list.slice(offset, offset + limit),
        suggestions_total: list.length,
        flags: withResults ? flagsOf(db, doc) : [],
        suggestion_groups: groupsOf(list),
        counters: {
          ...countersOf(db, doc),
          flags_pending: withResults
            ? flagsOf(db, doc).filter((f) => f.status === 'pending').length
            : 0,
        },
        permissions: {
          can_analyze: doc.status !== 'in_progress',
          can_review: doc.status === 'awaiting_approval',
          can_export: doc.status === 'ready',
          can_delete: doc.status !== 'in_progress',
          sources_is_editable: !withResults && doc.status !== 'in_progress',
        },
      });
    }),
    http.get(
      '/api/v1/projects/:projectId/documents/:documentId/suggestions',
      ({ request, params }) => {
        log(request);
        const doc = db.documents.find((d) => d.id === params.documentId);
        if (!doc) return notFound();
        const url = new URL(request.url);
        const limit = Number(url.searchParams.get('limit') ?? 50);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        const list = suggestionsOf(db, doc);
        return HttpResponse.json({
          items: list.slice(offset, offset + limit),
          total: list.length,
          limit,
          offset,
        });
      },
    ),
    http.put(
      '/api/v1/projects/:projectId/documents/:documentId/suggestions/review',
      async ({ request, params }) => {
        const body = (await request.json()) as {
          review_version: number;
          decisions: { suggestion_id: string; decision: 'accepted' | 'rejected' }[];
          finalize: boolean;
        };
        log(request, body);
        const doc = db.documents.find((d) => d.id === params.documentId);
        if (!doc) return notFound();
        if (doc.status !== 'awaiting_approval') {
          return HttpResponse.json({ detail: 'Документ не ожидает утверждения' }, { status: 409 });
        }
        const ifMatch = request.headers.get('If-Match');
        if (ifMatch !== null && Number(ifMatch) !== doc.reviewVersion) {
          return HttpResponse.json(
            { detail: 'Документ изменён параллельным запросом. Обновите данные и повторите.' },
            { status: 412 },
          );
        }
        const list = suggestionsOf(db, doc);
        const targets = body.decisions.map((d) => list.find((s) => s.id === d.suggestion_id));
        if (targets.some((s) => !s || s.status !== 'pending')) {
          return HttpResponse.json(
            { detail: 'Часть правок не найдена в текущем анализе или уже обработана' },
            { status: 409 },
          );
        }
        const pendingAfter = list.filter((s) => s.status === 'pending').length - targets.length;
        if (body.finalize && pendingAfter > 0) {
          return HttpResponse.json(
            { detail: `Нельзя завершить ревью: осталось правок — ${pendingAfter}` },
            { status: 409 },
          );
        }
        body.decisions.forEach((d, i) => {
          const target = targets[i];
          if (target) target.status = d.decision;
        });
        doc.reviewVersion += 1;
        if (body.finalize) doc.status = 'ready';
        const counters = countersOf(db, doc);
        return HttpResponse.json({
          document_id: doc.id,
          document_status: doc.status,
          review_version: doc.reviewVersion,
          accepted_count: body.decisions.filter((d) => d.decision === 'accepted').length,
          rejected_count: body.decisions.filter((d) => d.decision === 'rejected').length,
          pending_count: counters.pending,
          finalized: body.finalize,
        });
      },
    ),
    http.patch(
      '/api/v1/projects/:projectId/documents/:documentId/suggestions',
      async ({ request, params }) => {
        const body = (await request.json()) as { ids: string[]; status: string };
        log(request, body);
        const doc = db.documents.find((d) => d.id === params.documentId);
        if (!doc) return notFound();
        const list = suggestionsOf(db, doc).filter((s) => body.ids.includes(s.id));
        if (body.status !== 'pending') {
          return HttpResponse.json({ detail: 'В тестах поддержан только сброс' }, { status: 400 });
        }
        list.forEach((s) => {
          s.status = 'pending';
        });
        if (doc.status === 'ready') doc.status = 'awaiting_approval';
        return HttpResponse.json({
          updated_count: list.length,
          document_status: doc.status,
          review_version: doc.reviewVersion,
        });
      },
    ),
    http.post(
      '/api/v1/projects/:projectId/documents/:documentId/editor/reset',
      ({ request, params }) => {
        log(request);
        const doc = db.documents.find((d) => d.id === params.documentId);
        if (!doc) return notFound();
        const list = suggestionsOf(db, doc);
        list.forEach((s) => {
          s.status = 'pending';
        });
        doc.status = 'awaiting_approval';
        const flags = flagsOf(db, doc);
        flags.forEach((f) => {
          f.status = 'pending';
          f.decided_by = null;
          f.decided_at = null;
        });
        return HttpResponse.json({
          document_id: doc.id,
          document_status: doc.status,
          review_version: doc.reviewVersion,
          suggestions_reset_count: list.length,
          flags_reset_count: flags.length,
        });
      },
    ),
    http.get('/api/v1/projects/:projectId/documents/:documentId/flags', ({ request, params }) => {
      log(request);
      const doc = db.documents.find((d) => d.id === params.documentId);
      if (!doc) return notFound();
      return HttpResponse.json(flagsOf(db, doc));
    }),
    http.patch(
      '/api/v1/projects/:projectId/documents/:documentId/flags/:flagId',
      async ({ request, params }) => {
        const body = (await request.json()) as { status: AnalysisFlagResponse['status'] };
        log(request, body);
        const doc = db.documents.find((d) => d.id === params.documentId);
        const flag = db.flags.find((f) => f.id === params.flagId && f.document_id === doc?.id);
        if (!doc || !flag) return notFound();
        // Как SyncBack: отмечать можно только при результатах анализа на руках.
        if (doc.status !== 'awaiting_approval' && doc.status !== 'ready') {
          return HttpResponse.json({ detail: 'Документ не в ревью' }, { status: 409 });
        }
        if (flag.status !== body.status) {
          flag.status = body.status;
          flag.decided_by = body.status === 'reviewed' ? TEST_USER.id : null;
          flag.decided_at = body.status === 'reviewed' ? '2026-09-10T10:00:00Z' : null;
        }
        return HttpResponse.json(flag);
      },
    ),
    http.get('/api/v1/projects/:projectId/documents/:documentId/export', ({ request, params }) => {
      log(request);
      const doc = db.documents.find((d) => d.id === params.documentId);
      if (!doc) return notFound();
      if (doc.status !== 'ready') {
        return HttpResponse.json(
          { detail: 'Экспорт доступен только для готового документа' },
          { status: 409 },
        );
      }
      return new HttpResponse(doc.text, {
        headers: {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="export.md"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        },
      });
    }),
    http.post('/api/v1/projects/:projectId/documents/:documentId/open', ({ request, params }) => {
      log(request);
      const doc = db.documents.find((d) => d.id === params.documentId);
      if (!doc) return notFound();
      doc.lastOpenedAt = new Date().toISOString();
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('/api/v1/dashboard', ({ request }) => {
      log(request);
      const total = db.documents.length;
      const awaiting = db.documents.filter((d) => d.status === 'awaiting_approval').length;
      const ready = db.documents.filter((d) => d.status === 'ready').length;
      const relevance = total === 0 ? 0 : (ready / total) * 100;
      const week = (value: number) =>
        Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${String(24 + i)}`, value }));
      return HttpResponse.json({
        total_documents: total,
        awaiting_approval_count: awaiting,
        ready_count: ready,
        relevance_percent: relevance,
        total_trend: week(total),
        awaiting_trend: week(awaiting),
        relevance_trend: week(relevance),
      });
    }),
    http.get('/api/v1/documents/attention', ({ request }) => {
      log(request);
      return HttpResponse.json(
        db.documents
          .filter((d) => d.status === 'awaiting_approval')
          .sort((a, b) => b.suggestions.pending - a.suggestions.pending)
          .slice(0, 4)
          .map((d) => ({
            id: d.id,
            title: d.name,
            project_id: d.projectId,
            project_name: db.projects.find((p) => p.id === d.projectId)?.name ?? '',
            pending_suggestions: d.suggestions.pending,
            updated_at: d.uploadedAt,
          })),
      );
    }),
    http.get('/api/v1/documents/recent', ({ request }) => {
      log(request);
      return HttpResponse.json(
        db.documents
          .filter((d): d is DbDocument & { lastOpenedAt: string } => d.lastOpenedAt !== null)
          .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
          .slice(0, 5)
          .map((d) => ({
            id: d.id,
            title: d.name,
            project_id: d.projectId,
            project_name: db.projects.find((p) => p.id === d.projectId)?.name ?? '',
            status: d.status,
            uploaded_at: d.uploadedAt,
            last_opened_at: d.lastOpenedAt,
            suggestions_total: d.suggestions.total,
            suggestions_resolved: d.suggestions.accepted + d.suggestions.rejected,
          })),
      );
    }),
    http.post('/api/v1/projects/:projectId/documents/analysis-jobs/bulk', async ({ request }) => {
      const body = (await request.json()) as { document_ids: string[]; force: boolean };
      log(request, body);
      const results = body.document_ids.map((documentId) => {
        const doc = db.documents.find((d) => d.id === documentId);
        if (!doc) return { document_id: documentId, job: null, skip_reason: 'not_found' as const };
        if (doc.status === 'ready' && !body.force) {
          return {
            document_id: documentId,
            job: null,
            skip_reason: 'confirmation_required' as const,
          };
        }
        const job = addJob(db, doc.id);
        doc.status = 'in_progress';
        doc.currentJobId = job.id;
        return { document_id: documentId, job, skip_reason: null };
      });
      return HttpResponse.json({
        started: results.filter((r) => r.job).length,
        skipped: results.filter((r) => !r.job).length,
        confirmation_required: results.filter((r) => r.skip_reason === 'confirmation_required')
          .length,
        results,
      });
    }),
  ];
}
