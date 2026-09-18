import { generateId } from '../../src/platform/ids/uuid-v7';
import { jsonbOnlyClaimIds, relationalReachability } from '../../src/evidence/claim-arg-conformance';
import { supportStatusFromLinks } from '../../src/evidence/claims-graph.service';

describe('GAP-CLAIM-ARG-01 relational reachability', () => {
  const linked = generateId();
  const jsonbOnly = generateId();

  it('treats argument_claim_links as the only authoritative claim membership', () => {
    const structure = {
      claimIds: [linked, jsonbOnly],
      notes: 'decorative copy of claim ids',
    };
    const result = relationalReachability({
      structure,
      relationalClaimIds: [linked],
    });
    expect(result.relationalClaimIds).toEqual([linked]);
    expect(result.jsonbOnlyClaimIds).toEqual([jsonbOnly]);
    expect(result.passes).toBe(false);
  });

  it('passes when JSONB claim ids are also present on argument_claim_links', () => {
    const structure = { claims: [{ claimId: linked, text: 'shown in UI' }] };
    const result = relationalReachability({
      structure,
      relationalClaimIds: [linked],
    });
    expect(result.passes).toBe(true);
    expect(jsonbOnlyClaimIds(structure, [linked])).toEqual([]);
  });

  it('fails when a claim is reachable only through argument JSONB', () => {
    expect(
      jsonbOnlyClaimIds({ claimIds: [jsonbOnly] }, []),
    ).toEqual([jsonbOnly]);
  });
});

describe('claim support status (§11.4)', () => {
  it('marks a claim with no supporting evidence as unsupported', () => {
    expect(supportStatusFromLinks([])).toBe('unsupported');
    expect(
      supportStatusFromLinks([
        { id: '1', evidenceId: 'e1', claimId: 'c', stance: 'contradicts' },
      ]),
    ).toBe('unsupported');
  });

  it('preserves supporting and contradicting evidence as conflicting', () => {
    expect(
      supportStatusFromLinks([
        { id: '1', evidenceId: 'e1', claimId: 'c', stance: 'supports' },
        { id: '2', evidenceId: 'e2', claimId: 'c', stance: 'contradicts' },
      ]),
    ).toBe('conflicting');
  });
});
