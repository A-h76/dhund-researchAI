import {
  MoneyMicrosError,
  addMicros,
  assertIntegerMicros,
  subtractMicros,
  toMicros,
} from '../../src/platform/money';

describe('money micros (DHB-28)', () => {
  it('converts integer units to micros', () => {
    expect(toMicros(2)).toBe(2_000_000);
  });

  it('adds and subtracts integer micros', () => {
    expect(addMicros(100, 50)).toBe(150);
    expect(subtractMicros(100, 40)).toBe(60);
  });

  it('rejects float input in the cost path', () => {
    expect(() => assertIntegerMicros(1.5)).toThrow(MoneyMicrosError);
    expect(() => toMicros(1.5)).toThrow(MoneyMicrosError);
    expect(() => addMicros(1.5 as unknown as number, 1)).toThrow(MoneyMicrosError);
    expect(() => subtractMicros(10, 0.5 as unknown as number)).toThrow(
      MoneyMicrosError,
    );
  });
});
