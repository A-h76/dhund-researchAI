const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GAP-CLAIM-ARG-01 — argument JSONB may contain decorative copies of claim ids,
 * but membership is only those rows present in argument_claim_links.
 */
export function embeddedClaimIds(structure: unknown): readonly string[] {
  const found = new Set<string>();
  walk(structure, found);
  return [...found];
}

export function jsonbOnlyClaimIds(
  structure: unknown,
  relationalClaimIds: readonly string[],
): readonly string[] {
  const linked = new Set(relationalClaimIds);
  return embeddedClaimIds(structure).filter((id) => !linked.has(id));
}

export function relationalReachability(input: {
  structure: unknown;
  relationalClaimIds: readonly string[];
}): {
  readonly relationalClaimIds: readonly string[];
  readonly jsonbOnlyClaimIds: readonly string[];
  readonly passes: boolean;
} {
  const jsonbOnly = jsonbOnlyClaimIds(input.structure, input.relationalClaimIds);
  return {
    relationalClaimIds: input.relationalClaimIds,
    jsonbOnlyClaimIds: jsonbOnly,
    passes: jsonbOnly.length === 0,
  };
}

function walk(node: unknown, found: Set<string>): void {
  if (typeof node === 'string' && UUID_RE.test(node)) {
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const entry of node) {
      if (typeof entry === 'string' && UUID_RE.test(entry)) {
        found.add(entry);
      } else {
        walk(entry, found);
      }
    }
    return;
  }

  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === 'provenance') {
      continue;
    }
    if ((key === 'claimId' || key === 'id') && typeof value === 'string' && UUID_RE.test(value)) {
      if (key === 'claimId' || looksLikeClaimCollection(record)) {
        found.add(value);
      }
      continue;
    }
    if (key === 'claimIds' || key === 'claims' || key === 'claim_ids') {
      walk(value, found);
      continue;
    }
    walk(value, found);
  }
}

function looksLikeClaimCollection(record: Record<string, unknown>): boolean {
  return typeof record.text === 'string' || typeof record.claimId === 'string';
}
