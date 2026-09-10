const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Okapi BM25 over candidate texts. Used when Gateway RERANK is down. */
export function bm25Scores(query: string, documents: readonly string[]): number[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || documents.length === 0) {
    return documents.map(() => 0);
  }

  const tokenized = documents.map(tokenize);
  const avgdl =
    tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / tokenized.length;
  const df = documentFrequencies(queryTerms, tokenized);
  const n = tokenized.length;

  return tokenized.map((tokens) => {
    const tf = termFrequencies(tokens);
    const dl = tokens.length;
    let score = 0;
    for (const term of queryTerms) {
      const freq = tf.get(term) ?? 0;
      if (freq === 0) {
        continue;
      }
      const idf = Math.log((n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5) + 1);
      const denom = freq + BM25_K1 * (1 - BM25_B + BM25_B * (dl / Math.max(avgdl, 1)));
      score += idf * ((freq * (BM25_K1 + 1)) / denom);
    }
    return score;
  });
}

function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

function documentFrequencies(
  queryTerms: readonly string[],
  documents: readonly (readonly string[])[],
): Map<string, number> {
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const tokens of documents) {
      if (tokens.includes(term)) {
        count += 1;
      }
    }
    df.set(term, count);
  }
  return df;
}
