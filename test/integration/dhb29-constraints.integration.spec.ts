import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { generateId } from '../../src/platform/ids/uuid-v7';

const integrationEnabled = process.env.RUN_INTEGRATION_TESTS === 'true';
const ROOT = join(__dirname, '..', '..');

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /unique|duplicate key/i.test(msg);
}

function isCheckViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004') {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /check constraint|violates check/i.test(msg);
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

(integrationEnabled ? describe : describe.skip)(
  'DHB-29 schema constraints (Phase 2 §15.2 / GAP-ORG-OWNER-01)',
  () => {
    jest.setTimeout(240_000);

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
        data: {
          id,
          email,
          displayName: 'Test User',
        },
      });
      return id;
    }

    describe('unique constraints', () => {
      it('rejects duplicate users.email', async () => {
        const email = `dup-${generateId()}@example.com`;
        await insertUser(email);
        await expectRejectsUnique(() => insertUser(email));
      });

      it('rejects duplicate credentials.user_id', async () => {
        const userId = await insertUser(`cred-${generateId()}@example.com`);
        await prisma.credential.create({
          data: {
            id: generateId(),
            userId,
            passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc',
          },
        });
        await expectRejectsUnique(() =>
          prisma.credential.create({
            data: {
              id: generateId(),
              userId,
              passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$def',
            },
          }),
        );
      });

      it('rejects duplicate refresh_token_families.current_token_hash', async () => {
        const userId = await insertUser(`rtf-${generateId()}@example.com`);
        const sessionId = generateId();
        await prisma.session.create({
          data: {
            id: sessionId,
            userId,
            issuedAt: new Date(),
            sessionVersion: 1,
          },
        });
        const hash = `hash-${generateId()}`;
        await prisma.refreshTokenFamily.create({
          data: {
            id: generateId(),
            userId,
            sessionId,
            currentTokenHash: hash,
            issuedAt: new Date(),
          },
        });
        const session2 = generateId();
        await prisma.session.create({
          data: {
            id: session2,
            userId,
            issuedAt: new Date(),
            sessionVersion: 1,
          },
        });
        await expectRejectsUnique(() =>
          prisma.refreshTokenFamily.create({
            data: {
              id: generateId(),
              userId,
              sessionId: session2,
              currentTokenHash: hash,
              issuedAt: new Date(),
            },
          }),
        );
      });

      it('rejects duplicate totp_secrets.user_id', async () => {
        const userId = await insertUser(`totp-${generateId()}@example.com`);
        await prisma.totpSecret.create({
          data: {
            id: generateId(),
            userId,
            secretCiphertext: Buffer.from('ciphertext-1'),
          },
        });
        await expectRejectsUnique(() =>
          prisma.totpSecret.create({
            data: {
              id: generateId(),
              userId,
              secretCiphertext: Buffer.from('ciphertext-2'),
            },
          }),
        );
      });

      it('rejects duplicate mfa_recovery_codes (user_id, code_hash)', async () => {
        const userId = await insertUser(`mfa-${generateId()}@example.com`);
        const codeHash = `code-${generateId()}`;
        await prisma.mfaRecoveryCode.create({
          data: { id: generateId(), userId, codeHash },
        });
        await expectRejectsUnique(() =>
          prisma.mfaRecoveryCode.create({
            data: { id: generateId(), userId, codeHash },
          }),
        );
      });

      it('rejects duplicate auth_tokens.token_hash', async () => {
        const userId = await insertUser(`atok-${generateId()}@example.com`);
        const tokenHash = `th-${generateId()}`;
        await prisma.authToken.create({
          data: {
            id: generateId(),
            userId,
            purpose: 'email_verification',
            tokenHash,
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
        await expectRejectsUnique(() =>
          prisma.authToken.create({
            data: {
              id: generateId(),
              userId,
              purpose: 'password_reset',
              tokenHash,
              expiresAt: new Date(Date.now() + 3_600_000),
            },
          }),
        );
      });

      it('rejects duplicate stripe_subscription_id', async () => {
        const userId = await insertUser(`sub-${generateId()}@example.com`);
        const orgId = generateId();
        await prisma.organization.create({
          data: {
            id: orgId,
            kind: 'PERSONAL',
            name: 'Personal',
            ownerUserId: userId,
          },
        });
        const stripeId = `sub_${generateId()}`;
        await prisma.subscription.create({
          data: {
            id: generateId(),
            orgId,
            stripeSubscriptionId: stripeId,
            planCode: 'placeholder',
            status: 'active',
            periodStart: new Date(),
            periodEnd: new Date(Date.now() + 86400000),
          },
        });
        await expectRejectsUnique(() =>
          prisma.subscription.create({
            data: {
              id: generateId(),
              orgId,
              stripeSubscriptionId: stripeId,
              planCode: 'placeholder',
              status: 'active',
              periodStart: new Date(),
              periodEnd: new Date(Date.now() + 86400000),
            },
          }),
        );
      });

      it('rejects duplicate usage_counters (org_id, period, metric)', async () => {
        const userId = await insertUser(`usage-${generateId()}@example.com`);
        const orgId = generateId();
        await prisma.organization.create({
          data: {
            id: orgId,
            kind: 'PERSONAL',
            name: 'Personal',
            ownerUserId: userId,
          },
        });
        const period = '2026-01-01/2026-02-01';
        const start = new Date('2026-01-01T00:00:00Z');
        const end = new Date('2026-02-01T00:00:00Z');
        await prisma.usageCounter.create({
          data: {
            id: generateId(),
            orgId,
            period,
            periodStart: start,
            periodEnd: end,
            metric: 'ai_tokens',
            value: 1n,
          },
        });
        await expectRejectsUnique(() =>
          prisma.usageCounter.create({
            data: {
              id: generateId(),
              orgId,
              period,
              periodStart: start,
              periodEnd: end,
              metric: 'ai_tokens',
              value: 2n,
            },
          }),
        );
      });

      it('rejects duplicate stripe_events.id (webhook replay short-circuit)', async () => {
        const eventId = `evt_${generateId()}`;
        await prisma.stripeEvent.create({
          data: {
            id: eventId,
            type: 'customer.subscription.updated',
            payload: { ok: true },
          },
        });
        await expectRejectsUnique(() =>
          prisma.stripeEvent.create({
            data: {
              id: eventId,
              type: 'customer.subscription.updated',
              payload: { ok: true },
            },
          }),
        );
      });

      it('rejects duplicate idempotency_records (scope, key)', async () => {
        const scope = `user:${generateId()}`;
        const key = `reg-${generateId()}`;
        await prisma.idempotencyRecord.create({
          data: {
            id: generateId(),
            scope,
            key,
            requestFingerprint: 'fp-a',
          },
        });
        await expectRejectsUnique(() =>
          prisma.idempotencyRecord.create({
            data: {
              id: generateId(),
              scope,
              key,
              requestFingerprint: 'fp-b',
            },
          }),
        );
      });
    });

    describe('GAP-ORG-OWNER-01', () => {
      it('rejects PERSONAL org without owner_user_id', async () => {
        await expectRejectsCheck(() =>
          prisma.$executeRaw`
            INSERT INTO organizations (id, kind, name, owner_user_id, created_at)
            VALUES (${generateId()}::uuid, 'PERSONAL'::org_kind, 'No Owner', NULL, NOW())
          `,
        );
      });

      it('rejects TEAM org with owner_user_id', async () => {
        const userId = await insertUser(`team-owner-${generateId()}@example.com`);
        await expectRejectsCheck(() =>
          prisma.$executeRaw`
            INSERT INTO organizations (id, kind, name, owner_user_id, created_at)
            VALUES (${generateId()}::uuid, 'TEAM'::org_kind, 'Bad Team', ${userId}::uuid, NOW())
          `,
        );
      });

      it('rejects a second live PERSONAL org for the same user', async () => {
        const userId = await insertUser(`personal-2-${generateId()}@example.com`);
        await prisma.organization.create({
          data: {
            id: generateId(),
            kind: 'PERSONAL',
            name: 'First',
            ownerUserId: userId,
          },
        });
        await expectRejectsUnique(() =>
          prisma.organization.create({
            data: {
              id: generateId(),
              kind: 'PERSONAL',
              name: 'Second',
              ownerUserId: userId,
            },
          }),
        );
      });

      it('same idempotency path yields exactly one personal org', async () => {
        const userId = await insertUser(`idem-reg-${generateId()}@example.com`);
        const scope = `register:${userId}`;
        const key = 'registration';
        const fingerprint = 'fp-register';

        const createPersonalOrgOnce = async () => {
          await prisma.$transaction(async (tx) => {
            await tx.idempotencyRecord.create({
              data: {
                id: generateId(),
                scope,
                key,
                requestFingerprint: fingerprint,
              },
            });
            await tx.organization.create({
              data: {
                id: generateId(),
                kind: 'PERSONAL',
                name: 'Personal',
                ownerUserId: userId,
              },
            });
          });
        };

        await createPersonalOrgOnce();
        await expectRejectsUnique(() => createPersonalOrgOnce());

        const orgs = await prisma.organization.findMany({
          where: { ownerUserId: userId, kind: 'PERSONAL', deletedAt: null },
        });
        expect(orgs).toHaveLength(1);

        const keys = await prisma.idempotencyRecord.findMany({
          where: { scope, key },
        });
        expect(keys).toHaveLength(1);
      });
    });

    describe('memberships', () => {
      it('rejects double active org membership; allows re-invite after revoke', async () => {
        const memberId = await insertUser(`om-member-${generateId()}@example.com`);
        const orgId = generateId();
        await prisma.organization.create({
          data: {
            id: orgId,
            kind: 'TEAM',
            name: 'Team',
            ownerUserId: null,
          },
        });

        await prisma.orgMembership.create({
          data: {
            id: generateId(),
            orgId,
            userId: memberId,
            role: 'MEMBER',
          },
        });

        await expectRejectsUnique(() =>
          prisma.orgMembership.create({
            data: {
              id: generateId(),
              orgId,
              userId: memberId,
              role: 'ADMIN',
            },
          }),
        );

        await prisma.orgMembership.updateMany({
          where: { orgId, userId: memberId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        await expect(
          prisma.orgMembership.create({
            data: {
              id: generateId(),
              orgId,
              userId: memberId,
              role: 'MEMBER',
            },
          }),
        ).resolves.toBeDefined();
      });

      it('rejects double active project membership; allows re-invite after revoke', async () => {
        const ownerId = await insertUser(`pm-owner-${generateId()}@example.com`);
        const memberId = await insertUser(`pm-member-${generateId()}@example.com`);
        const orgId = generateId();
        await prisma.organization.create({
          data: {
            id: orgId,
            kind: 'PERSONAL',
            name: 'Personal',
            ownerUserId: ownerId,
          },
        });
        const projectId = generateId();
        await prisma.project.create({
          data: {
            id: projectId,
            orgId,
            name: 'Project',
          },
        });

        await prisma.projectMembership.create({
          data: {
            id: generateId(),
            projectId,
            userId: memberId,
            role: 'EDITOR',
          },
        });

        await expectRejectsUnique(() =>
          prisma.projectMembership.create({
            data: {
              id: generateId(),
              projectId,
              userId: memberId,
              role: 'VIEWER',
            },
          }),
        );

        await prisma.projectMembership.updateMany({
          where: { projectId, userId: memberId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        await expect(
          prisma.projectMembership.create({
            data: {
              id: generateId(),
              projectId,
              userId: memberId,
              role: 'EDITOR',
            },
          }),
        ).resolves.toBeDefined();
      });
    });

    describe('usage check', () => {
      it('rejects period_end <= period_start', async () => {
        const userId = await insertUser(`period-${generateId()}@example.com`);
        const orgId = generateId();
        await prisma.organization.create({
          data: {
            id: orgId,
            kind: 'PERSONAL',
            name: 'Personal',
            ownerUserId: userId,
          },
        });
        const t = new Date('2026-01-01T00:00:00Z');
        await expectRejectsCheck(() =>
          prisma.$executeRaw`
            INSERT INTO usage_counters (id, org_id, period, period_start, period_end, metric, value, updated_at)
            VALUES (
              ${generateId()}::uuid,
              ${orgId}::uuid,
              'bad',
              ${t},
              ${t},
              'documents'::usage_metric,
              0,
              NOW()
            )
          `,
        );
      });
    });
  },
);
