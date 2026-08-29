import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

const FORBIDDEN =
  /\b(extractUuidTimestamp|uuidTimestamp|getUuidTime|timestampFromUuid|createdAtFromUuid)\b/;

function collectSourceFiles(dir: string): Array<{ path: string; content: string }> {
  const entries = readdirSync(dir);
  const files: Array<{ path: string; content: string }> = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!entry.endsWith('.ts')) {
      continue;
    }

    files.push({
      path: relative(process.cwd(), fullPath).replace(/\\/g, '/'),
      content: readFileSync(fullPath, 'utf8'),
    });
  }

  return files;
}

describe('UUIDv7 timestamp anti-trap (GAP-PK-01)', () => {
  it('does not extract embedded UUID timestamps in src/', () => {
    const violations = collectSourceFiles(SRC_ROOT).filter((file) =>
      FORBIDDEN.test(file.content),
    );

    expect(violations).toEqual([]);
  });

  it('keeps create-time as an explicit created_at field in the convention fixture', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/createdAt\s+DateTime\s+@map\("created_at"\)/);
    expect(schema).not.toMatch(/createdAt\s+String/);
  });
});
