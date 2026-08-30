export interface EmailConfig {
  readonly resendApiKey: string;
  readonly from: string;
}

export interface AppConfig {
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string;
  readonly databasePoolSize: number;
  readonly redisUrl: string;
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
