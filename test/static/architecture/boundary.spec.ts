import { join } from 'node:path';
import {
  collectFiles,
  findCoverageVocabularyViolations,
  findGuardViolations,
  findImportDirectionViolations,
  findPhiFixtureViolations,
  findProviderStringViolations,
  findRawProviderHttpViolations,
  findSchemaViolations,
  findSingleOwnerViolations,
  repoRoot,
  srcFiles,
  type SourceFile,
} from './conformance';

const ROOT = repoRoot();

function treeFiles(): SourceFile[] {
  return [
    ...srcFiles(),
    ...collectFiles(join(ROOT, 'prisma')),
    ...collectFiles(join(ROOT, 'test')).filter(
      (file) => !file.path.startsWith('test/static/architecture/'),
    ),
  ];
}

describe('single-owner', () => {
  it('has one retrieval service, AI gateway, cost ledger, coordinator, and ingestion pipeline', () => {
    expect(findSingleOwnerViolations(srcFiles())).toEqual([]);
  });

  it('fails when a second retrieval service is added', () => {
    const poisoned = [
      ...srcFiles(),
      {
        path: 'src/retrieval/second-retrieval.service.ts',
        content: 'export class SecondRetrievalService implements IRetrievalService {}',
      },
    ];
    expect(findSingleOwnerViolations(poisoned)).toEqual([
      'retrieval service: expected 1 owner, found 2 (src/retrieval/retrieval.service.ts, src/retrieval/second-retrieval.service.ts)',
    ]);
  });
});

describe('gateway isolation §11a.2a tests 2 and 3', () => {
  it('has no provider or model string outside adapters and policy', () => {
    expect(findProviderStringViolations(srcFiles())).toEqual([]);
  });

  it('fails when a provider model string is introduced outside adapters', () => {
    expect(
      findProviderStringViolations([
        { path: 'src/retrieval/bypass.ts', content: "const model = 'gpt-4o-mini';" },
      ]),
    ).toEqual(['src/retrieval/bypass.ts: \\bgpt-']);
  });

  it('has no raw fetch, axios, or undici call to a provider host outside adapters', () => {
    expect(findRawProviderHttpViolations(srcFiles())).toEqual([]);
  });

  it('fails when a raw provider host request skips the SDK lint', () => {
    expect(
      findRawProviderHttpViolations([
        {
          path: 'src/orchestration/bypass.ts',
          content: "await fetch('https://api.openai.com/v1/chat/completions');",
        },
      ]),
    ).toEqual(['src/orchestration/bypass.ts']);
  });
});

describe('import direction', () => {
  it('has no upward layer imports', () => {
    expect(findImportDirectionViolations(srcFiles())).toEqual([]);
  });

  it('fails when a lower layer imports a higher layer', () => {
    expect(
      findImportDirectionViolations([
        {
          path: 'src/projects/bad-import.example.ts',
          content: "import { IngestionModule } from '@ingestion/ingestion.module';",
        },
      ]),
    ).toEqual(['src/projects/bad-import.example.ts: projects imports ingestion (@ingestion/ingestion.module)']);
  });
});

describe('guard coverage', () => {
  it('gives every non-public route an auth guard and every project route @RequireProjectRole', () => {
    expect(findGuardViolations(srcFiles())).toEqual([]);
  });

  it('fails when a guard is removed from a route', () => {
    expect(
      findGuardViolations([
        {
          path: 'src/projects/projects.controller.ts',
          content: `
            @Controller('v1/projects')
            export class ProjectsController {
              @Get(':projectId')
              get() { return {}; }
            }
          `,
        },
      ]),
    ).toEqual([
      'missing @RequireProjectRole: GET /v1/projects/:projectId (src/projects/projects.controller.ts)',
      'missing auth guard: GET /v1/projects/:projectId (src/projects/projects.controller.ts)',
    ]);
  });
});

describe('schema assertions', () => {
  const schemaFiles = () => collectFiles(join(ROOT, 'prisma'));

  it('rejects a research_run_presets table, PHI columns, and a non-1024 cosine vector', () => {
    expect(findSchemaViolations(schemaFiles())).toEqual([]);
  });

  it('fails when a research_run_presets table is introduced', () => {
    const poisoned = [
      ...schemaFiles(),
      {
        path: 'prisma/migrations/bad/migration.sql',
        content: 'CREATE TABLE "research_run_presets" (id int);',
      },
    ];
    expect(findSchemaViolations(poisoned)).toContain(
      'prisma/migrations/bad/migration.sql: research_run_presets table',
    );
  });

  it('fails when a PHI column is introduced', () => {
    const poisoned = [
      ...schemaFiles(),
      {
        path: 'prisma/migrations/bad/migration.sql',
        content: 'ALTER TABLE documents ADD COLUMN mrn text;',
      },
    ];
    expect(findSchemaViolations(poisoned).some((hit) => hit.includes('PHI column'))).toBe(true);
  });

  it('fails when chunk_embeddings.vector drops vector_cosine_ops', () => {
    const poisoned = schemaFiles().map((file) =>
      file.path.includes('_010_')
        ? { ...file, content: file.content.replace(/vector_cosine_ops/g, 'vector_l2_ops') }
        : file,
    );
    expect(findSchemaViolations(poisoned)).toContain(
      'chunk_embeddings.vector is not VECTOR(1024) with vector_cosine_ops',
    );
  });
});

describe('coverage vocabulary', () => {
  it('does not use corpus, and does not place stepOutcomes inside coverage', () => {
    expect(findCoverageVocabularyViolations(treeFiles())).toEqual([]);
  });

  it('fails when corpus is introduced', () => {
    expect(
      findCoverageVocabularyViolations([
        { path: 'src/retrieval/naming.ts', content: 'export const corpus = [];' },
      ]),
    ).toEqual(['src/retrieval/naming.ts: corpus']);
  });

  it('fails when stepOutcomes appears inside coverage', () => {
    expect(
      findCoverageVocabularyViolations([
        {
          path: 'src/orchestration/coverage.ts',
          content: 'export interface Coverage { stepOutcomes: string[]; }',
        },
      ]),
    ).toEqual(['src/orchestration/coverage.ts: stepOutcomes inside coverage']);
  });
});

describe('fixture lint', () => {
  it('has no PHI-shaped data in test fixtures', () => {
    expect(findPhiFixtureViolations(collectFiles(join(ROOT, 'test', 'fixtures')))).toEqual([]);
  });

  it('fails when a fixture contains a PHI-shaped identifier', () => {
    expect(
      findPhiFixtureViolations([
        {
          path: 'test/fixtures/patient.ts',
          content: 'export const row = { mrn: "123456" };',
        },
      ]),
    ).toEqual(['test/fixtures/patient.ts: mrn']);
  });
});
