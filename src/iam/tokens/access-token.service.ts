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
import {
  SESSION_STORE,
  type SessionStore,
} from '../../l0/ports';
import { APP_CONFIG, type FrozenAppConfig } from '../../platform/config';
import { DomainError, ErrorCode } from '../../platform/errors';
import { generateId } from '../../platform/ids/uuid-v7';
import {
  ACCESS_TOKEN_ALGORITHMS,
  ACCESS_TOKEN_TTL_SECONDS,
} from './access-token.constants';

export interface AccessTokenClaims {
  readonly sub: string;
  readonly sid: string;
  readonly sv: number;
}

export interface VerifiedAccessToken extends AccessTokenClaims {
  readonly jti: string;
}

export interface JwksResponse {
  readonly keys: readonly JwksPublicKey[];
}

export interface JwksPublicKey {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  readonly x: string;
  readonly kid: string;
  readonly alg: 'EdDSA';
}

@Injectable()
export class AccessTokenService {
  private privateKey: KeyLike | undefined;
  private publicKey: KeyLike | Uint8Array | undefined;
  private publicJwk: JwksPublicKey | undefined;
  private keysPromise: Promise<void> | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: FrozenAppConfig,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {
    if (this.config.jwt === undefined) {
      throw new Error('Missing JWT configuration');
    }
  }

  async sign(claims: AccessTokenClaims): Promise<string> {
    const { privateKey, kid } = await this.keys();
    return new SignJWT({ sid: claims.sid, sv: claims.sv })
      .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .setJti(generateId())
      .sign(privateKey);
  }

  async jwks(): Promise<JwksResponse> {
    const { publicJwk } = await this.keys();
    return { keys: [publicJwk] };
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    const { publicKey, kid } = await this.keys();
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(token, publicKey, {
        algorithms: [...ACCESS_TOKEN_ALGORITHMS],
      });
      if (verified.protectedHeader.alg !== 'EdDSA') {
        throw invalidToken();
      }
      if (verified.protectedHeader.kid !== kid) {
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
    const sid = payload.sid;
    const sv = payload.sv;
    const jti = payload.jti;
    if (
      typeof sub !== 'string' ||
      typeof sid !== 'string' ||
      typeof jti !== 'string' ||
      typeof sv !== 'number' ||
      !Number.isInteger(sv)
    ) {
      throw invalidToken();
    }

    const session = await this.sessions.getAccessSession(sid);
    if (session === null || session.userId !== sub) {
      throw new DomainError(ErrorCode.SessionRevoked, { module: 'iam' });
    }
    if (session.revokedAt !== null) {
      throw new DomainError(ErrorCode.SessionRevoked, { module: 'iam' });
    }
    if (sv !== session.userSessionVersion) {
      throw invalidToken();
    }

    return { sub, sid, sv, jti };
  }

  private async keys(): Promise<{
    privateKey: KeyLike;
    publicKey: KeyLike | Uint8Array;
    publicJwk: JwksPublicKey;
    kid: string;
  }> {
    if (this.keysPromise === undefined) {
      this.keysPromise = this.loadKeys();
    }
    await this.keysPromise;
    return {
      privateKey: this.privateKey!,
      publicKey: this.publicKey!,
      publicJwk: this.publicJwk!,
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

    const publicJwk: JwksPublicKey = {
      kty: 'OKP',
      crv: 'Ed25519',
      x,
      kid: jwt.kid,
      alg: 'EdDSA',
    };
    const publicOnly: JWK = {
      kty: 'OKP',
      crv: 'Ed25519',
      x,
      alg: 'EdDSA',
    };

    this.privateKey = privateKey;
    this.publicKey = await importJWK(publicOnly, 'EdDSA');
    this.publicJwk = publicJwk;
  }
}

function invalidToken(): DomainError {
  return new DomainError(ErrorCode.TokenInvalid, { module: 'iam' });
}
