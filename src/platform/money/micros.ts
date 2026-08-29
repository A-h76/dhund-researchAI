/**
 * Money/cost as integer micros (1 unit = 1_000_000 micros).
 * Float/Decimal in the cost path is forbidden (DHB-28).
 */

export class MoneyMicrosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyMicrosError';
  }
}

export function assertIntegerMicros(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MoneyMicrosError(
      'Cost values must be integer micros; float/fractional values are forbidden',
    );
  }
}

export function toMicros(units: number): number {
  if (typeof units !== 'number' || !Number.isFinite(units)) {
    throw new MoneyMicrosError('units must be a finite number');
  }
  if (!Number.isInteger(units)) {
    throw new MoneyMicrosError(
      'Cost values must be integer micros; float/fractional values are forbidden',
    );
  }

  const micros = units * 1_000_000;
  assertIntegerMicros(micros);
  return micros;
}

export function addMicros(a: number, b: number): number {
  assertIntegerMicros(a);
  assertIntegerMicros(b);
  const sum = a + b;
  assertIntegerMicros(sum);
  return sum;
}

export function subtractMicros(a: number, b: number): number {
  assertIntegerMicros(a);
  assertIntegerMicros(b);
  const difference = a - b;
  assertIntegerMicros(difference);
  return difference;
}
