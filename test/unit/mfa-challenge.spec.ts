import { decodeProtectedHeader } from 'jose';
import { AccessTokenService } from '../../src/iam/tokens/access-token.service';
import { MfaChallengeService } from '../../src/iam/tokens/mfa-challenge.service';
import {
  MFA_CHALLENGE_PURPOSE,
  MFA_CHALLENGE_TYP,
} from '../../src/iam/tokens/mfa-challenge.constants';
import { generateId } from '../../src/platform/ids/uuid-v7';
import { installTestAppConfig } from '../fixtures/app-config.fixture';
import { generateTestJwtConfig } from '../fixtures/jwt-keys.fixture';
import { MemorySessionStore } from '../fixtures/memory-session-store';

describe('MFA challenge JWS', () => {
  const jwt = generateTestJwtConfig();
  const userId = generateId();
  const store = new MemorySessionStore();
  const config = installTestAppConfig({ jwt });
  const challenges = new MfaChallengeService(config);
  const access = new AccessTokenService(config, store);

  it('signs a distinguishable mfa_pending token that access verify rejects', async () => {
    const token = await challenges.sign(userId);
    const header = decodeProtectedHeader(token);
    expect(header.typ).toBe(MFA_CHALLENGE_TYP);
    expect(header.alg).toBe('EdDSA');
    const verified = await challenges.verify(token);
    expect(verified).toMatchObject({
      sub: userId,
      purpose: MFA_CHALLENGE_PURPOSE,
    });
    await expect(access.verify(token)).rejects.toMatchObject({ code: 'token_invalid' });
  });
});
