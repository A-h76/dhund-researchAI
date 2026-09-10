import { Inject, Injectable } from '@nestjs/common';
import { readBearerToken } from '../iam/auth/parse-auth-request';
import { AccessContextService } from '../iam/authorization/access-context.service';
import { AccessTokenService } from '../iam/tokens/access-token.service';
import { COUNTER_SERVICE, type CounterService } from '../l0/ports';
import { DomainError, ErrorCode } from '../platform/errors';
import { getCorrelationId } from '../platform/logging';
import { projectScopeFrom } from '../platform/persistence/project-scope';
import { RuntimeRole } from '../platform/runtime/role';
import { parseRetrievalSearchRequest } from './parse-retrieval-request';
import {
  RETRIEVAL_RATE_LIMIT_MAX,
  RETRIEVAL_RATE_LIMIT_TTL_SECONDS,
  retrievalRateLimitKey,
} from './rate-limit';
import { RETRIEVAL_SERVICE, type IRetrievalService } from './retrieval.port';
import { toSearchResponse, type RetrievalSearchResponse } from './search-dto';

const MODULE = 'retrieval';

@Injectable()
export class RetrievalSearchService {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly accessContext: AccessContextService,
    @Inject(RETRIEVAL_SERVICE) private readonly retrieval: IRetrievalService,
    @Inject(COUNTER_SERVICE) private readonly counters: CounterService,
  ) {}

  async search(
    authorization: string | undefined,
    projectId: string,
    body: unknown,
  ): Promise<RetrievalSearchResponse> {
    const parsed = parseRetrievalSearchRequest(body);
    const user = await this.accessTokens.verify(readBearerToken(authorization));
    const context = await this.accessContext.resolve(user.sub);
    const scope = projectScopeFrom(context, projectId, MODULE);
    const membership = context.projects.find((row) => row.projectId === scope.projectId);
    if (membership === undefined) {
      throw new DomainError(ErrorCode.NotFound, { module: MODULE });
    }
    await this.enforceRateLimit(membership.orgId, user.sub);
    const result = await this.retrieval.retrieve({
      orgId: membership.orgId,
      projectId: scope.projectId,
      query: parsed.query,
      k: parsed.k,
      includeUnresolved: parsed.includeUnresolved,
      correlationId: getCorrelationId() ?? 'missing-correlation',
      runtimeRole: RuntimeRole.Api,
    });
    return toSearchResponse(result);
  }

  private async enforceRateLimit(orgId: string, userId: string): Promise<void> {
    const allowed = await this.counters.incrementIfBelow(
      retrievalRateLimitKey(orgId, userId),
      RETRIEVAL_RATE_LIMIT_MAX,
      RETRIEVAL_RATE_LIMIT_TTL_SECONDS,
    );
    if (!allowed) {
      throw new DomainError(ErrorCode.RateLimited, {
        module: MODULE,
        details: { retryAfterSeconds: RETRIEVAL_RATE_LIMIT_TTL_SECONDS },
      });
    }
  }
}
