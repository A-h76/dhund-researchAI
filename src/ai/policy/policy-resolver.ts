import { Injectable } from '@nestjs/common';
import type { AiCapability } from '../capability';
import type { GatewayRequest } from '../gateway/gateway.types';
import {
  EMBED_DIMENSION,
  EMBED_MODEL_ID,
  EMBED_MODEL_VERSION,
} from './embed-policy.constants';
import type { PolicyDecision } from './policy.types';

const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
const OPENAI_RERANK_MODEL = 'gpt-4o-mini';

@Injectable()
export class PolicyResolver {
  resolve(request: GatewayRequest): PolicyDecision {
    switch (request.capability) {
      case 'EMBED':
        return {
          capability: 'EMBED',
          provider: 'voyage',
          modelId: EMBED_MODEL_ID,
          promptVersion: EMBED_MODEL_VERSION,
          embedModelVersion: EMBED_MODEL_VERSION,
          dimension: EMBED_DIMENSION,
          inputType: request.inputType,
        };
      case 'CHAT':
        return {
          capability: 'CHAT',
          provider: 'openai',
          modelId: OPENAI_CHAT_MODEL,
          promptVersion: 'chat_v1',
        };
      case 'RERANK':
        return {
          capability: 'RERANK',
          provider: 'openai',
          modelId: OPENAI_RERANK_MODEL,
          promptVersion: 'rerank_v1',
        };
      case 'AUTOCOMPLETE':
        return {
          capability: 'AUTOCOMPLETE',
          provider: 'openai',
          modelId: OPENAI_CHAT_MODEL,
          promptVersion: 'autocomplete_v1',
        };
      case 'EXTRACT_CELL':
        return {
          capability: 'EXTRACT_CELL',
          provider: 'openai',
          modelId: OPENAI_CHAT_MODEL,
          promptVersion: 'extract_cell_v1',
        };
      case 'SCREENING':
        return {
          capability: 'SCREENING',
          provider: 'openai',
          modelId: OPENAI_CHAT_MODEL,
          promptVersion: 'screening_v1',
        };
      case 'STANCE':
        return {
          capability: 'STANCE',
          provider: 'openai',
          modelId: OPENAI_CHAT_MODEL,
          promptVersion: 'stance_v1',
        };
      case 'SYNTHESIS':
        return {
          capability: 'SYNTHESIS',
          provider: 'openai',
          modelId: OPENAI_CHAT_MODEL,
          promptVersion: 'synthesis_v1',
        };
      case 'OCR':
        return {
          capability: 'OCR',
          provider: 'openai',
          modelId: OPENAI_CHAT_MODEL,
          promptVersion: 'ocr_v1',
        };
      default: {
        const _exhaustive: never = request;
        throw new Error(`Unhandled capability: ${String(_exhaustive)}`);
      }
    }
  }

  resolveForCapability(capability: AiCapability): PolicyDecision {
    return this.resolve(buildMinimalRequest(capability));
  }
}

function buildMinimalRequest(capability: AiCapability): GatewayRequest {
  switch (capability) {
    case 'EMBED':
      return {
        capability: 'EMBED',
        texts: ['probe'],
        inputType: 'query',
      };
    case 'CHAT':
      return { capability: 'CHAT', userMessage: 'probe' };
    case 'RERANK':
      return { capability: 'RERANK', query: 'probe', candidates: ['a'] };
    case 'AUTOCOMPLETE':
      return { capability: 'AUTOCOMPLETE', prefix: 'probe' };
    case 'EXTRACT_CELL':
      return {
        capability: 'EXTRACT_CELL',
        columnKey: 'probe',
        documentContent: 'probe',
      };
    case 'SCREENING':
      return {
        capability: 'SCREENING',
        criteria: 'probe',
        documentContent: 'probe',
      };
    case 'STANCE':
      return {
        capability: 'STANCE',
        claim: 'probe',
        documentContent: 'probe',
      };
    case 'SYNTHESIS':
      return {
        capability: 'SYNTHESIS',
        evidenceSummaries: ['probe'],
      };
    case 'OCR':
      return { capability: 'OCR', objectKey: 'probe-key' };
    default: {
      const _exhaustive: never = capability;
      throw new Error(`Unhandled capability: ${String(_exhaustive)}`);
    }
  }
}
