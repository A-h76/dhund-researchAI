/**
 * Applies Prisma connection_limit without logging or returning secrets.
 */
export function withPrismaPoolSize(databaseUrl: string, poolSize: number): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', String(poolSize));
  return url.toString();
}

export function readPrismaPoolSize(databaseUrl: string): number | null {
  try {
    const url = new URL(databaseUrl);
    const raw = url.searchParams.get('connection_limit');
    if (raw === null) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
