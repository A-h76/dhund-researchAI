import { MfaService } from '../../src/iam/auth/mfa.service';

export const stubMfaServiceProvider = {
  provide: MfaService,
  useValue: {
    enrol: async () => ({ secret: 'stub', otpauthUrl: 'otpauth://totp/stub' }),
    confirm: async () => ({ recoveryCodes: [] }),
    disable: async () => undefined,
    issueRecovery: async () => ({ recoveryCodes: [] }),
    verify: async () => undefined,
  },
};
