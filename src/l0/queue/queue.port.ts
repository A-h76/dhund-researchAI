export const QUEUE_SERVICE = Symbol('QUEUE_SERVICE');

export interface QueueService {
  ping(): Promise<boolean>;
}
