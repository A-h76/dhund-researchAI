import { Inject, Injectable } from '@nestjs/common';
import {
  exportJWK,
  importJWK,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JWK,
  type KeyLike,
} from 'jose';
import { APP_CONFIG, type FrozenAppConfig } from '../../platform/config';
import { DomainError, ErrorCode } from '../../platform/errors';
import { generateId } from '../../platform/ids/uuid-v7';
import {
  MFA_CHALLENGE_ALGORITHMS,
  MFA_CHALLENGE_PURPOSE,
  MFA_CHALLENGE_TTL_SECONDS,
  MFA_CHALLENGE_TYP,
} from './mfa-challenge.constants';

export interface VerifiedMfaChallenge {
  readonly sub: string;
  readonly purpose: typeof MFA_CHALLENGE_PURPOSE;
  readonly jti: string;
}

@Injectable()
export class MfaChallengeService {
  private privateKey: KeyLike | undefined;
  private publicKey: KeyLike | Uint8Array | undefined;
  private keysPromise: Promise<void> | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: FrozenAppConfig) {
    if (this.config.jwt === undefined) {
      throw new Error('Missing JWT configuration');
    }
  }

  async sign(userId: string): Promise<string> {
    const { privateKey, kid } = await this.keys();
    return new SignJWT({ purpose: MFA_CHALLENGE_PURPOSE })
      .setProtectedHeader({ alg: 'EdDSA', kid, typ: MFA_CHALLENGE_TYP })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${MFA_CHALLENGE_TTL_SECONDS}s`)
      .setJti(generateId())
      .sign(privateKey);
  }

  async verify(token: string): Promise<VerifiedMfaChallenge> {
    const { publicKey, kid } = await this.keys();
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(token, publicKey, {
        algorithms: [...MFA_CHALLENGE_ALGORITHMS],
      });
      if (verified.protectedHeader.alg !== 'EdDSA') {
        throw invalidChallenge();
      }
      if (verified.protectedHeader.kid !== kid) {
        throw invalidChallenge();
      }
      if (verified.protectedHeader.typ !== MFA_CHALLENGE_TYP) {
        throw invalidChallenge();
      }
      payload = verified.payload as Record<string, unknown>;
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw invalidChallenge();
    }

    const sub = payload.sub;
    const jti = payload.jti;
    const purpose = payload.purpose;
    if (
      typeof sub !== 'string' ||
      typeof jti !== 'string' ||
      purpose !== MFA_CHALLENGE_PURPOSE
    ) {
      throw invalidChallenge();
    }

    return { sub, purpose: MFA_CHALLENGE_PURPOSE, jti };
  }

  private async keys(): Promise<{
    privateKey: KeyLike;
    publicKey: KeyLike | Uint8Array;
    kid: string;
  }> {
    if (this.keysPromise === undefined) {
      this.keysPromise = this.loadKeys();
    }
    await this.keysPromise;
    return {
      privateKey: this.privateKey!,
      publicKey: this.publicKey!,
      kid: this.config.jwt!.kid,
    };
  }

  private async loadKeys(): Promise<void> {
    const jwt = this.config.jwt;
    if (jwt === undefined) {
      throw new Error('Missing JWT configuration');
    }

    const privateKey = await importPKCS8(jwt.privateKey, 'EdDSA');
    const jwk = await exportJWK(privateKey);
    const x = jwk.x;
    if (typeof x !== 'string') {
      throw new Error('Ed25519 public key is missing');
    }

    const publicOnly: JWK = {
      kty: 'OKP',
      crv: 'Ed25519',
      x,
      alg: 'EdDSA',
    };

    this.privateKey = privateKey;
    this.publicKey = await importJWK(publicOnly, 'EdDSA');
  }
}

function invalidChallenge(): DomainError {
  return new DomainError(ErrorCode.MfaInvalid, { module: 'iam' });
}
