import type { AppConfig } from './app-config.types';

export interface EmbeddingSchemaMetadata {
  readonly columnDimension?: number;
}

export function assertEmbeddingPolicy(
  config: AppConfig,
  schema: EmbeddingSchemaMetadata | undefined,
): void {
  if (schema?.columnDimension === undefined) {
    return;
  }

  if (config.embeddingDimension !== schema.columnDimension) {
    throw new Error(
      `EMBEDDING_DIMENSION (${String(config.embeddingDimension)}) does not match schema column dimension (${String(schema.columnDimension)})`,
    );
  }
}
