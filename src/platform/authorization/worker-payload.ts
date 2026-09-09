import { notFound } from '../errors';
import type { AccessContext } from './access-context';

const MODULE = 'worker';

export function assertWorkerPayloadScope(
  payload: { readonly orgId?: string; readonly projectId?: string },
  context: AccessContext,
): void {
  if (typeof payload.projectId === 'string') {
    const project = context.projects.find(
      (row) => row.projectId === payload.projectId,
    );
    if (project === undefined) {
      throw notFound({ module: MODULE });
    }
    if (
      typeof payload.orgId === 'string' &&
      payload.orgId !== project.orgId
    ) {
      throw notFound({ module: MODULE });
    }
    return;
  }

  if (typeof payload.orgId === 'string') {
    const org = context.orgs.find((row) => row.orgId === payload.orgId);
    if (org === undefined) {
      throw notFound({ module: MODULE });
    }
  }
}
