import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { RecordingArtifact } from '../domain/recording-job.js';

export type UploadedAudioStorageInput = {
  jobId: string;
  submitterId: string;
  originalName: string;
  contentType: string;
  bytes: Buffer;
};

export interface UploadedAudioStorage {
  storeUpload(input: UploadedAudioStorageInput): Promise<RecordingArtifact>;
}

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

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: storageKey,
        Body: input.bytes,
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
