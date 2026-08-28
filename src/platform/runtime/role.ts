export enum RuntimeRole {
  Api = 'api',
  Worker = 'worker',
}

const VALID_ROLES = new Set<string>(Object.values(RuntimeRole));

export function parseRole(argv: string[]): RuntimeRole {
  for (const arg of argv) {
    if (arg.startsWith('--role=')) {
      const raw = arg.slice('--role='.length);
      if (!VALID_ROLES.has(raw)) {
        throw new Error(`Invalid role "${raw}". Expected --role=api or --role=worker`);
      }
      return raw as RuntimeRole;
    }
  }

  const roleIndex = argv.indexOf('--role');
  if (roleIndex === -1 || roleIndex === argv.length - 1) {
    throw new Error('Missing required argument: --role=api|worker');
  }

  const raw = argv[roleIndex + 1];
  if (!VALID_ROLES.has(raw)) {
    throw new Error(`Invalid role "${raw}". Expected --role=api or --role=worker`);
  }

  return raw as RuntimeRole;
}
