export type BreachListVerdict = 'breached' | 'clear' | 'unavailable';

export interface BreachListPort {
  check(password: string): Promise<BreachListVerdict>;
}
