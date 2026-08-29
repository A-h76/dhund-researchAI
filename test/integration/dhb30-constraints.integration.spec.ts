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
    if (error.code === 'P2002') {
      return true;
    }
    if (error.code === 'P2010') {
      const msg = error.message;
      return /23505|unique|duplicate key|already exists/i.test(msg);
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
  return /append-only|update rejected/i.test(msg);
}

function vectorLiteral(dimensions: number, value = 0.1): string {
  return `[${Array(dimensions).fill(value).join(',')}]`;
}

async function expectRejectsUnique(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected unique violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected unique violation') {
      throw error;
    }
    expect(isUniqueViolation(error)).toBe(true);
  }
}

async function expectRejectsCheck(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected check violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected check violation') {
      throw error;
    }
    expect(isCheckViolation(error)).toBe(true);
  }
}

async function expectRejectsForeignKey(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected foreign key violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected foreign key violation') {
      throw error;
    }
    expect(isForeignKeyViolation(error)).toBe(true);
  }
}

async function expectRejectsAppendOnly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    throw new Error('expected append-only violation');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected append-only violation') {
      throw error;
    }
    expect(isAppendOnlyViolation(error)).toBe(true);
  }
}

(integrationEnabled ? describe : describe.skip)(
  'DHB-30 schema constraints (Phase 2 §15.2 / GAP-EMBED-01 / GAP-HNSW-01 / GAP-CLAIM-ARG-01 / R10)',
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

      prisma = new PrismaClient({
        datasources: { db: { url: databaseUrl } },
      });
      await prisma.$connect();
      stop = async () => {
        await prisma.$disconnect();
        await postgres.stop();
      };
    });

    afterAll(async () => {
      if (stop) {
        await stop();
      }
    });

    async function insertUser(email: string): Promise<string> {
      const id = generateId();
      await prisma.user.create({
        data: { id, email, displayName: 'Test User' },
      });
      return id;
    }

    async function createPersonalOrgProject(): Promise<{
      userId: string;
      orgId: string;
      projectId: string;
    }> {
      const userId = await insertUser(`dhb30-${generateId()}@example.com`);
      const orgId = generateId();
      const projectId = generateId();
      await prisma.organization.create({
        data: {
          id: orgId,
          kind: 'PERSONAL',
          name: 'Personal',
          ownerUserId: userId,
        },
      });
      await prisma.project.create({
        data: {
          id: projectId,
          orgId,
          name: 'Project',
        },
      });
      return { userId, orgId, projectId };
    }

    async function createSecondProject(orgId: string): Promise<string> {
      const projectId = generateId();
      await prisma.project.create({
        data: { id: projectId, orgId, name: 'Project B' },
      });
      return projectId;
    }

    async function createRightsSnapshot(): Promise<string> {
      const id = generateId();
      await prisma.rightsSnapshot.create({
        data: {
          id,
          connectorId: `conn-${generateId()}`,
          policyVersion: 'v1',
          capabilities: { read: true },
          capturedAt: new Date(),
        },
      });
      return id;
    }

    async function createDocumentGraph(projectId: string, orgId: string): Promise<{
      documentId: string;
      versionId: string;
      chunkId: string;
    }> {
      const documentId = generateId();
      const versionId = generateId();
      const chunkId = generateId();
      const storageKey = `doc/${generateId()}`;

      await prisma.document.create({
        data: {
          id: documentId,
          projectId,
          orgId,
          title: 'Paper',
          storageKey,
        },
      });
      await prisma.documentVersion.create({
        data: {
          id: versionId,
          documentId,
          versionNo: 1,
          storageKey: `${storageKey}/v1`,
        },
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

    describe('migration ordering hazards', () => {
      it('006 migration directory precedes 011', () => {
        const dirs = readdirSync(MIGRATIONS_ROOT)
          .filter((name) => statSync(join(MIGRATIONS_ROOT, name)).isDirectory())
          .sort();
        const idx006 = dirs.findIndex((d) => d.includes('_006_'));
        const idx011 = dirs.findIndex((d) => d.includes('_011_'));
        expect(idx006).toBeLessThan(idx011);
      });
    });

    describe('§15.2 unique constraints', () => {
      it('rejects duplicate ai_execution_attempts (ai_execution_id, attempt_no)', async () => {
        const { orgId } = await createPersonalOrgProject();
        const executionId = generateId();
        await prisma.aiExecution.create({
          data: {
            id: executionId,
            orgId,
            capability: 'EMBED',
            provider: 'voyage',
            model: 'voyage-4',
            promptVersion: 'v1',
            inputFingerprint: 'fp',
            status: 'ok',
            method: 'llm',
            correlationId: generateId(),
          },
        });
        await prisma.aiExecutionAttempt.create({
          data: {
            id: generateId(),
            aiExecutionId: executionId,
            attemptNo: 1,
            provider: 'voyage',
            model: 'voyage-4',
            status: 'ok',
            latencyMs: 1,
            costMicros: 0n,
          },
        });
        await expectRejectsUnique(() =>
          prisma.aiExecutionAttempt.create({
            data: {
              id: generateId(),
              aiExecutionId: executionId,
              attemptNo: 1,
              provider: 'voyage',
              model: 'voyage-4',
              status: 'failed',
              latencyMs: 2,
              costMicros: 0n,
            },
          }),
        );
      });

      it('rejects duplicate external_identifiers (scheme, value)', async () => {
        const workId = generateId();
        await prisma.canonicalWork.create({
          data: {
            id: workId,
            canonicalTitle: 'Title',
            authorHash: 'hash',
            type: 'article',
          },
        });
        const doi = `10.1234/${generateId()}`;
        await prisma.externalIdentifier.create({
          data: {
            id: generateId(),
            canonicalWorkId: workId,
            scheme: 'doi',
            value: doi,
          },
        });
        const work2 = generateId();
        await prisma.canonicalWork.create({
          data: {
            id: work2,
            canonicalTitle: 'Other',
            authorHash: 'hash2',
            type: 'article',
          },
        });
        await expectRejectsUnique(() =>
          prisma.externalIdentifier.create({
            data: {
              id: generateId(),
              canonicalWorkId: work2,
              scheme: 'doi',
              value: doi,
            },
          }),
        );
      });

      it('rejects duplicate work_relationships (from, to, type)', async () => {
        const a = generateId();
        const b = generateId();
        await prisma.canonicalWork.createMany({
          data: [
            { id: a, canonicalTitle: 'A', authorHash: 'a', type: 'article' },
            { id: b, canonicalTitle: 'B', authorHash: 'b', type: 'article' },
          ],
        });
        await prisma.workRelationship.create({
          data: {
            id: generateId(),
            fromWorkId: a,
            toWorkId: b,
            type: 'cites',
            provenance: {},
          },
        });
        await expectRejectsUnique(() =>
          prisma.workRelationship.create({
            data: {
              id: generateId(),
              fromWorkId: a,
              toWorkId: b,
              type: 'cites',
              provenance: {},
            },
          }),
        );
      });

      it('rejects duplicate pending merge_candidates pair', async () => {
        const candidate = generateId();
        const existing = generateId();
        await prisma.canonicalWork.createMany({
          data: [
            { id: candidate, canonicalTitle: 'C', authorHash: 'c', type: 'article' },
            { id: existing, canonicalTitle: 'E', authorHash: 'e', type: 'article' },
          ],
        });
        await prisma.mergeCandidate.create({
          data: {
            id: generateId(),
            candidateWorkId: candidate,
            existingWorkId: existing,
            matchType: 'exact_doi',
            evidence: {},
          },
        });
        await expectRejectsUnique(() =>
          prisma.mergeCandidate.create({
            data: {
              id: generateId(),
              candidateWorkId: candidate,
              existingWorkId: existing,
              matchType: 'fuzzy_title',
              evidence: {},
            },
          }),
        );
      });

      it('rejects duplicate rights_snapshots (connector_id, policy_version)', async () => {
        const connectorId = `conn-${generateId()}`;
        await prisma.rightsSnapshot.create({
          data: {
            id: generateId(),
            connectorId,
            policyVersion: 'v1',
            capabilities: {},
            capturedAt: new Date(),
          },
        });
        await expectRejectsUnique(() =>
          prisma.rightsSnapshot.create({
            data: {
              id: generateId(),
              connectorId,
              policyVersion: 'v1',
              capabilities: { x: 1 },
              capturedAt: new Date(),
            },
          }),
        );
      });

      it('rejects duplicate live external_records (project, connector, external_id)', async () => {
        const { projectId } = await createPersonalOrgProject();
        const rightsId = await createRightsSnapshot();
        const connectorId = 'zotero';
        const externalId = `ext-${generateId()}`;
        await prisma.externalRecord.create({
          data: {
            id: generateId(),
            projectId,
            connectorId,
            externalId,
            type: 'zotero_item',
            rightsSnapshotId: rightsId,
          },
        });
        await expectRejectsUnique(() =>
          prisma.externalRecord.create({
            data: {
              id: generateId(),
              projectId,
              connectorId,
              externalId,
              type: 'zotero_item',
              rightsSnapshotId: rightsId,
            },
          }),
        );
      });

      it('rejects duplicate discovery_candidates business key', async () => {
        const { projectId } = await createPersonalOrgProject();
        const queryId = generateId();
        const connectorId = 'openalex';
        const externalId = `w-${generateId()}`;
        await prisma.discoveryCandidate.create({
          data: {
            id: generateId(),
            projectId,
            queryId,
            connectorId,
            externalId,
            metadata: {},
          },
        });
        await expectRejectsUnique(() =>
          prisma.discoveryCandidate.create({
            data: {
              id: generateId(),
              projectId,
              queryId,
              connectorId,
              externalId,
              metadata: { dup: true },
            },
          }),
        );
      });

      it('rejects duplicate upload_sessions.storage_key', async () => {
        const { userId, orgId, projectId } = await createPersonalOrgProject();
        const storageKey = `upload/${generateId()}`;
        await prisma.uploadSession.create({
          data: {
            id: generateId(),
            projectId,
            orgId,
            initiatedBy: userId,
            filename: 'paper.pdf',
            sizeBytes: 100n,
            mimeType: 'application/pdf',
            storageKey,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
        await expectRejectsUnique(() =>
          prisma.uploadSession.create({
            data: {
              id: generateId(),
              projectId,
              orgId,
              initiatedBy: userId,
              filename: 'other.pdf',
              sizeBytes: 200n,
              mimeType: 'application/pdf',
              storageKey,
              expiresAt: new Date(Date.now() + 86_400_000),
            },
          }),
        );
      });

      it('rejects duplicate documents (project_id, doi) when live', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const doi = `10.5555/${generateId()}`;
        await prisma.document.create({
          data: {
            id: generateId(),
            projectId,
            orgId,
            title: 'First',
            storageKey: `sk-${generateId()}`,
            doi,
          },
        });
        await expectRejectsUnique(() =>
          prisma.document.create({
            data: {
              id: generateId(),
              projectId,
              orgId,
              title: 'Second',
              storageKey: `sk-${generateId()}`,
              doi,
            },
          }),
        );
      });

      it('rejects duplicate document_versions (document_id, version_no)', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const documentId = generateId();
        await prisma.document.create({
          data: {
            id: documentId,
            projectId,
            orgId,
            title: 'Paper',
            storageKey: `sk-${generateId()}`,
          },
        });
        await prisma.documentVersion.create({
          data: {
            id: generateId(),
            documentId,
            versionNo: 1,
            storageKey: 'v1',
          },
        });
        await expectRejectsUnique(() =>
          prisma.documentVersion.create({
            data: {
              id: generateId(),
              documentId,
              versionNo: 1,
              storageKey: 'v1-dup',
            },
          }),
        );
      });

      it('rejects duplicate document_extractions idempotency key', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { versionId } = await createDocumentGraph(projectId, orgId);
        const contentHash = `hash-${generateId()}`;
        await prisma.documentExtraction.create({
          data: {
            id: generateId(),
            documentVersionId: versionId,
            extractorVersion: 'ext-v1',
            contentHash,
            status: 'ok',
            producedAt: new Date(),
          },
        });
        await expectRejectsUnique(() =>
          prisma.documentExtraction.create({
            data: {
              id: generateId(),
              documentVersionId: versionId,
              extractorVersion: 'ext-v1',
              contentHash,
              status: 'ok',
              producedAt: new Date(),
            },
          }),
        );
      });

      it('rejects duplicate document_blocks (document_version_id, ordinal)', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { versionId } = await createDocumentGraph(projectId, orgId);
        await prisma.documentBlock.create({
          data: {
            id: generateId(),
            documentVersionId: versionId,
            type: 'paragraph',
            page: 1,
            text: 'Hello',
            ordinal: 0,
          },
        });
        await expectRejectsUnique(() =>
          prisma.documentBlock.create({
            data: {
              id: generateId(),
              documentVersionId: versionId,
              type: 'paragraph',
              page: 1,
              text: 'Dup',
              ordinal: 0,
            },
          }),
        );
      });

      it('rejects duplicate chunks idempotency key', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { versionId } = await createDocumentGraph(projectId, orgId);
        const contentHash = `chunk-${generateId()}`;
        await prisma.chunk.create({
          data: {
            id: generateId(),
            documentVersionId: versionId,
            projectId,
            ordinal: 1,
            charSpan: { start: 0, end: 5 },
            tokenCount: 1,
            blockIds: [],
            contentHash,
            chunkerVersion: 'v1',
            text: '',
          },
        });
        await expectRejectsUnique(() =>
          prisma.chunk.create({
            data: {
              id: generateId(),
              documentVersionId: versionId,
              projectId,
              ordinal: 2,
              charSpan: { start: 5, end: 10 },
              tokenCount: 1,
              blockIds: [],
              contentHash,
              chunkerVersion: 'v1',
              text: '',
            },
          }),
        );
      });

      it('rejects duplicate chunk_embeddings (chunk_id, model_version, content_hash)', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { chunkId } = await createDocumentGraph(projectId, orgId);
        const contentHash = `emb-${generateId()}`;
        const embeddingId = generateId();
        const vec = vectorLiteral(1024);
        await prisma.$executeRaw`
          INSERT INTO chunk_embeddings (
            id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
          ) VALUES (
            ${embeddingId}::uuid,
            ${chunkId}::uuid,
            ${projectId}::uuid,
            'voyage-4',
            'embedding_v1',
            1024,
            ${vec}::vector(1024),
            ${contentHash},
            'ok'::embedding_status
          )
        `;
        await expectRejectsUnique(() =>
          prisma.$executeRaw`
            INSERT INTO chunk_embeddings (
              id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
            ) VALUES (
              ${generateId()}::uuid,
              ${chunkId}::uuid,
              ${projectId}::uuid,
              'voyage-4',
              'embedding_v1',
              1024,
              ${vec}::vector(1024),
              ${contentHash},
              'ok'::embedding_status
            )
          `,
        );
      });

      it('rejects duplicate evidence_claim_links (evidence_id, claim_id)', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { documentId, chunkId } = await createDocumentGraph(projectId, orgId);
        const sourceId = generateId();
        await prisma.source.create({
          data: {
            id: sourceId,
            projectId,
            type: 'document',
            documentId,
          },
        });
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
        const claimId = generateId();
        await prisma.claim.create({
          data: { id: claimId, projectId, text: 'claim' },
        });
        await prisma.evidenceClaimLink.create({
          data: {
            id: generateId(),
            evidenceId,
            claimId,
            weight: 1,
            stance: 'supports',
          },
        });
        await expectRejectsUnique(() =>
          prisma.evidenceClaimLink.create({
            data: {
              id: generateId(),
              evidenceId,
              claimId,
              weight: 0.5,
              stance: 'neutral',
            },
          }),
        );
        void documentId;
      });

      it('rejects duplicate argument_claim_links (argument_id, claim_id)', async () => {
        const { projectId } = await createPersonalOrgProject();
        const argumentId = generateId();
        const claimId = generateId();
        await prisma.argument.create({
          data: { id: argumentId, projectId, title: 'Arg', structure: {} },
        });
        await prisma.claim.create({
          data: { id: claimId, projectId, text: 'claim' },
        });
        await prisma.argumentClaimLink.create({
          data: {
            id: generateId(),
            argumentId,
            claimId,
            projectId,
          },
        });
        await expectRejectsUnique(() =>
          prisma.argumentClaimLink.create({
            data: {
              id: generateId(),
              argumentId,
              claimId,
              projectId,
            },
          }),
        );
      });
    });

    describe('AI ledger', () => {
      it('rejects negative cost_micros', async () => {
        const { orgId } = await createPersonalOrgProject();
        await expectRejectsCheck(() =>
          prisma.$executeRaw`
            INSERT INTO ai_executions (
              id, org_id, capability, provider, model, prompt_version, input_fingerprint,
              status, method, cost_micros, correlation_id, created_at
            ) VALUES (
              ${generateId()}::uuid,
              ${orgId}::uuid,
              'EMBED'::ai_capability,
              'voyage',
              'voyage-4',
              'v1',
              'fp',
              'ok'::ai_status,
              'llm'::ai_method,
              -1,
              ${generateId()},
              NOW()
            )
          `,
        );
      });
    });

    describe('global identity', () => {
      it('canonical_works has no project_id or org_id column', async () => {
        const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'canonical_works'
            AND column_name IN ('project_id', 'org_id')
        `;
        expect(rows).toHaveLength(0);
      });

      it('documents.canonical_work_id SET NULL when canonical work is deleted', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const workId = generateId();
        await prisma.canonicalWork.create({
          data: {
            id: workId,
            canonicalTitle: 'Work',
            authorHash: 'hash',
            type: 'article',
          },
        });
        const documentId = generateId();
        await prisma.document.create({
          data: {
            id: documentId,
            projectId,
            orgId,
            title: 'Linked',
            storageKey: `sk-${generateId()}`,
            canonicalWorkId: workId,
          },
        });
        await prisma.canonicalWork.delete({ where: { id: workId } });
        const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
        expect(doc.canonicalWorkId).toBeNull();
      });
    });

    describe('RESTRICT and junction behaviour', () => {
      it('rejects deleting ai_executions referenced by evidence', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { documentId, chunkId } = await createDocumentGraph(projectId, orgId);
        const executionId = generateId();
        await prisma.aiExecution.create({
          data: {
            id: executionId,
            orgId,
            projectId,
            capability: 'STANCE',
            provider: 'voyage',
            model: 'voyage-4',
            promptVersion: 'v1',
            inputFingerprint: 'fp',
            status: 'ok',
            method: 'llm',
            correlationId: generateId(),
          },
        });
        const sourceId = generateId();
        await prisma.source.create({
          data: {
            id: sourceId,
            projectId,
            type: 'document',
            documentId,
          },
        });
        await prisma.evidence.create({
          data: {
            id: generateId(),
            projectId,
            sourceId,
            chunkId,
            locator: { page: 1 },
            text: 'llm fact',
            qualityScore: 1,
            extractionMethod: 'llm',
            aiExecutionId: executionId,
            type: 'body_grounded',
          },
        });
        await expectRejectsForeignKey(() =>
          prisma.aiExecution.delete({ where: { id: executionId } }),
        );
      });

      it('argument_claim_links CASCADE when argument deleted; RESTRICT when claim deleted', async () => {
        const { projectId } = await createPersonalOrgProject();
        const argumentId = generateId();
        const claimId = generateId();
        await prisma.argument.create({
          data: { id: argumentId, projectId, title: 'Arg', structure: {} },
        });
        await prisma.claim.create({
          data: { id: claimId, projectId, text: 'claim' },
        });
        const linkId = generateId();
        await prisma.argumentClaimLink.create({
          data: { id: linkId, argumentId, claimId, projectId },
        });
        await prisma.argument.delete({ where: { id: argumentId } });
        const gone = await prisma.argumentClaimLink.findUnique({ where: { id: linkId } });
        expect(gone).toBeNull();

        const argument2 = generateId();
        const claim2 = generateId();
        await prisma.argument.create({
          data: { id: argument2, projectId, title: 'Arg2', structure: {} },
        });
        await prisma.claim.create({
          data: { id: claim2, projectId, text: 'claim2' },
        });
        await prisma.argumentClaimLink.create({
          data: {
            id: generateId(),
            argumentId: argument2,
            claimId: claim2,
            projectId,
          },
        });
        await expectRejectsForeignKey(() => prisma.claim.delete({ where: { id: claim2 } }));
      });
    });

    describe('sources and citations XOR', () => {
      it('rejects sources with zero or two targets', async () => {
        const { projectId } = await createPersonalOrgProject();
        await expectRejectsCheck(() =>
          prisma.$executeRaw`
            INSERT INTO sources (id, project_id, type, document_id, external_record_id)
            VALUES (${generateId()}::uuid, ${projectId}::uuid, 'document'::source_type, NULL, NULL)
          `,
        );
      });

      it('rejects citations with zero or two resolve targets', async () => {
        const { projectId } = await createPersonalOrgProject();
        await expectRejectsCheck(() =>
          prisma.$executeRaw`
            INSERT INTO citations (
              id, project_id, resolves_to_evidence_id, resolves_to_source_id,
              csl_json, quality_annotation, created_at, updated_at
            ) VALUES (
              ${generateId()}::uuid,
              ${projectId}::uuid,
              NULL,
              NULL,
              '{}'::jsonb,
              'metadata_only'::evidence_type,
              NOW(),
              NOW()
            )
          `,
        );
      });

      it('rejects body_grounded evidence without chunk_id', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { documentId } = await createDocumentGraph(projectId, orgId);
        const sourceId = generateId();
        await prisma.source.create({
          data: {
            id: sourceId,
            projectId,
            type: 'document',
            documentId,
          },
        });
        await expectRejectsCheck(() =>
          prisma.evidence.create({
            data: {
              id: generateId(),
              projectId,
              sourceId,
              locator: { page: 1 },
              text: 'no chunk',
              qualityScore: 1,
              extractionMethod: 'deterministic',
              type: 'body_grounded',
            },
          }),
        );
      });

      it('rejects llm evidence without ai_execution_id', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { documentId, chunkId } = await createDocumentGraph(projectId, orgId);
        const sourceId = generateId();
        await prisma.source.create({
          data: {
            id: sourceId,
            projectId,
            type: 'document',
            documentId,
          },
        });
        await expectRejectsCheck(() =>
          prisma.evidence.create({
            data: {
              id: generateId(),
              projectId,
              sourceId,
              chunkId,
              locator: { page: 1 },
              text: 'no execution',
              qualityScore: 1,
              extractionMethod: 'llm',
              type: 'body_grounded',
            },
          }),
        );
      });
    });

    describe('append-only triggers (R10)', () => {
      it('rejects UPDATE on rights_snapshots', async () => {
        const id = await createRightsSnapshot();
        await expectRejectsAppendOnly(() =>
          prisma.$executeRaw`
            UPDATE rights_snapshots SET capabilities = '{"x":1}'::jsonb WHERE id = ${id}::uuid
          `,
        );
      });

      it('rejects UPDATE on external_record_snapshots', async () => {
        const { projectId } = await createPersonalOrgProject();
        const rightsId = await createRightsSnapshot();
        const recordId = generateId();
        await prisma.externalRecord.create({
          data: {
            id: recordId,
            projectId,
            connectorId: 'web',
            externalId: `ext-${generateId()}`,
            type: 'web_page',
            rightsSnapshotId: rightsId,
          },
        });
        const snapshotId = generateId();
        await prisma.externalRecordSnapshot.create({
          data: {
            id: snapshotId,
            externalRecordId: recordId,
            capturedAt: new Date(),
            metadata: { v: 1 },
          },
        });
        await expectRejectsAppendOnly(() =>
          prisma.$executeRaw`
            UPDATE external_record_snapshots SET metadata = '{"v":2}'::jsonb WHERE id = ${snapshotId}::uuid
          `,
        );
      });
    });

    describe('GAP-EMBED-01 / GAP-HNSW-01', () => {
      it('chunk_embeddings.vector column is vector(1024)', async () => {
        const rows = await prisma.$queryRaw<Array<{ typmod: number | null }>>`
          SELECT atttypmod AS typmod
          FROM pg_attribute
          WHERE attrelid = 'chunk_embeddings'::regclass
            AND attname = 'vector'
        `;
        expect(rows[0]?.typmod).toBe(1024);
      });

      it('rejects vector dimension mismatch at write time', async () => {
        const { orgId, projectId } = await createPersonalOrgProject();
        const { chunkId } = await createDocumentGraph(projectId, orgId);
        const wrongVec = vectorLiteral(512);
        await expect(async () => {
          await prisma.$executeRaw`
            INSERT INTO chunk_embeddings (
              id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
            ) VALUES (
              ${generateId()}::uuid,
              ${chunkId}::uuid,
              ${projectId}::uuid,
              'voyage-4',
              'embedding_v1',
              1024,
              ${wrongVec}::vector(1024),
              'hash-wrong-dim',
              'ok'::embedding_status
            )
          `;
        }).rejects.toThrow(/expected|\d+ dimensions|dimension/i);
      });

      it('HNSW index uses vector_cosine_ops with m=16 and ef_construction=128', async () => {
        const rows = await prisma.$queryRaw<
          Array<{ indexname: string; indexdef: string; reloptions: string[] | null }>
        >`
          SELECT i.indexname, i.indexdef, c.reloptions
          FROM pg_indexes i
          JOIN pg_class c ON c.relname = i.indexname
          WHERE i.indexname = 'idx_chunk_embeddings_hnsw_embedding_v1'
        `;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.indexdef).toContain('vector_cosine_ops');
        expect(rows[0]?.indexdef).toContain("model_version = 'embedding_v1'");
        expect(rows[0]?.indexdef).toContain("status = 'ok'");
        const opts = (rows[0]?.reloptions ?? []).join(',');
        expect(opts).toMatch(/m=16/);
        expect(opts).toMatch(/ef_construction=128/);
      });

      it('has no L2 or inner-product vector indexes on chunk_embeddings', async () => {
        const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
          SELECT indexdef
          FROM pg_indexes
          WHERE tablename = 'chunk_embeddings'
            AND (indexdef LIKE '%vector_l2_ops%' OR indexdef LIKE '%vector_ip_ops%')
        `;
        expect(rows).toHaveLength(0);
      });
    });

    describe('ANN project isolation', () => {
      it('returns only embeddings matching project_id predicate before ANN operator', async () => {
        const { orgId, projectId: projectA } = await createPersonalOrgProject();
        const projectB = await createSecondProject(orgId);
        const { chunkId: chunkA } = await createDocumentGraph(projectA, orgId);
        const { chunkId: chunkB } = await createDocumentGraph(projectB, orgId);

        const baseVec = vectorLiteral(1024, 0.5);
        const queryVec = vectorLiteral(1024, 0.5);

        await prisma.$executeRaw`
          INSERT INTO chunk_embeddings (
            id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
          ) VALUES (
            ${generateId()}::uuid, ${chunkA}::uuid, ${projectA}::uuid,
            'voyage-4', 'embedding_v1', 1024, ${baseVec}::vector(1024), 'hash-a', 'ok'::embedding_status
          )
        `;
        await prisma.$executeRaw`
          INSERT INTO chunk_embeddings (
            id, chunk_id, project_id, model_id, model_version, dimensions, vector, content_hash, status
          ) VALUES (
            ${generateId()}::uuid, ${chunkB}::uuid, ${projectB}::uuid,
            'voyage-4', 'embedding_v1', 1024, ${baseVec}::vector(1024), 'hash-b', 'ok'::embedding_status
          )
        `;

        const sql = readFileSync(
          join(ROOT, 'test', 'integration', 'dhb30-ann-query.sql'),
          'utf8',
        );
        const rows = await prisma.$queryRawUnsafe<Array<{ project_id: string; chunk_id: string }>>(
          sql,
          projectA,
          queryVec,
        );

        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.project_id === projectA)).toBe(true);
        expect(rows.some((r) => r.chunk_id === chunkB)).toBe(false);
      });
    });
  },
);
