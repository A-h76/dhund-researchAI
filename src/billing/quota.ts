import { deriveEntitlement, type Entitlement } from './entitlement';

/**
 * Billing quota is not the per-org batch concurrency gate and not a research-run
 * budget. With no numeric caps configured, admission cannot compare usage to a
 * number. Restrictive (unknown) plans stay restrictive. Production charging stays
 * blocked until GAP-PLAN-01 supplies caps.
 */
export type QuotaAdmission =
  | { readonly outcome: 'open'; readonly entitlement: Entitlement }
  | { readonly outcome: 'restrictive'; readonly entitlement: Entitlement };

export function admitQuota(planCode: string): QuotaAdmission {
  const entitlement = deriveEntitlement(planCode);
  switch (entitlement.kind) {
    case 'restrictive':
      return { outcome: 'restrictive', entitlement };
    case 'mapped':
      return { outcome: 'open', entitlement };
    default: {
      const unhandled: never = entitlement.kind;
      throw new Error(`Unhandled entitlement kind: ${String(unhandled)}`);
    }
  }
}
