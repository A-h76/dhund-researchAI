import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
const ACTIVE = SCHEMA.replace(/\/\/.*$/gm, '');

describe('Prisma persistence conventions (DHB-28)', () => {
  it('uses PostgreSQL only', () => {
    expect(ACTIVE).toMatch(/provider\s*=\s*"postgresql"/);
    expect(ACTIVE).not.toMatch(/sqlite/i);
  });

  it('uses native UUID PKs without DB-generated defaults', () => {
    expect(ACTIVE).toMatch(/id\s+String\s+@id\s+@db\.Uuid/);
    expect(ACTIVE).not.toMatch(/@default\(uuid\(\)\)/);
    expect(ACTIVE).not.toMatch(/@default\(dbgenerated/i);
  });

  it('maps created_at and updated_at as Timestamptz', () => {
    expect(ACTIVE).toMatch(
      /createdAt\s+DateTime\s+@map\("created_at"\)\s+@db\.Timestamptz/,
    );
    expect(ACTIVE).toMatch(
      /updatedAt\s+DateTime[\s\S]*@map\("updated_at"\)\s+@db\.Timestamptz/,
    );
  });

  it('uses snake_case table mapping and jsonb + integer micros', () => {
    expect(ACTIVE).toMatch(/@@map\("_persistence_convention_fixture"\)/);
    expect(ACTIVE).toMatch(/metadata\s+Json\s+@map\("metadata"\)\s+@db\.JsonB/);
    expect(ACTIVE).toMatch(/costMicros\s+BigInt\s+@map\("cost_micros"\)/);
    expect(ACTIVE).not.toMatch(/costMicros\s+Float/);
    expect(ACTIVE).not.toMatch(/costMicros\s+Decimal/);
  });

  it('documents that created_at is not the UUIDv7 embedded timestamp', () => {
    expect(SCHEMA.toLowerCase()).toContain('never uuidv7 embedded time');
  });
});
