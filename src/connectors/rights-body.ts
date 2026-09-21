import { DomainError, ErrorCode } from '../platform/errors';

/**
 * PX-b: requesting a body when rights forbid it is a hard rejection.
 * Callers must fall back to metadata_only evidence — never store forbidden bytes.
 */
export class RightsBodyForbiddenError extends DomainError {
  constructor() {
    super(ErrorCode.Forbidden, {
      module: 'connectors',
      serverDetail: 'rights.body=false: body fetch rejected (PX-b)',
    });
    this.name = 'RightsBodyForbiddenError';
  }
}

export function assertBodyFetchPermitted(input: {
  readonly includeBody: boolean;
  readonly rightsBody: boolean;
}): void {
  if (input.includeBody && !input.rightsBody) {
    throw new RightsBodyForbiddenError();
  }
}
