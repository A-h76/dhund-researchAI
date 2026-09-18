export class EmptyRetrievalQueryError extends Error {
  constructor() {
    super('retrieval query must be non-empty');
    this.name = 'EmptyRetrievalQueryError';
  }
}

export interface UnderstoodQuery {
  readonly text: string;
}

/** Normalize the raw query before both arms. No rewrite or expansion in v1. */
export function understandQuery(raw: string): UnderstoodQuery {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text.length === 0) {
    throw new EmptyRetrievalQueryError();
  }
  return { text };
}
