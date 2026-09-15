import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

import type { RecordingArtifact } from '../domain/recording-job.js';

export type StoredObjectStream = {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  // Present only when a byte range was requested and honored, e.g. "bytes 0-99/1000".
  contentRange?: string;
};

export type UploadedAudioStorageInput = {
  jobId: string;
  submitterId: string;
  originalName: string;
  contentType: string;
  bytes?: Buffer;
  filePath?: string;
};

export interface UploadedAudioStorage {
  storeUpload(input: UploadedAudioStorageInput): Promise<RecordingArtifact>;
  deleteObjects?(storageKeys: string[]): Promise<void>;
  // Streams a stored recording so the browser can seek inside it; `range` is the
  // raw HTTP Range header ("bytes=0-"), which object storage understands directly.
  getObjectStream?(storageKey: string, range?: string): Promise<StoredObjectStream>;
}

const stripBucketPrefix = (bucketName: string, key: string): string => {
  const normalized = key.replace(/^\/+/, '');
  const bucketPrefix = `${bucketName}/`;
  return normalized.startsWith(bucketPrefix) ? normalized.slice(bucketPrefix.length) : normalized;
};

const sanitizeFileName = (value: string): string => {
  const trimmed = value.trim();
  const safe = trimmed.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/-+/g, '-');
  return safe.length > 0 ? safe : 'uploaded-audio.bin';
};

const encodeKeyForUrl = (key: string): string =>
  key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

export class S3UploadedAudioStorage implements UploadedAudioStorage {
  constructor(
    private readonly bucketName: string,
    private readonly endpoint: string,
    private readonly client: S3Client
  ) {}

  async storeUpload(input: UploadedAudioStorageInput): Promise<RecordingArtifact> {
    const safeName = sanitizeFileName(input.originalName);
    const storageKey = `uploads/${input.submitterId}/${input.jobId}/${safeName}`;
    const body = input.filePath ? createReadStream(input.filePath) : input.bytes;

    if (!body) {
      throw new Error('uploaded media bytes or filePath is required');
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: storageKey,
        Body: body,
        ContentType: input.contentType
      })
    );

    const normalizedEndpoint = this.endpoint.replace(/\/+$/, '');

    return {
      storageKey,
      downloadUrl: `${normalizedEndpoint}/${this.bucketName}/${encodeKeyForUrl(storageKey)}`,
      contentType: input.contentType
    };
  }

  async getObjectStream(storageKey: string, range?: string): Promise<StoredObjectStream> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: stripBucketPrefix(this.bucketName, storageKey),
        ...(range ? { Range: range } : {})
      })
    );
    return {
      body: result.Body as Readable,
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      contentRange: result.ContentRange
    };
  }

  async deleteObjects(storageKeys: string[]): Promise<void> {
    const normalizedKeys = [...new Set(storageKeys)]
      .map((key) => stripBucketPrefix(this.bucketName, key))
      .filter(Boolean);

    for (let offset = 0; offset < normalizedKeys.length; offset += 1000) {
      const result = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {
            Quiet: true,
            Objects: normalizedKeys.slice(offset, offset + 1000).map((Key) => ({ Key }))
          }
        })
      );

      if (result.Errors?.length) {
        throw new Error(`failed to delete ${result.Errors.length} artifact object(s)`);
      }
    }
  }
}

export const createUploadedAudioStorageFromEnvironment = (): UploadedAudioStorage | undefined => {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const bucketName = process.env.S3_BUCKET_NAME;

  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucketName) {
    return undefined;
  }

  const client = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey
    },
    forcePathStyle: true
  });

  return new S3UploadedAudioStorage(bucketName, endpoint, client);
};
