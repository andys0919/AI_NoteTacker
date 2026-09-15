import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import {
  attachRecordingArtifact,
  attachTranscriptArtifact,
  createRecordingJob
} from '../src/domain/recording-job.js';
import { createAdminConsoleAuth } from '../src/infrastructure/admin-console-auth.js';
import type { UploadedAudioStorage } from '../src/infrastructure/uploaded-audio-storage.js';
import { InMemoryRecordingJobRepository } from '../src/infrastructure/in-memory-recording-job-repository.js';
import request, { TEST_ADMIN_CONSOLE_PASSWORD } from './test-request.js';

const RECORDING = Buffer.from('0123456789');

// Serves one fixed object and honors byte ranges the way object storage does.
const storage: UploadedAudioStorage = {
  async storeUpload() {
    throw new Error('not used');
  },
  async getObjectStream(storageKey, range) {
    if (storageKey !== 'recordings/job_media/meeting.m4a') {
      const error = new Error('missing');
      error.name = 'NoSuchKey';
      throw error;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? '');
    if (!match) {
      return { body: Readable.from(RECORDING), contentType: 'audio/mp4', contentLength: RECORDING.length };
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : RECORDING.length - 1;
    const slice = RECORDING.subarray(start, end + 1);
    return {
      body: Readable.from(slice),
      contentType: 'audio/mp4',
      contentLength: slice.length,
      contentRange: `bytes ${start}-${end}/${RECORDING.length}`
    };
  }
};

const createJobWithRecording = async (app: ReturnType<typeof createApp>) => {
  const created = await request(app)
    .post('/recording-jobs')
    .send({ meetingUrl: 'https://meet.google.com/abc-defg-hij' });
  await request(app)
    .post(`/recording-jobs/${created.body.id}/events`)
    .send({
      type: 'recording-artifact-stored',
      recordingArtifact: {
        storageKey: 'recordings/job_media/meeting.m4a',
        downloadUrl: 'http://minio:9000/meeting-artifacts/recordings/job_media/meeting.m4a',
        contentType: 'audio/mp4'
      }
    });
  return created.body.id as string;
};

const createCompletedRecordingJob = () =>
  attachTranscriptArtifact(
    attachRecordingArtifact(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/public-room',
        platform: 'google-meet',
        submitterId: 'operator-share',
        summaryRequested: false
      }),
      {
        storageKey: 'recordings/job_media/meeting.m4a',
        downloadUrl: 'http://minio:9000/meeting-artifacts/recordings/job_media/meeting.m4a',
        contentType: 'audio/mp4'
      }
    ),
    {
      storageKey: 'transcripts/public.json',
      downloadUrl: 'http://minio:9000/meeting-artifacts/transcripts/public.json',
      contentType: 'application/json',
      language: 'zh-Hant',
      segments: [
        {
          startMs: 1_000,
          endMs: 3_000,
          text: 'Speaker 1：公開內容',
          speaker: 'Speaker 1',
          speakerSource: 'local-diarization'
        }
      ]
    }
  );

describe('recording media playback', () => {
  it('streams the owner recording and honors byte ranges for seeking', async () => {
    const app = createApp(undefined, { uploadedAudioStorage: storage });
    const jobId = await createJobWithRecording(app);

    const whole = await request(app).get(`/api/operator/jobs/${jobId}/media?submitterId=anonymous`);
    expect(whole.status).toBe(200);
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect(whole.headers['content-type']).toContain('audio/mp4');
    expect(whole.body.toString()).toBe('0123456789');

    const partial = await request(app)
      .get(`/api/operator/jobs/${jobId}/media?submitterId=anonymous`)
      .set('Range', 'bytes=2-4');
    expect(partial.status).toBe(206);
    expect(partial.headers['content-range']).toBe('bytes 2-4/10');
    expect(partial.body.toString()).toBe('234');
  });

  it('lets an admin play any recording with the console token in the query string', async () => {
    const adminConsoleAuth = createAdminConsoleAuth({
      username: 'admin',
      password: TEST_ADMIN_CONSOLE_PASSWORD,
      sessionSecret: 'unit-test-secret'
    });
    const app = createApp(undefined, { adminConsoleAuth, uploadedAudioStorage: storage });
    const jobId = await createJobWithRecording(app);
    const login = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: TEST_ADMIN_CONSOLE_PASSWORD });

    // <audio src> cannot carry headers, so the token travels as a query parameter.
    const viaQuery = await request(app)
      .get(`/api/admin/jobs/${jobId}/media?token=${encodeURIComponent(login.body.token)}`)
      .set('Range', 'bytes=0-1');
    expect(viaQuery.status).toBe(206);
    expect(viaQuery.body.toString()).toBe('01');

    const anonymous = await request(app).get(`/api/admin/jobs/${jobId}/media`);
    expect(anonymous.status).toBe(401);
  });

  it('serves public playback and an allowlisted Markdown export with the share token', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const job = createCompletedRecordingJob();
    await repository.save(job);
    const app = createApp(repository, {
      meetingShareSecret: 'test-only-meeting-share-secret-32-bytes',
      uploadedAudioStorage: storage
    });
    const created = await request(app)
      .post(`/api/operator/jobs/${job.id}/share`)
      .send({ submitterId: 'operator-share' });

    const shared = await request(app)
      .get('/api/shared-meeting')
      .set('Authorization', `Bearer ${created.body.token}`);
    expect(shared.status).toBe(200);
    expect(shared.body.recordingAvailable).toBe(true);
    expect(shared.body.transcript.segments[0]).toMatchObject({
      speaker: 'Speaker 1',
    });

    const media = await request(app)
      .get('/api/shared-meeting/media')
      .set('Authorization', `Bearer ${created.body.token}`)
      .set('Range', 'bytes=2-4');
    expect(media.status).toBe(206);
    expect(media.headers['cache-control']).toContain('no-store');
    expect(media.headers['content-range']).toBe('bytes 2-4/10');
    expect(media.body.toString()).toBe('234');

    const exported = await request(app)
      .get('/api/shared-meeting/export?part=transcript')
      .set('Authorization', `Bearer ${created.body.token}`);
    expect(exported.status).toBe(200);
    expect(exported.headers['content-disposition']).toContain('.md');
    expect(exported.text).toContain('# 會議紀錄');
    expect(exported.text).toContain('Speaker 1：公開內容');
    expect(exported.text).toContain('[00:00:01.000]');
    expect(exported.text).not.toContain(job.id);
    expect(exported.text).not.toContain('meet.google.com');

    const anonymous = await request(app).get('/api/shared-meeting/media');
    expect(anonymous.status).toBe(404);
  });

  it('hides the recording from anyone but the owner', async () => {
    const app = createApp(undefined, { uploadedAudioStorage: storage });
    const jobId = await createJobWithRecording(app);

    const other = await request(app).get(`/api/operator/jobs/${jobId}/media?submitterId=someone-else`);
    expect(other.status).toBe(404);
  });
});
