import type { GatewayRequest } from '../gateway/gateway.types';
import { GatewayError } from '../gateway/gateway.errors';
import {
  EMBED_DIMENSION,
  VOYAGE_EMBED_MAX_TEXTS,
  VOYAGE_EMBED_MAX_TOKENS,
} from '../policy/embed-policy.constants';

export function validateEmbedRequest(request: Extract<GatewayRequest, { capability: 'EMBED' }>): void {
  if (request.inputType !== 'query' && request.inputType !== 'document') {
    throw new GatewayError('embed_input_type_missing', 'EMBED requires inputType query or document');
  }

  if (request.texts.length === 0) {
    throw new GatewayError('validation_error', 'EMBED requires at least one text');
  }

  if (request.texts.length > VOYAGE_EMBED_MAX_TEXTS) {
    throw new GatewayError(
      'embed_request_cap_exceeded',
      `EMBED supports at most ${String(VOYAGE_EMBED_MAX_TEXTS)} texts per request`,
    );
  }

  const estimatedTokens = estimateTokenCount(request.texts);
  if (estimatedTokens > VOYAGE_EMBED_MAX_TOKENS) {
    throw new GatewayError(
      'embed_request_cap_exceeded',
      `EMBED supports at most ${String(VOYAGE_EMBED_MAX_TOKENS)} tokens per request`,
    );
  }

  if (request.expectedDimensions !== undefined) {
    for (const dimension of request.expectedDimensions) {
      if (dimension !== EMBED_DIMENSION) {
        throw new GatewayError(
          'embed_dimension_mismatch',
          `Embedding dimension ${String(dimension)} is not supported; schema requires ${String(EMBED_DIMENSION)}`,
        );
      }
    }
  }
}

export function validateGatewayRequest(request: GatewayRequest): void {
  if (request.capability === 'EMBED') {
    validateEmbedRequest(request);
  }
}

function estimateTokenCount(texts: readonly string[]): number {
  return texts.reduce((total, text) => total + Math.ceil(text.length / 4), 0);
}
