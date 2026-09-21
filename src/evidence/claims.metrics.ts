import { Injectable } from '@nestjs/common';
import type { ClaimSupportStatus } from '../l0/ports/evidence-spine.port';

@Injectable()
export class ClaimsMetrics {
  private created = 0;
  private unsupported = 0;
  private argumentLinks = 0;
  private conflictingClaims = 0;
  private synthesized = 0;
  private synthesisFailures = 0;
  private synthesisCostMicros = 0;
  private synthesisLatencyMs = 0;
  private unresolvedShareTotal = 0;

  recordClaimCreated(status: ClaimSupportStatus): void {
    this.created += 1;
    if (status === 'unsupported') {
      this.unsupported += 1;
    }
    if (status === 'conflicting') {
      this.conflictingClaims += 1;
    }
  }

  recordArgumentLink(): void {
    this.argumentLinks += 1;
  }

  recordSupportStatus(status: ClaimSupportStatus): void {
    if (status === 'unsupported') {
      this.unsupported += 1;
    }
    if (status === 'conflicting') {
      this.conflictingClaims += 1;
    }
  }

  recordSynthesis(input: {
    readonly costMicros: number;
    readonly latencyMs: number;
    readonly unresolvedShare: number;
  }): void {
    this.synthesized += 1;
    this.synthesisCostMicros += input.costMicros;
    this.synthesisLatencyMs += input.latencyMs;
    this.unresolvedShareTotal += input.unresolvedShare;
    this.recordClaimCreated(
      input.unresolvedShare > 0 && input.unresolvedShare < 1 ? 'conflicting' : 'supported',
    );
  }

  recordSynthesisFailure(): void {
    this.synthesisFailures += 1;
  }

  snapshot(): {
    claimsCreated: number;
    unsupportedShare: number;
    argumentsPerClaim: number;
    conflictingEvidenceFrequency: number;
    claimsSynthesized: number;
    synthesisFailureCount: number;
    synthesisCostMicros: number;
    synthesisLatencyMs: number;
    averageUnresolvedShareInSynthesis: number;
  } {
    return {
      claimsCreated: this.created,
      unsupportedShare: this.created === 0 ? 0 : this.unsupported / this.created,
      argumentsPerClaim: this.created === 0 ? 0 : this.argumentLinks / this.created,
      conflictingEvidenceFrequency:
        this.created === 0 ? 0 : this.conflictingClaims / this.created,
      claimsSynthesized: this.synthesized,
      synthesisFailureCount: this.synthesisFailures,
      synthesisCostMicros: this.synthesisCostMicros,
      synthesisLatencyMs: this.synthesisLatencyMs,
      averageUnresolvedShareInSynthesis:
        this.synthesized === 0 ? 0 : this.unresolvedShareTotal / this.synthesized,
    };
  }

  reset(): void {
    this.created = 0;
    this.unsupported = 0;
    this.argumentLinks = 0;
    this.conflictingClaims = 0;
    this.synthesized = 0;
    this.synthesisFailures = 0;
    this.synthesisCostMicros = 0;
    this.synthesisLatencyMs = 0;
    this.unresolvedShareTotal = 0;
  }
}
