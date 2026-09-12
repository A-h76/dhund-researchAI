import { Injectable } from '@nestjs/common';
import { PlatformLogger } from '../platform/logging';

export interface ChatMetricsSnapshot {
  readonly turns: number;
  readonly ttftMsTotal: number;
  readonly chatLatencyMsTotal: number;
  readonly retrievalLatencyMsTotal: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costMicros: number;
  readonly lastTtftMs: number | null;
  readonly lastChatLatencyMs: number | null;
  readonly lastRetrievalLatencyMs: number | null;
}

@Injectable()
export class ChatMetrics {
  private turns = 0;
  private ttftMsTotal = 0;
  private chatLatencyMsTotal = 0;
  private retrievalLatencyMsTotal = 0;
  private tokensIn = 0;
  private tokensOut = 0;
  private costMicros = 0;
  private lastTtftMs: number | null = null;
  private lastChatLatencyMs: number | null = null;
  private lastRetrievalLatencyMs: number | null = null;

  constructor(private readonly logger: PlatformLogger) {}

  recordTurn(input: {
    readonly ttftMs: number | null;
    readonly chatLatencyMs: number;
    readonly retrievalLatencyMs: number;
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly costMicros: number;
  }): void {
    this.turns += 1;
    if (input.ttftMs !== null) {
      this.ttftMsTotal += input.ttftMs;
      this.lastTtftMs = input.ttftMs;
    }
    this.chatLatencyMsTotal += input.chatLatencyMs;
    this.retrievalLatencyMsTotal += input.retrievalLatencyMs;
    this.tokensIn += input.tokensIn;
    this.tokensOut += input.tokensOut;
    this.costMicros += input.costMicros;
    this.lastChatLatencyMs = input.chatLatencyMs;
    this.lastRetrievalLatencyMs = input.retrievalLatencyMs;
    this.logger.info({
      module: 'orchestration.chat',
      message: 'chat.turn.completed',
      ttftMs: input.ttftMs,
      chatLatencyMs: input.chatLatencyMs,
      retrievalLatencyMs: input.retrievalLatencyMs,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costMicros: input.costMicros,
    });
  }

  snapshot(): ChatMetricsSnapshot {
    return {
      turns: this.turns,
      ttftMsTotal: this.ttftMsTotal,
      chatLatencyMsTotal: this.chatLatencyMsTotal,
      retrievalLatencyMsTotal: this.retrievalLatencyMsTotal,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      costMicros: this.costMicros,
      lastTtftMs: this.lastTtftMs,
      lastChatLatencyMs: this.lastChatLatencyMs,
      lastRetrievalLatencyMs: this.lastRetrievalLatencyMs,
    };
  }
}
