import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');
const MIGRATIONS_ROOT = join(ROOT, 'prisma', 'migrations');

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return true;
    if (error.code === 'P2010') {
      return /23505|unique|duplicate key|already exists/i.test(error.message);
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /23505|unique|duplicate key|already exists|SqlState\(E23505\)/i.test(msg);
}

function isCheckViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /check constraint|violates check/i.test(msg);
}

function isForeignKeyViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /foreign key|violates foreign key|restrict/i.test(msg);
}

function isAppendOnlyViolation(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /append-only|update rejected|delete rejected/i.test(msg);
}

async function expectRejectsUnique(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected unique violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected unique violation') throw error;
    expect(isUniqueViolation(error)).toBe(true);
  }
}

async function expectRejectsCheck(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected check violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected check violation') throw error;
    expect(isCheckViolation(error)).toBe(true);
  }
}

async function expectRejectsForeignKey(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected foreign key violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected foreign key violation') throw error;
    expect(isForeignKeyViolation(error)).toBe(true);
  }
}

async function expectRejectsAppendOnly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected append-only violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected append-only violation') throw error;
    expect(isAppendOnlyViolation(error)).toBe(true);
  }
}

(integrationEnabled ? describe : describe.skip)(
  'DHB-31 schema constraints (012–020)',
  () => {
    jest.setTimeout(360_000);

    let prisma!: PrismaClient;
    let stop: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      const postgres = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
      const databaseUrl = postgres.getConnectionUri();

      execSync('npx prisma migrate deploy', {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
      });

      prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      await prisma.$connect();
      stop = async () => {
        await prisma.$disconnect();
        await postgres.stop();
      };
    });

    afterAll(async () => {
      if (stop) await stop();
    });

    async function insertUser(email: string): Promise<string> {
      const id = generateId();
      await prisma.user.create({ data: { id, email, displayName: 'Test User' } });
      return id;
    }

    async function createPersonalOrgProject(): Promise<{
      userId: string;
      orgId: string;
      projectId: string;
    }> {
      const userId = await insertUser(`dhb31-${generateId()}@example.com`);
      const orgId = generateId();
      const projectId = generateId();
      await prisma.organization.create({
        data: { id: orgId, kind: 'PERSONAL', name: 'Personal', ownerUserId: userId },
      });
      await prisma.project.create({ data: { id: projectId, orgId, name: 'Project' } });
      return { userId, orgId, projectId };
    }

    async function createDocumentGraph(
      projectId: string,
      orgId: string,
    ): Promise<{ documentId: string; versionId: string; chunkId: string }> {
      const documentId = generateId();
      const versionId = generateId();
      const chunkId = generateId();
      const storageKey = `doc/${generateId()}`;
      await prisma.document.create({
        data: { id: documentId, projectId, orgId, title: 'Paper', storageKey },
      });
      await prisma.documentVersion.create({
        data: { id: versionId, documentId, versionNo: 1, storageKey: `${storageKey}/v1` },
      });
      await prisma.chunk.create({
        data: {
          id: chunkId,
          documentVersionId: versionId,
          projectId,
          ordinal: 0,
          charSpan: { start: 0, end: 10 },
          tokenCount: 3,
          blockIds: [],
          contentHash: `hash-${generateId()}`,
          chunkerVersion: 'v1',
          text: '',
        },
      });
      return { documentId, versionId, chunkId };
    }

    async function createResearchRun(
      orgId: string,
      projectId: string,
      userId: string,
      idempotencyKey = `key-${generateId()}`,
    ): Promise<string> {
      const runId = generateId();
      await prisma.researchRun.create({
        data: {
          id: runId,
          orgId,
          projectId,
          initiatedBy: userId,
          preset: 'deep_research',
          reservedMicros: 1000n,
          idempotencyKey,
        },
      });
      return runId;
    }

    async function createSource(projectId: string, documentId: string): Promise<string> {
      const sourceId = generateId();
      await prisma.source.create({
        data: { id: sourceId, projectId, type: 'document', documentId },
      });
      return sourceId;
    }

    async function createEvidence(
      projectId: string,
      sourceId: string,
      chunkId: string,
    ): Promise<string> {
      const evidenceId = generateId();
      await prisma.evidence.create({
        data: {
          id: evidenceId,
          projectId,
          sourceId,
          chunkId,
          locator: { page: 1 },
          text: 'fact',
          qualityScore: 1,
          extractionMethod: 'deterministic',
          type: 'body_grounded',
        },
      });
      return evidenceId;
    }

    describe('migration ordering (001–020 deploy + expand steps)', () => {
      it('006 SQL does not define research_run_id', () => {
        const dir = readdirSync(MIGRATIONS_ROOT)
          .filter((n) => statSync(join(MIGRATIONS_ROOT, n)).isDirectory())
          .find((d) => d.includes('_006_'));
        const sql = readFileSync(join(MIGRATIONS_ROOT, dir!, 'migration.sql'), 'utf8')
          .replace(/--[^\n]*/g, '')
          .toLowerCase();
        expect(sql).not.toMatch(/research_run_id/);
      });

      it('post-deploy ai_executions has research_run_id FK to research_runs', async () => {
        const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
          WHERE tc.table_name = 'ai_executions'
            AND tc.constraint_type = 'FOREIGN KEY'
            AND ccu.table_name = 'research_runs'
        `;
        expect(rows.map((r) => r.column_name)).toContain('research_run_id');
      });

      it('writings.current_version_id FK exists after 017', async () => {
        const rows = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
          SELECT constraint_name
          FROM information_schema.table_constraints
          WHERE table_name = 'writings'
            AND constraint_type = 'FOREIGN KEY'
            AND constraint_name = 'writings_current_version_id_fkey'
        `;
        expect(rows).toHaveLength(1);
      });
    });

    describe('012 research_runs', () => {
      it('rejects duplicate (project_id, idempotency_key)', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const key = `idem-${generateId()}`;
        await createResearchRun(orgId, projectId, userId, key);
        await expectRejectsUnique(() => createResearchRun(orgId, projectId, userId, key));
      });

      it('rejects duplicate research_run_steps within a run', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const runId = await createResearchRun(orgId, projectId, userId);
        const base = {
          runId,
          stepType: 'extract',
          inputFingerprint: 'fp',
          stepVersion: 'v1',
        };
        await prisma.researchRunStep.create({ data: { id: generateId(), ...base } });
        await expectRejectsUnique(() =>
          prisma.researchRunStep.create({ data: { id: generateId(), ...base } }),
        );
      });

      it('links ai_executions to research_runs with RESTRICT delete', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const runId = await createResearchRun(orgId, projectId, userId);
        const executionId = generateId();
        await prisma.aiExecution.create({
          data: {
            id: executionId,
            orgId,
            projectId,
            researchRunId: runId,
            capability: 'EXTRACT_CELL',
            provider: 'openai',
            model: 'gpt',
            promptVersion: 'v1',
            inputFingerprint: 'fp',
            status: 'ok',
            method: 'llm',
            correlationId: generateId(),
          },
        });
        await expectRejectsForeignKey(() => prisma.researchRun.delete({ where: { id: runId } }));
      });

      it('rejects duplicate research_artifacts (run_id, type, coverage_snapshot_hash)', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const runId = await createResearchRun(orgId, projectId, userId);
        const aiExecutionId = generateId();
        await prisma.aiExecution.create({
          data: {
            id: aiExecutionId,
            orgId,
            projectId,
            researchRunId: runId,
            capability: 'SYNTHESIS',
            provider: 'openai',
            model: 'gpt',
            promptVersion: 'v1',
            inputFingerprint: 'fp',
            status: 'ok',
            method: 'llm',
            correlationId: generateId(),
          },
        });
        const hash = 'abc123';
        const base = {
          runId,
          type: 'extraction_matrix' as const,
          coverageSnapshot: { schemaVersion: 1 },
          coverageSnapshotHash: hash,
          generatedAt: new Date(),
          aiExecutionId,
        };
        await prisma.researchArtifact.create({ data: { id: generateId(), ...base } });
        await expectRejectsUnique(() =>
          prisma.researchArtifact.create({ data: { id: generateId(), ...base } }),
        );
      });
    });

    describe('013 extraction', () => {
      it('rejects duplicate extraction_schemas (project_id, name, version)', async () => {
        const { projectId } = await createPersonalOrgProject();
        await prisma.extractionSchema.create({
          data: {
            id: generateId(),
            projectId,
            name: 'matrix',
            columns: [],
            version: 1,
          },
        });
        await expectRejectsUnique(() =>
          prisma.extractionSchema.create({
            data: {
              id: generateId(),
              projectId,
              name: 'matrix',
              columns: [],
              version: 1,
            },
          }),
        );
      });

      it('enforces one extraction_run per research_run', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const runId = await createResearchRun(orgId, projectId, userId);
        const schemaId = generateId();
        await prisma.extractionSchema.create({
          data: { id: schemaId, projectId, name: 'm', columns: [], version: 1 },
        });
        await prisma.extractionRun.create({
          data: {
            id: generateId(),
            runId,
            schemaId,
            schemaVersion: 1,
            documentIds: [],
          },
        });
        await expectRejectsUnique(() =>
          prisma.extractionRun.create({
            data: {
              id: generateId(),
              runId,
              schemaId,
              schemaVersion: 1,
              documentIds: [],
            },
          }),
        );
      });

      it('rejects llm extraction_cells without ai_execution_id', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const { documentId } = await createDocumentGraph(projectId, orgId);
        const runId = await createResearchRun(orgId, projectId, userId);
        const schemaId = generateId();
        await prisma.extractionSchema.create({
          data: { id: schemaId, projectId, name: 'm', columns: [], version: 1 },
        });
        const extractionRunId = generateId();
        await prisma.extractionRun.create({
          data: {
            id: extractionRunId,
            runId,
            schemaId,
            schemaVersion: 1,
            documentIds: [documentId],
          },
        });
        await expectRejectsCheck(() =>
          prisma.extractionCell.create({
            data: {
              id: generateId(),
              extractionRunId,
              documentId,
              columnKey: 'sample_size',
              method: 'llm',
              status: 'ok',
            },
          }),
        );
      });
    });

    describe('014 screening', () => {
      it('rejects duplicate screening_criteria (project_id, version)', async () => {
        const { userId, projectId } = await createPersonalOrgProject();
        await prisma.screeningCriteria.create({
          data: {
            id: generateId(),
            projectId,
            definition: { rules: [] },
            version: 1,
            createdBy: userId,
          },
        });
        await expectRejectsUnique(() =>
          prisma.screeningCriteria.create({
            data: {
              id: generateId(),
              projectId,
              definition: { rules: [] },
              version: 1,
              createdBy: userId,
            },
          }),
        );
      });

      it('allows superseding via superseded_by_decision_id only', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const { documentId } = await createDocumentGraph(projectId, orgId);
        const sourceId = await createSource(projectId, documentId);
        const decisionId = generateId();
        const successorId = generateId();
        await prisma.screeningDecision.create({
          data: {
            id: decisionId,
            projectId,
            sourceId,
            decision: 'include',
            method: 'human',
            decidedBy: userId,
            decidedAt: new Date(),
          },
        });
        await prisma.screeningDecision.create({
          data: {
            id: successorId,
            projectId,
            sourceId,
            decision: 'exclude',
            method: 'human',
            decidedBy: userId,
            decidedAt: new Date(),
          },
        });
        await prisma.screeningDecision.update({
          where: { id: decisionId },
          data: { supersededByDecisionId: successorId },
        });
        await expectRejectsAppendOnly(() =>
          prisma.screeningDecision.update({
            where: { id: decisionId },
            data: { reason: 'changed mind' },
          }),
        );
        await expectRejectsAppendOnly(() =>
          prisma.screeningDecision.delete({ where: { id: decisionId } }),
        );
      });
    });

    describe('015 platform', () => {
      it('rejects outbox rows with schema_version < 1', async () => {
        await expectRejectsCheck(() =>
          prisma.$executeRaw`
            INSERT INTO outbox (
              id, aggregate_type, aggregate_id, event_type, schema_version,
              payload, correlation_id, created_at
            ) VALUES (
              ${generateId()}::uuid, 'project', ${generateId()}::uuid, 'test.event', 0,
              '{}'::jsonb, ${generateId()}, NOW()
            )
          `,
        );
      });

      it('audit_events rejects DELETE and non-actor UPDATE', async () => {
        const id = generateId();
        await prisma.auditEvent.create({
          data: {
            id,
            actorType: 'user',
            actorId: generateId(),
            action: 'test.action',
            scope: { projectId: generateId() },
            correlationId: generateId(),
          },
        });
        await expectRejectsAppendOnly(() => prisma.auditEvent.delete({ where: { id } }));
        await expectRejectsAppendOnly(() =>
          prisma.auditEvent.update({ where: { id }, data: { action: 'changed' } }),
        );
        await prisma.auditEvent.update({ where: { id }, data: { actorId: null } });
      });
    });

    describe('017 writing', () => {
      it('rejects duplicate writing_versions (writing_id, version_no)', async () => {
        const { userId, projectId } = await createPersonalOrgProject();
        const writingId = generateId();
        await prisma.writing.create({
          data: {
            id: writingId,
            projectId,
            title: 'Draft',
            type: 'manuscript',
            createdBy: userId,
          },
        });
        await prisma.writingVersion.create({
          data: {
            id: generateId(),
            writingId,
            versionNo: 1,
            contentRef: 'ref/v1',
            createdBy: userId,
          },
        });
        await expectRejectsUnique(() =>
          prisma.writingVersion.create({
            data: {
              id: generateId(),
              writingId,
              versionNo: 1,
              contentRef: 'ref/v1-dup',
              createdBy: userId,
            },
          }),
        );
      });

      it('supports current_version_id FK expand step', async () => {
        const { userId, projectId } = await createPersonalOrgProject();
        const writingId = generateId();
        const versionId = generateId();
        await prisma.writing.create({
          data: {
            id: writingId,
            projectId,
            title: 'Draft',
            type: 'manuscript',
            createdBy: userId,
          },
        });
        await prisma.writingVersion.create({
          data: {
            id: versionId,
            writingId,
            versionNo: 1,
            contentRef: 'ref/v1',
            createdBy: userId,
          },
        });
        await prisma.writing.update({
          where: { id: writingId },
          data: { currentVersionId: versionId },
        });
        const writing = await prisma.writing.findUniqueOrThrow({
          where: { id: writingId },
          include: { currentVersion: true },
        });
        expect(writing.currentVersion?.id).toBe(versionId);
      });

      it('rejects UPDATE on writing_versions (immutable)', async () => {
        const { userId, projectId } = await createPersonalOrgProject();
        const writingId = generateId();
        const versionId = generateId();
        await prisma.writing.create({
          data: {
            id: writingId,
            projectId,
            title: 'Draft',
            type: 'manuscript',
            createdBy: userId,
          },
        });
        await prisma.writingVersion.create({
          data: {
            id: versionId,
            writingId,
            versionNo: 1,
            contentRef: 'ref/v1',
            createdBy: userId,
          },
        });
        await expectRejectsAppendOnly(() =>
          prisma.writingVersion.update({
            where: { id: versionId },
            data: { contentRef: 'mutated' },
          }),
        );
      });

      it('rejects duplicate sentence bindings per version', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const { documentId, chunkId } = await createDocumentGraph(projectId, orgId);
        const sourceId = await createSource(projectId, documentId);
        const evidenceId = await createEvidence(projectId, sourceId, chunkId);
        const writingId = generateId();
        const versionId = generateId();
        await prisma.writing.create({
          data: {
            id: writingId,
            projectId,
            title: 'Draft',
            type: 'manuscript',
            createdBy: userId,
          },
        });
        await prisma.writingVersion.create({
          data: {
            id: versionId,
            writingId,
            versionNo: 1,
            contentRef: 'ref/v1',
            createdBy: userId,
          },
        });
        const binding = {
          writingId,
          writingVersionId: versionId,
          projectId,
          sentenceHash: 'hash1',
          evidenceId,
          strength: 1,
        };
        await prisma.writingSentenceBinding.create({
          data: { id: generateId(), ...binding },
        });
        await expectRejectsUnique(() =>
          prisma.writingSentenceBinding.create({
            data: { id: generateId(), ...binding },
          }),
        );
      });
    });

    describe('018 conversations', () => {
      it('enforces unique (conversation_id, sequence)', async () => {
        const { userId, projectId } = await createPersonalOrgProject();
        const conversationId = generateId();
        await prisma.conversation.create({
          data: { id: conversationId, projectId, createdBy: userId },
        });
        await prisma.message.create({
          data: {
            id: generateId(),
            conversationId,
            role: 'user',
            content: 'hello',
            sequence: 1,
          },
        });
        await expectRejectsUnique(() =>
          prisma.message.create({
            data: {
              id: generateId(),
              conversationId,
              role: 'user',
              content: 'duplicate seq',
              sequence: 1,
            },
          }),
        );
      });

      it('rejects complete assistant messages without ai_execution_id', async () => {
        const { userId, projectId } = await createPersonalOrgProject();
        const conversationId = generateId();
        await prisma.conversation.create({
          data: { id: conversationId, projectId, createdBy: userId },
        });
        await expectRejectsCheck(() =>
          prisma.message.create({
            data: {
              id: generateId(),
              conversationId,
              role: 'assistant',
              content: 'answer',
              status: 'complete',
              sequence: 1,
            },
          }),
        );
      });

      it('rejects duplicate message_evidence_bindings', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const { documentId, chunkId } = await createDocumentGraph(projectId, orgId);
        const sourceId = await createSource(projectId, documentId);
        const evidenceId = await createEvidence(projectId, sourceId, chunkId);
        const conversationId = generateId();
        const messageId = generateId();
        await prisma.conversation.create({
          data: { id: conversationId, projectId, createdBy: userId },
        });
        await prisma.message.create({
          data: {
            id: messageId,
            conversationId,
            role: 'user',
            content: 'q',
            sequence: 1,
          },
        });
        await prisma.messageEvidenceBinding.create({
          data: {
            id: generateId(),
            messageId,
            evidenceId,
            projectId,
          },
        });
        await expectRejectsUnique(() =>
          prisma.messageEvidenceBinding.create({
            data: {
              id: generateId(),
              messageId,
              evidenceId,
              projectId,
            },
          }),
        );
      });
    });

    describe('019 library', () => {
      it('rejects library_items with zero or two targets', async () => {
        const { projectId } = await createPersonalOrgProject();
        await expectRejectsCheck(() =>
          prisma.$executeRaw`
            INSERT INTO library_items (id, project_id, document_id, external_record_id, created_at)
            VALUES (${generateId()}::uuid, ${projectId}::uuid, NULL, NULL, NOW())
          `,
        );
      });

      it('rejects duplicate document in same folder', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { documentId } = await createDocumentGraph(projectId, orgId);
        const folderId = generateId();
        await prisma.libraryFolder.create({
          data: { id: folderId, projectId, name: 'Papers' },
        });
        await prisma.libraryItem.create({
          data: { id: generateId(), projectId, folderId, documentId },
        });
        await expectRejectsUnique(() =>
          prisma.libraryItem.create({
            data: { id: generateId(), projectId, folderId, documentId },
          }),
        );
      });
    });

    describe('020 connectors', () => {
      it('rejects duplicate connector_cache (provider, cache_key)', async () => {
        const provider = 'crossref';
        const cacheKey = `doi:${generateId()}`;
        await prisma.connectorCache.create({
          data: {
            id: generateId(),
            provider,
            cacheKey,
            value: { title: 'Paper' },
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        await expectRejectsUnique(() =>
          prisma.connectorCache.create({
            data: {
              id: generateId(),
              provider,
              cacheKey,
              value: { title: 'Duplicate' },
              expiresAt: new Date(Date.now() + 60_000),
            },
          }),
        );
      });

      it('rejects duplicate import sessions (project_id, idempotency_key)', async () => {
        const { userId, projectId } = await createPersonalOrgProject();
        const key = `import-${generateId()}`;
        await prisma.referenceManagerImportSession.create({
          data: {
            id: generateId(),
            projectId,
            source: 'zotero',
            initiatedBy: userId,
            idempotencyKey: key,
          },
        });
        await expectRejectsUnique(() =>
          prisma.referenceManagerImportSession.create({
            data: {
              id: generateId(),
              projectId,
              source: 'zotero',
              initiatedBy: userId,
              idempotencyKey: key,
            },
          }),
        );
      });
    });
  },
);
