import { Inject, Injectable } from '@nestjs/common';
import {
  PASSWORD_POLICY_MAX_LENGTH,
  PASSWORD_POLICY_MIN_LENGTH,
  passwordRejected,
} from '../../platform/errors';
import { PlatformLogger } from '../../platform/logging';
import { RegistrationMetrics } from '../registration/registration.metrics';
import {
  PASSWORD_BREACH_LIST,
  type BreachListPort,
} from './breach-list.port';

@Injectable()
export class PasswordPolicy {
  constructor(
    @Inject(PASSWORD_BREACH_LIST) private readonly breachList: BreachListPort,
    private readonly logger: PlatformLogger,
    private readonly metrics: RegistrationMetrics,
  ) {}

  async assertAcceptable(password: string): Promise<void> {
    if (password.length < PASSWORD_POLICY_MIN_LENGTH) {
      throw passwordRejected('min_length', { module: 'iam' });
    }

    if (password.length > PASSWORD_POLICY_MAX_LENGTH) {
      throw passwordRejected('max_length', { module: 'iam' });
    }

    const verdict = await this.breachList.check(password);
    if (verdict === 'unavailable') {
      this.metrics.recordBreachListDegraded();
      this.logger.warn({
        module: 'iam',
        message: 'password.breach_list.degraded',
      });
      return;
    }

    if (verdict === 'breached') {
      throw passwordRejected('breached', { module: 'iam' });
    }
  }
}
