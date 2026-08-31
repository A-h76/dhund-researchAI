export interface PubSubService {
  connect(correlationId?: string): Promise<void>;
  disconnect(correlationId?: string): Promise<void>;
  ping(): Promise<boolean>;
  /** Advisory realtime projection publish — never authoritative. */
  publish(channel: string, message: string): Promise<void>;
}
