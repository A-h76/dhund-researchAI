import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { DomainError, ErrorCode } from '../../platform/errors';
import { readBearerToken } from '../auth/parse-auth-request';
import { AccessTokenService } from '../tokens/access-token.service';
import { AccessContextMetrics } from './access-context.metrics';
import { ACCESS_USER_ID_KEY } from './metadata';
import {
  readAuthorizationHeader,
  type AccessAwareRequest,
} from './request-access';

@Injectable()
export class AccessAuthGuard implements CanActivate {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly metrics: AccessContextMetrics,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AccessAwareRequest>();
    try {
      const token = readBearerToken(readAuthorizationHeader(request));
      const user = await this.accessTokens.verify(token);
      request[ACCESS_USER_ID_KEY] = user.sub;
      return true;
    } catch (error) {
      this.metrics.recordDenial('unauthenticated');
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(ErrorCode.Unauthenticated, { module: 'iam' });
    }
  }
}
