import type { GatewayContext, GatewayRequest } from '../gateway/gateway.types';
import type { BoundaryRefusalReason } from './boundary-reasons';

const URL_KEY_NAMES = new Set([
  'presignedurl',
  'signedurl',
  'presignedgeturl',
  'presignedputurl',
  'geturl',
  'puturl',
]);

const BYTE_KEY_NAMES = new Set(['bytes', 'buffer', 'objectbytes', 'bytecontent', 'filebytes']);

const KNOWN_TEXT_KEYS = new Set([
  'capability',
  'userMessage',
  'documentContent',
  'systemInstructions',
  'texts',
  'inputType',
  'expectedDimensions',
  'query',
  'candidates',
  'prefix',
  'columnKey',
  'criteria',
  'claim',
  'evidenceSummaries',
  'objectKey',
  'locatorCatalog',
]);

export function findBoundaryRefusal(
  ctx: GatewayContext,
  request: GatewayRequest,
): BoundaryRefusalReason | undefined {
  if (ctx.declaredClinical === true) {
    return 'declared_clinical';
  }

  return findObjectStorageRefusal(request);
}

function findObjectStorageRefusal(request: GatewayRequest): BoundaryRefusalReason | undefined {
  const record = request as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    const normalized = key.replace(/_/g, '').toLowerCase();

    if (URL_KEY_NAMES.has(normalized)) {
      return 'presigned_url_not_ocr';
    }

    if (BYTE_KEY_NAMES.has(normalized) || isBytePayload(value)) {
      return 'object_storage_bytes_not_ocr';
    }

    if (key === 'objectKey') {
      if (typeof value === 'string' && looksLikePresignedOrHttpUrl(value)) {
        return 'presigned_url_not_ocr';
      }
      if (request.capability !== 'OCR') {
        return 'object_storage_bytes_not_ocr';
      }
    }

    if (!KNOWN_TEXT_KEYS.has(key) && typeof value === 'string' && looksLikePresignedOrHttpUrl(value)) {
      return 'presigned_url_not_ocr';
    }
  }

  return undefined;
}

function isBytePayload(value: unknown): boolean {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function looksLikePresignedOrHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }
  if (/[?&]X-Amz-Signature=/i.test(trimmed)) {
    return true;
  }
  if (/[?&]Signature=/i.test(trimmed) && /[?&]Expires=/i.test(trimmed)) {
    return true;
  }
  return false;
}
