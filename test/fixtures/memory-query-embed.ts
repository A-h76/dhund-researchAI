import type { QueryEmbedInput, QueryEmbedPort } from '../../src/retrieval/query-embed.port';

export class MemoryQueryEmbed implements QueryEmbedPort {
  vectorLiteral = `[${Array.from({ length: 1024 }, () => 0.01).join(',')}]`;
  lastInput: QueryEmbedInput | undefined;

  embedQuery(input: QueryEmbedInput): Promise<string> {
    this.lastInput = input;
    return Promise.resolve(this.vectorLiteral);
  }
}
