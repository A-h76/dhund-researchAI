import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  L0_CONNECTION_CONFIG,
  type L0ConnectionConfig,
} from '../../ports/connection-config.port';
import { logAdapterLifecycle } from '../adapter-logger';
import { generateObjectKey } from './object-key.util';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type {
  ObjectStorageService,
  ObjectStorageStat,
} from '../../ports/object-storage.port';

@Injectable()
export class S3ObjectStorageAdapter implements ObjectStorageService, OnModuleDestroy {
  private client: S3Client | null = null;
  private bucket = '';
  private connected = false;

  constructor(
    @Inject(L0_CONNECTION_CONFIG) private readonly connectionConfig: L0ConnectionConfig,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(correlationId?: string): Promise<void> {
    if (this.connected) {
      return;
    }

    const s3 = this.connectionConfig.s3;
    if (s3 === undefined) {
      throw new L0ConnectionError('S3-compatible storage is not fully configured');
    }

    try {
      this.client = new S3Client({
        endpoint: s3.endpoint,
        region: s3.region,
        credentials: {
          accessKeyId: s3.accessKeyId,
          secretAccessKey: s3.secretAccessKey,
        },
        forcePathStyle: true,
      });
      this.bucket = s3.bucket;

      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }

      this.connected = true;
      logAdapterLifecycle('object-storage', 'connect', correlationId);
    } catch (error) {
      this.client = null;
      this.connected = false;
      throw new L0ConnectionError('Object storage connection failed', error);
    }
  }

  async disconnect(correlationId?: string): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.client?.destroy();
    this.client = null;
    this.bucket = '';
    this.connected = false;
    logAdapterLifecycle('object-storage', 'disconnect', correlationId);
  }

  generateObjectKey(
    orgId: string,
    projectId: string,
    category: string,
    id: string,
    filename: string,
  ): string {
    return generateObjectKey(orgId, projectId, category, id, filename);
  }

  async getPresignedPutUrl(
    key: string,
    expiresInSeconds = 900,
    contentLength?: number,
  ): Promise<string> {
    const client = await this.requireClient();

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
      });

      return await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    } catch (error) {
      throw new L0OperationError('Presigned PUT URL generation failed', error);
    }
  }

  async getPresignedGetUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const client = await this.requireClient();

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      return await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    } catch (error) {
      throw new L0OperationError('Presigned GET URL generation failed', error);
    }
  }

  async headObject(key: string): Promise<ObjectStorageStat | null> {
    const client = await this.requireClient();
    try {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return { contentLength: result.ContentLength ?? 0 };
    } catch (error) {
      if (isS3MissingObject(error)) {
        return null;
      }
      throw new L0OperationError('Object head failed', error);
    }
  }

  async getObjectBytes(key: string, maxBytes: number): Promise<Buffer | null> {
    const client = await this.requireClient();
    const end = Math.max(0, maxBytes - 1);
    try {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${String(end)}`,
        }),
      );
      const bytes = await result.Body?.transformToByteArray();
      if (bytes === undefined) {
        return Buffer.alloc(0);
      }
      return Buffer.from(bytes).subarray(0, Math.max(0, maxBytes));
    } catch (error) {
      if (isS3MissingObject(error)) {
        return null;
      }
      throw new L0OperationError('Object read failed', error);
    }
  }

  async delete(key: string): Promise<void> {
    const client = await this.requireClient();
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      throw new L0OperationError('Object delete failed', error);
    }
  }

  async listKeys(prefix: string): Promise<readonly string[]> {
    const client = await this.requireClient();
    const keys: string[] = [];
    let token: string | undefined;
    try {
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ...(token === undefined ? {} : { ContinuationToken: token }),
          }),
        );
        for (const object of page.Contents ?? []) {
          if (typeof object.Key === 'string' && object.Key.length > 0) {
            keys.push(object.Key);
          }
        }
        token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
      return keys;
    } catch (error) {
      throw new L0OperationError('Object list failed', error);
    }
  }

  private async requireClient(): Promise<S3Client> {
    if (!this.connected) {
      await this.connect();
    }

    if (this.client === null || !this.connected) {
      throw new L0ConnectionError('Object storage is not connected');
    }

    return this.client;
  }
}

function isS3MissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const name = typeof record.name === 'string' ? record.name : '';
  const code = typeof record.Code === 'string' ? record.Code : '';
  if (name === 'NoSuchBucket' || code === 'NoSuchBucket') {
    return false;
  }
  if (
    name === 'NotFound' ||
    name === 'NoSuchKey' ||
    code === 'NotFound' ||
    code === 'NoSuchKey'
  ) {
    return true;
  }
  return record.$metadata?.httpStatusCode === 404;
}
