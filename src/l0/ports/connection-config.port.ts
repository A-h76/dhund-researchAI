export interface S3ConnectionConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

export interface L0ConnectionConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly s3?: S3ConnectionConfig;
}

export const L0_CONNECTION_CONFIG = Symbol('L0_CONNECTION_CONFIG');
