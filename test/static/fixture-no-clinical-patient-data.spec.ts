import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FIXTURES_ROOT = join(__dirname, '..', 'fixtures');

/**
 * Fixture safeguard only. This does not inspect production documents
 * and is not a declared-clinical refusal path.
 */
const FORBIDDEN_FIXTURE =
  /\b(?:patient_id|patient_name|mrn|medical_record_number|clinical_identifier|ssn|social_security)\b/i;

export function findClinicalPatientFixtureHits(content: string): string[] {
  return content.match(new RegExp(FORBIDDEN_FIXTURE.source, 'gi')) ?? [];
}

function collectFiles(dir: string): Array<{ path: string; content: string }> {
  const entries = readdirSync(dir);
  const files: Array<{ path: string; content: string }> = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    files.push({
      path: relative(process.cwd(), fullPath).replace(/\\/g, '/'),
      content: readFileSync(fullPath, 'utf8'),
    });
  }

  return files;
}

describe('fixture lint: no clinical patient data in test fixtures (DHB-47)', () => {
  it('fails on seeded PHI-shaped patient-record strings', () => {
    const poisoned = 'seed patient_id=abc mrn=123456 medical_record_number=999';
    expect(findClinicalPatientFixtureHits(poisoned).length).toBeGreaterThan(0);
  });

  it('rejects those strings in test/fixtures', () => {
    const hits = collectFiles(FIXTURES_ROOT).flatMap((file) =>
      findClinicalPatientFixtureHits(file.content).map((match) => `${file.path}: ${match}`),
    );
    expect(hits).toEqual([]);
  });
});
