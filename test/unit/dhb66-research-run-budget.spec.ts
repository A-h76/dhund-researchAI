import {
  RESEARCH_RUN_PER_STEP_CEILING_MICROS,
  addBudgetMicros,
  assertIntegerMicrosBigInt,
  canReserveDispatch,
  isBudgetCapReached,
  isOverageWithinBound,
  measuredOverageMicros,
  maxBoundedOverageMicros,
  microsFromIntegerNumber,
  softReservedMicros,
  subtractBudgetMicros,
} from '../../src/orchestration/budget/research-run-budget';
import { MoneyMicrosError } from '../../src/platform/money';

describe('ResearchRun budget arithmetic (DHB-66)', () => {
  it('keeps integer bigint micros end to end', () => {
    expect(RESEARCH_RUN_PER_STEP_CEILING_MICROS).toBe(100_000n);
    expect(addBudgetMicros(100n, 50n)).toBe(150n);
    expect(subtractBudgetMicros(100n, 40n)).toBe(60n);
    expect(softReservedMicros(3, 100n)).toBe(300n);
    expect(maxBoundedOverageMicros(2, 100n)).toBe(200n);
  });

  it('rejects floats anywhere in the budget path', () => {
    expect(() => microsFromIntegerNumber(1.5)).toThrow(MoneyMicrosError);
    expect(() => microsFromIntegerNumber(Number.NaN)).toThrow(MoneyMicrosError);
    expect(() => assertIntegerMicrosBigInt(1.5 as unknown as bigint)).toThrow(
      MoneyMicrosError,
    );
    expect(() => softReservedMicros(1.5 as unknown as number, 10n)).toThrow(
      MoneyMicrosError,
    );
    expect(() =>
      canReserveDispatch({
        reservedMicros: 100n,
        consumedMicros: 0n,
        inFlight: 0.5 as unknown as number,
        perStepCeilingMicros: 10n,
      }),
    ).toThrow(MoneyMicrosError);
  });

  it('reserves dispatch only while worst-case in-flight fit under the cap', () => {
    const ceiling = 100n;
    expect(
      canReserveDispatch({
        reservedMicros: 250n,
        consumedMicros: 0n,
        inFlight: 0,
        perStepCeilingMicros: ceiling,
      }),
    ).toBe(true);
    expect(
      canReserveDispatch({
        reservedMicros: 250n,
        consumedMicros: 0n,
        inFlight: 2,
        perStepCeilingMicros: ceiling,
      }),
    ).toBe(false);
    expect(isBudgetCapReached(250n, 250n)).toBe(true);
    expect(isBudgetCapReached(250n, 249n)).toBe(false);
  });

  it('bounds measured overage by inFlight × per-step ceiling', () => {
    const inFlight = 3;
    const ceiling = 100n;
    const overage = measuredOverageMicros(1000n, 1250n);
    expect(overage).toBe(250n);
    expect(isOverageWithinBound(overage, inFlight, ceiling)).toBe(true);
    expect(isOverageWithinBound(301n, inFlight, ceiling)).toBe(false);
  });
});
