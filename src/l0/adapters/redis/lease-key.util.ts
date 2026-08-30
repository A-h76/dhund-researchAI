export function buildLeaseKey(scope: string, key: string): string {
  return `lease:${scope}:${key}`;
}
