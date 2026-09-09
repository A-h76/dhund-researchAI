export function pickDto<T extends Record<string, unknown>, const K extends readonly (keyof T)[]>(
  row: T,
  keys: K,
): { [P in K[number]]: T[P] } {
  const out = {} as { [P in K[number]]: T[P] };
  for (const key of keys) {
    out[key] = row[key];
  }
  return out;
}
