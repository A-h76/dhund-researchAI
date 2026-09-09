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
import type { AuthTokenPurpose } from '../../l0/ports';
import { APP_CONFIG, type FrozenAppConfig } from '../../platform/config';
import { DomainError, ErrorCode } from '../../platform/errors';
import {
  AUTH_TOKEN_ALGORITHMS,
  AUTH_TOKEN_TYP,
} from './auth-token.constants';

export interface AuthTokenSignInput {
  readonly sub: string;
  readonly purpose: AuthTokenPurpose;
  readonly jti: string;
  readonly ttlSeconds: number;
}

export interface VerifiedAuthToken {
  readonly sub: string;
  readonly purpose: AuthTokenPurpose;
  readonly jti: string;
}

@Injectable()
export class AuthTokenService {
  private privateKey: KeyLike | undefined;
  private publicKey: KeyLike | Uint8Array | undefined;
  private keysPromise: Promise<void> | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: FrozenAppConfig) {
    if (this.config.jwt === undefined) {
      throw new Error('Missing JWT configuration');
    }
  }

  async sign(input: AuthTokenSignInput): Promise<string> {
    const { privateKey, kid } = await this.keys();
    return new SignJWT({ purpose: input.purpose })
      .setProtectedHeader({ alg: 'EdDSA', kid, typ: AUTH_TOKEN_TYP })
      .setSubject(input.sub)
      .setIssuedAt()
      .setExpirationTime(`${input.ttlSeconds}s`)
      .setJti(input.jti)
      .sign(privateKey);
  }

  async verify(token: string, expectedPurpose: AuthTokenPurpose): Promise<VerifiedAuthToken> {
    const { publicKey, kid } = await this.keys();
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(token, publicKey, {
        algorithms: [...AUTH_TOKEN_ALGORITHMS],
      });
      if (verified.protectedHeader.alg !== 'EdDSA') {
        throw invalidToken();
      }
      if (verified.protectedHeader.kid !== kid) {
        throw invalidToken();
      }
      if (verified.protectedHeader.typ !== AUTH_TOKEN_TYP) {
        throw invalidToken();
      }
      payload = verified.payload as Record<string, unknown>;
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw invalidToken();
    }

    const sub = payload.sub;
    const jti = payload.jti;
    const purpose = payload.purpose;
    if (
      typeof sub !== 'string' ||
      typeof jti !== 'string' ||
      (purpose !== 'email_verification' && purpose !== 'password_reset') ||
      purpose !== expectedPurpose
    ) {
      throw invalidToken();
    }

    return { sub, purpose, jti };
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

function invalidToken(): DomainError {
  return new DomainError(ErrorCode.TokenInvalid, { module: 'iam' });
}
