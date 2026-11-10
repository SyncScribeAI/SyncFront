import { client, ok } from '../client';
import type { AnalysisFlagResponse, PatchFlagRequest } from '../types';

const path = (projectId: string, documentId: string) => ({
  project_id: projectId,
  document_id: documentId,
});

/** Флаги текущего анализа. Редактор получает их в агрегате; отдельный список — для перечитывания. */
export async function listFlags(
  projectId: string,
  documentId: string,
): Promise<AnalysisFlagResponse[]> {
  return ok(
    await client.GET('/api/v1/projects/{project_id}/documents/{document_id}/flags', {
      params: { path: path(projectId, documentId) },
    }),
  );
}

/** Отметка «просмотрено» или её снятие; повтор того же статуса сервер принимает без ошибки. */
export async function patchFlag(
  projectId: string,
  documentId: string,
  flagId: string,
  status: PatchFlagRequest['status'],
): Promise<AnalysisFlagResponse> {
  return ok(
    await client.PATCH('/api/v1/projects/{project_id}/documents/{document_id}/flags/{flag_id}', {
      params: { path: { ...path(projectId, documentId), flag_id: flagId } },
      body: { status },
    }),
  );
}
