import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(__dirname, '..', '..', 'src');

describe('DHB-60 GAP-CLAIM-ARG-01 contracts', () => {
  it('treats argument_claim_links as the authoritative Claim↔Argument relation', () => {
    const service = readFileSync(join(SRC_ROOT, 'evidence', 'claims-graph.service.ts'), 'utf8');
    expect(service).toMatch(/listArgumentClaims/);
    expect(service).toMatch(/linkArgumentClaim/);
    expect(service).toMatch(/InvalidStateTransition/);
  });

  it('does not treat argument JSONB as claim membership', () => {
    const conformance = readFileSync(
      join(SRC_ROOT, 'evidence', 'claim-arg-conformance.ts'),
      'utf8',
    );
    expect(conformance).toMatch(/GAP-CLAIM-ARG-01/);
    expect(conformance).toMatch(/jsonbOnlyClaimIds/);
  });
});
