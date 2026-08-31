import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
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
import type { ObjectStorageService } from '../../ports/object-storage.port';

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

  async getPresignedPutUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const client = await this.requireClient();

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
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

  async getObject(key: string): Promise<Buffer> {
    const client = await this.requireClient();

    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      const body = response.Body;
      if (body === undefined) {
        throw new Error(`Object body missing for key "${key}"`);
      }
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      throw new L0OperationError('Object storage getObject failed', error);
    }
  }

  async putObject(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const client = await this.requireClient();

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    } catch (error) {
      throw new L0OperationError('Object storage putObject failed', error);
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
