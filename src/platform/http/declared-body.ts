/** Keep only declared keys. Undeclared fields are dropped and never returned. */
export function pickDeclared<K extends string>(
  body: Record<string, unknown>,
  keys: readonly K[],
): Pick<Record<string, unknown>, K> {
  const out = {} as Pick<Record<string, unknown>, K>;
  for (const key of keys) {
    if (key in body) {
      out[key] = body[key];
    }
  }
  return out;
}
