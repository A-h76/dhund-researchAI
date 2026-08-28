import { buildTestAppConfig } from '../fixtures/app-config.fixture';
import { assertEmbeddingPolicy } from '../../src/platform/config';

describe('embedding policy hook', () => {
  it('no-ops when schema metadata is absent', () => {
    expect(() =>
      assertEmbeddingPolicy(buildTestAppConfig({ embeddingDimension: 1536 }), undefined),
    ).not.toThrow();
  });

  it('rejects a future dimension mismatch', () => {
    expect(() =>
      assertEmbeddingPolicy(buildTestAppConfig({ embeddingDimension: 1536 }), {
        columnDimension: 3072,
      }),
    ).toThrow('EMBEDDING_DIMENSION (1536) does not match schema column dimension (3072)');
  });
});
