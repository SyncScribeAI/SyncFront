import { client, ok } from '../client';
import type { SourceSnapshotContent } from '../types';

/** Текст снимка источника: по нему считаются смещения оснований правок. */
export async function getSnapshotContent(
  projectId: string,
  snapshotId: string,
): Promise<SourceSnapshotContent> {
  return ok(
    await client.GET('/api/v1/projects/{project_id}/source-snapshots/{snapshot_id}/content', {
      params: { path: { project_id: projectId, snapshot_id: snapshotId } },
    }),
  );
}
