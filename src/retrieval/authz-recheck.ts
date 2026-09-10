/**
 * Post-fusion authorization re-check (DHB-56). Drops candidates whose
 * project_id is not the PATH project. Defence in depth — not eligibility.
 */
export function authzRecheck<T extends { readonly projectId: string }>(
  candidates: readonly T[],
  projectId: string,
): T[] {
  return candidates.filter((candidate) => candidate.projectId === projectId);
}
