import {
  canTransitionResearchRun,
  RESEARCH_RUN_NON_TERMINAL_STATES,
  RESEARCH_RUN_STATES,
  RESEARCH_RUN_STATE_TRANSITIONS,
  RESEARCH_RUN_TERMINAL_STATES,
} from '../../src/l0/ports/research-run-state';

describe('ResearchRun state machine (DHB-64 §6.1)', () => {
  const allowedPairs: Array<readonly [string, string]> = [];
  for (const from of RESEARCH_RUN_STATES) {
    for (const to of RESEARCH_RUN_STATE_TRANSITIONS[from]) {
      allowedPairs.push([from, to]);
    }
  }

  it('enumerates every allowed transition and accepts it', () => {
    expect(allowedPairs.length).toBeGreaterThan(0);
    for (const [from, to] of allowedPairs) {
      expect(canTransitionResearchRun(from as never, to as never)).toBe(true);
    }
  });

  it('rejects every forbidden transition exhaustively', () => {
    const forbidden: Array<readonly [string, string]> = [];
    for (const from of RESEARCH_RUN_STATES) {
      for (const to of RESEARCH_RUN_STATES) {
        if (!canTransitionResearchRun(from, to)) {
          forbidden.push([from, to]);
        }
      }
    }

    // |states|² − |allowed| = forbidden (includes same-state, which is rejected)
    expect(forbidden.length).toBe(
      RESEARCH_RUN_STATES.length * RESEARCH_RUN_STATES.length - allowedPairs.length,
    );

    for (const [from, to] of forbidden) {
      expect(canTransitionResearchRun(from as never, to as never)).toBe(false);
    }
  });

  it('rejects backward and terminal escapes and known forbidden edges', () => {
    expect(canTransitionResearchRun('RUNNING', 'COMPLETED')).toBe(false);
    expect(canTransitionResearchRun('RUNNING', 'PLANNING')).toBe(false);
    expect(canTransitionResearchRun('PLANNING', 'PAUSED_BUDGET')).toBe(false);
    expect(canTransitionResearchRun('PLANNING', 'PAUSED_MANUAL')).toBe(false);
    expect(canTransitionResearchRun('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransitionResearchRun('FAILED', 'PLANNING')).toBe(false);
    expect(canTransitionResearchRun('CANCELLED', 'CREATED')).toBe(false);
    expect(canTransitionResearchRun('COMPLETED_PARTIAL', 'COMPLETING')).toBe(false);
  });

  it('allows cancel from every non-terminal state', () => {
    for (const from of RESEARCH_RUN_NON_TERMINAL_STATES) {
      expect(canTransitionResearchRun(from, 'CANCELLED')).toBe(true);
    }
  });

  it('treats terminal states as sinks', () => {
    for (const terminal of RESEARCH_RUN_TERMINAL_STATES) {
      expect(RESEARCH_RUN_STATE_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it('allows only PLANNING → FAILED among failure entries', () => {
    for (const from of RESEARCH_RUN_STATES) {
      const allowed = canTransitionResearchRun(from, 'FAILED');
      expect(allowed).toBe(from === 'PLANNING');
    }
  });
});
