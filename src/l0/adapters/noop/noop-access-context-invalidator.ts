import { Injectable } from '@nestjs/common';
import type { AccessContextInvalidator } from '../../ports/access-context-invalidator.port';

@Injectable()
export class NoopAccessContextInvalidator implements AccessContextInvalidator {
  async invalidateAccessContext(userId: string): Promise<void> {
    void userId;
  }
}
