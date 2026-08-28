import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logAdapterLifecycle } from '../adapter-logger';
import { generateObjectKey } from './object-key.util';
import { L0ConnectionError, L0OperationError } from '../../ports/errors';
import type { ObjectStorageService } from '../../ports/object-storage.port';

@Injectable()
export class S3ObjectStorageAdapter implements ObjectStorageService, OnModuleDestroy {
  private client: S3Client | null = null;
  private bucket = '';
  private connected = false;

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(correlationId?: string): Promise<void> {
    if (this.connected) {
      return;
    }

    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION ?? 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const bucket = process.env.S3_BUCKET;

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new L0ConnectionError('S3-compatible storage is not fully configured');
    }

    try {
      this.client = new S3Client({
        endpoint,
        region,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
      });
      this.bucket = bucket;

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
