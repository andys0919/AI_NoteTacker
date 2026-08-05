import { DeleteObjectsCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { S3UploadedAudioStorage } from '../src/infrastructure/uploaded-audio-storage.js';

describe('S3UploadedAudioStorage artifact cleanup', () => {
  it('deletes normalized unique object keys from the configured bucket', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new S3UploadedAudioStorage(
      'meeting-artifacts',
      'http://minio:9000',
      { send } as unknown as S3Client
    );

    await storage.deleteObjects([
      'recordings/job-1/meeting.webm',
      'meeting-artifacts/transcripts/job-1/transcript.json',
      'recordings/job-1/meeting.webm'
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as DeleteObjectsCommand;
    expect(command.input).toEqual({
      Bucket: 'meeting-artifacts',
      Delete: {
        Quiet: true,
        Objects: [
          { Key: 'recordings/job-1/meeting.webm' },
          { Key: 'transcripts/job-1/transcript.json' }
        ]
      }
    });
  });
});
