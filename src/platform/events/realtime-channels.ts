/** Advisory realtime projection channel prefix — not authoritative. */
export const REALTIME_PROJECTION_CHANNEL_PREFIX = 'realtime:projections';

export function realtimeChannelForOrg(orgId: string): string {
  return `${REALTIME_PROJECTION_CHANNEL_PREFIX}:${orgId}`;
}
