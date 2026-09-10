import type { QueryRerankInput, QueryRerankPort, QueryRerankResult } from '../../src/retrieval/rerank.port';

export class MemoryRerank implements QueryRerankPort {
  method: 'llm' | 'deterministic' = 'llm';
  unavailable = false;
  lastInput: QueryRerankInput | undefined;
  scores: number[] | undefined;
  aiExecutionId = 'rerank-exec-1';

  rerank(input: QueryRerankInput): Promise<QueryRerankResult> {
    this.lastInput = input;
    if (this.unavailable) {
      return Promise.reject(new Error('rerank down'));
    }
    const scores =
      this.scores ?? input.candidates.map((_, index) => input.candidates.length - index);
    return Promise.resolve({
      scores,
      method: this.method,
      aiExecutionId: this.aiExecutionId,
    });
  }
}
