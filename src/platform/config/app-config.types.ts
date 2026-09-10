export interface EmailConfig {
  readonly resendApiKey: string;
  readonly from: string;
}

export interface Argon2Config {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

export interface JwtConfig {
  readonly privateKey: string;
  readonly kid: string;
}

export interface AppConfig {
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly databasePoolSize: number;
  readonly hnswEfSearch: number;
  readonly redisUrl: string;
  readonly argon2: Argon2Config;
  readonly jwt?: JwtConfig;
  readonly totpWrapKey?: Uint8Array;
  readonly s3?: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly bucket: string;
  };
  readonly email?: EmailConfig;
  readonly featureFlags: Readonly<Record<string, boolean>>;
  readonly loadedKeyNames: readonly string[];
}
