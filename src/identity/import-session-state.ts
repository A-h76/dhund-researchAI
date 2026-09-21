/**
 * Reference-manager import session state machine (Phase 7 / DHB-71).
 */
export type ImportSessionLifecycle =
  | 'CREATED'
  | 'PARSING'
  | 'ADMITTING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED';

export const IMPORT_SESSION_TRANSITIONS: Readonly<
  Record<ImportSessionLifecycle, readonly ImportSessionLifecycle[]>
> = {
  CREATED: ['PARSING', 'CANCELLED', 'FAILED'],
  PARSING: ['ADMITTING', 'FAILED', 'CANCELLED'],
  ADMITTING: ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  PARTIAL: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionImportSession(
  from: ImportSessionLifecycle,
  to: ImportSessionLifecycle,
): boolean {
  if (from === to) {
    return true;
  }
  return IMPORT_SESSION_TRANSITIONS[from].includes(to);
}
