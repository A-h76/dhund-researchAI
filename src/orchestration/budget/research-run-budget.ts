/**
 * ResearchRun budget: reserve → debit → cap at dispatch boundaries (DHB-66).
 *
 * Soft-reserve uses per-step ceiling × in-flight so overage stays bounded by
 * `inFlight × perStepCeiling` when the cap trips. Cap is never enforced mid-step.
 * Integer bigint micros only — floats in this path are a test failure.
 */

import { MoneyMicrosError } from '../../platform/money';

/**
 * Worst-case cost charged to a single research-run step. Bounds overage when
 * in-flight work finishes after a PAUSED_BUDGET transition.
 * Must be ≥ any real step's costMicros for the overage formula to hold.
 */
export const RESEARCH_RUN_PER_STEP_CEILING_MICROS = 100_000n;

export interface ResearchRunBudgetSnapshot {
  readonly reservedMicros: bigint;
  readonly consumedMicros: bigint;
  readonly inFlight: number;
  readonly perStepCeilingMicros: bigint;
}

export function assertIntegerMicrosBigInt(value: unknown): asserts value is bigint {
  if (typeof value !== 'bigint') {
    throw new MoneyMicrosError(
      'Budget values must be integer bigint micros; float/fractional values are forbidden',
    );
  }
  if (value < 0n) {
    throw new MoneyMicrosError('Budget micros must be non-negative');
  }
}

/** Rejects number floats / non-integers before they enter the bigint budget path. */
export function microsFromIntegerNumber(value: unknown): bigint {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw new MoneyMicrosError(
      'Budget values must be integer micros; float/fractional values are forbidden',
    );
  }
  if (value < 0) {
    throw new MoneyMicrosError('Budget micros must be non-negative');
  }
  return BigInt(value);
}

export function addBudgetMicros(a: bigint, b: bigint): bigint {
  assertIntegerMicrosBigInt(a);
  assertIntegerMicrosBigInt(b);
  return a + b;
}

export function subtractBudgetMicros(a: bigint, b: bigint): bigint {
  assertIntegerMicrosBigInt(a);
  assertIntegerMicrosBigInt(b);
  const difference = a - b;
  if (difference < 0n) {
    throw new MoneyMicrosError('Budget micros subtraction underflow');
  }
  return difference;
}

/** Soft hold already committed by in-flight (DISPATCHED + RUNNING) steps. */
export function softReservedMicros(
  inFlight: number,
  perStepCeilingMicros: bigint = RESEARCH_RUN_PER_STEP_CEILING_MICROS,
): bigint {
  if (!Number.isInteger(inFlight) || inFlight < 0) {
    throw new MoneyMicrosError('inFlight must be a non-negative integer');
  }
  assertIntegerMicrosBigInt(perStepCeilingMicros);
  return BigInt(inFlight) * perStepCeilingMicros;
}

/**
 * True when one more step can be soft-reserved without exceeding the run cap
 * under worst-case per-step ceiling charges.
 */
export function canReserveDispatch(input: ResearchRunBudgetSnapshot): boolean {
  assertIntegerMicrosBigInt(input.reservedMicros);
  assertIntegerMicrosBigInt(input.consumedMicros);
  assertIntegerMicrosBigInt(input.perStepCeilingMicros);
  if (!Number.isInteger(input.inFlight) || input.inFlight < 0) {
    throw new MoneyMicrosError('inFlight must be a non-negative integer');
  }

  const committed = addBudgetMicros(
    input.consumedMicros,
    softReservedMicros(input.inFlight, input.perStepCeilingMicros),
  );
  return committed + input.perStepCeilingMicros <= input.reservedMicros;
}

/** Cap already breached by recorded consumption (debit projection). */
export function isBudgetCapReached(reservedMicros: bigint, consumedMicros: bigint): boolean {
  assertIntegerMicrosBigInt(reservedMicros);
  assertIntegerMicrosBigInt(consumedMicros);
  return consumedMicros >= reservedMicros;
}

export function measuredOverageMicros(reservedMicros: bigint, consumedMicros: bigint): bigint {
  assertIntegerMicrosBigInt(reservedMicros);
  assertIntegerMicrosBigInt(consumedMicros);
  return consumedMicros > reservedMicros ? consumedMicros - reservedMicros : 0n;
}

export function maxBoundedOverageMicros(
  inFlight: number,
  perStepCeilingMicros: bigint = RESEARCH_RUN_PER_STEP_CEILING_MICROS,
): bigint {
  return softReservedMicros(inFlight, perStepCeilingMicros);
}

export function isOverageWithinBound(
  overageMicros: bigint,
  inFlight: number,
  perStepCeilingMicros: bigint = RESEARCH_RUN_PER_STEP_CEILING_MICROS,
): boolean {
  assertIntegerMicrosBigInt(overageMicros);
  return overageMicros <= maxBoundedOverageMicros(inFlight, perStepCeilingMicros);
}
