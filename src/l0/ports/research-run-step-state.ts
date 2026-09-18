/**
 * ResearchRunStep state machine (Phase 7 §5 / DHB-65).
 *
 * DEFERRED at run termination is reported as skipped, not failed.
 */

export const RESEARCH_STEP_STATES = [
  'PENDING',
  'READY',
  'DISPATCHED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'DEFERRED',
  'CANCELLED',
] as const;

export type ResearchStepStateName = (typeof RESEARCH_STEP_STATES)[number];

export const RESEARCH_STEP_TERMINAL_STATES = [
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly ResearchStepStateName[];

export type ResearchStepTerminalState = (typeof RESEARCH_STEP_TERMINAL_STATES)[number];

export const RESEARCH_STEP_STATE_TRANSITIONS: Readonly<
  Record<ResearchStepStateName, readonly ResearchStepStateName[]>
> = {
  PENDING: ['READY', 'DEFERRED', 'CANCELLED'],
  READY: ['DISPATCHED', 'DEFERRED', 'CANCELLED'],
  DISPATCHED: ['RUNNING', 'READY', 'FAILED', 'CANCELLED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: [],
  DEFERRED: ['PENDING', 'READY', 'CANCELLED'],
  CANCELLED: [],
};

export function isResearchStepState(value: string): value is ResearchStepStateName {
  return (RESEARCH_STEP_STATES as readonly string[]).includes(value);
}

export function isResearchStepTerminal(
  state: ResearchStepStateName,
): state is ResearchStepTerminalState {
  return (RESEARCH_STEP_TERMINAL_STATES as readonly string[]).includes(state);
}

export function canTransitionResearchStep(
  from: ResearchStepStateName,
  to: ResearchStepStateName,
): boolean {
  if (from === to) {
    return false;
  }
  return RESEARCH_STEP_STATE_TRANSITIONS[from].includes(to);
}
