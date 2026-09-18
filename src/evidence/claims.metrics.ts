import { Injectable } from '@nestjs/common';
import type { ClaimSupportStatus } from '../l0/ports/evidence-spine.port';

@Injectable()
export class ClaimsMetrics {
  private created = 0;
  private unsupported = 0;
  private argumentLinks = 0;
  private conflictingClaims = 0;

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

  snapshot(): {
    claimsCreated: number;
    unsupportedShare: number;
    argumentsPerClaim: number;
    conflictingEvidenceFrequency: number;
  } {
    return {
      claimsCreated: this.created,
      unsupportedShare: this.created === 0 ? 0 : this.unsupported / this.created,
      argumentsPerClaim: this.created === 0 ? 0 : this.argumentLinks / this.created,
      conflictingEvidenceFrequency:
        this.created === 0 ? 0 : this.conflictingClaims / this.created,
    };
  }

  reset(): void {
    this.created = 0;
    this.unsupported = 0;
    this.argumentLinks = 0;
    this.conflictingClaims = 0;
  }
}
