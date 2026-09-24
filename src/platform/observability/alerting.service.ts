import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../logging/platform-logger.service';

export const ALERT_TRIGGERS = [
  'dlq_depth',
  'slow_query',
  'error_rate_spike',
  'circuit_open',
  'broken_provenance',
] as const;

export type AlertTrigger = (typeof ALERT_TRIGGERS)[number];

export interface FiredAlert {
  readonly name: AlertTrigger;
  readonly at: string;
}

@Injectable()
export class AlertingService {
  private readonly fired: FiredAlert[] = [];

  constructor(private readonly logger: PlatformLogger) {}

  signal(name: AlertTrigger): void {
    const alert: FiredAlert = { name, at: new Date().toISOString() };
    this.fired.push(alert);
    this.logger.warn({
      module: 'observability',
      message: 'alert.fired',
      alert: name,
    });
  }

  snapshot(): readonly FiredAlert[] {
    return [...this.fired];
  }

  has(name: AlertTrigger): boolean {
    return this.fired.some((alert) => alert.name === name);
  }
}
