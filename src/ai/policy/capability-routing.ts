import type { AiCapability } from '../capability';
import { GatewayError } from '../gateway/gateway.errors';
import { RuntimeRole } from '../../platform/runtime/role';

const INTERACTIVE_CAPABILITIES = new Set<AiCapability>([
  'CHAT',
  'AUTOCOMPLETE',
  'RERANK',
]);

const BATCH_CAPABILITIES = new Set<AiCapability>([
  'EMBED',
  'EXTRACT_CELL',
  'SCREENING',
  'STANCE',
  'SYNTHESIS',
  'OCR',
  'EVIDENCE_EXTRACT',
]);

export function isInteractiveCapability(capability: AiCapability): boolean {
  return INTERACTIVE_CAPABILITIES.has(capability);
}

export function isBatchCapability(capability: AiCapability): boolean {
  return BATCH_CAPABILITIES.has(capability);
}

export function assertRoleAllowed(
  runtimeRole: RuntimeRole,
  capability: AiCapability,
): void {
  if (runtimeRole === RuntimeRole.Api && !isInteractiveCapability(capability)) {
    throw new GatewayError(
      'capability_role_mismatch',
      `Capability ${capability} is not permitted on the api runtime role`,
    );
  }

  if (runtimeRole === RuntimeRole.Worker && !isBatchCapability(capability)) {
    throw new GatewayError(
      'capability_role_mismatch',
      `Capability ${capability} is not permitted on the worker runtime role`,
    );
  }
}
