import { Argon2PasswordHasher } from '../../src/iam/password/argon2-hasher';
import { installTestAppConfig } from '../fixtures/app-config.fixture';

describe('Argon2id password hasher', () => {
  it('encodes with argon2id and the configured m=65536,t=3,p=4 parameters', async () => {
    const config = installTestAppConfig();
    const hasher = new Argon2PasswordHasher(config);
    const encoded = await hasher.hash('abcdefghijkl');

    expect(encoded.startsWith('$argon2id$')).toBe(true);
    expect(encoded).toContain('m=65536');
    expect(encoded).toContain('t=3');
    expect(encoded).toContain('p=4');
    expect(encoded).not.toContain('abcdefghijkl');
  });

  it('verifies a matching password and rejects a wrong one', async () => {
    const config = installTestAppConfig();
    const hasher = new Argon2PasswordHasher(config);
    const encoded = await hasher.hash('abcdefghijkl');

    await expect(hasher.verify('abcdefghijkl', encoded)).resolves.toBe(true);
    await expect(hasher.verify('wrong-password', encoded)).resolves.toBe(false);
    await expect(hasher.verify('abcdefghijkl', 'not-a-hash')).resolves.toBe(false);
  });
});
