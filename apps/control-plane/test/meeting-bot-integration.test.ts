import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

describe('meeting-bot completion integration', () => {
  it('maps a meeting-bot completion webhook to recording artifact metadata', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    await request(app)
      .post('/recording-workers/claims')
      .send({
        workerId: 'worker-alpha'
      });

    const response = await request(app)
      .post('/integrations/meeting-bot/completions')
      .send({
        recordingId: 'rec_123',
        meetingLink: created.body.meetingUrl,
        status: 'completed',
        timestamp: '2026-03-26T10:00:00Z',
        metadata: {
          userId: 'meeting-bot-user',
          teamId: 'meeting-bot-team',
          botId: created.body.id,
          contentType: 'video/webm',
          uploaderType: 's3',
          storage: {
            provider: 's3',
            bucket: 'meeting-artifacts',
            key: `meeting-bot/meeting-bot-user/${created.body.id}.webm`,
            url: `http://minio:9000/meeting-artifacts/meeting-bot/meeting-bot-user/${created.body.id}.webm`
          }
        },
        blobUrl: `http://minio:9000/meeting-artifacts/meeting-bot/meeting-bot-user/${created.body.id}.webm`
      });

    expect(response.status).toBe(202);
    expect(response.body.id).toBe(created.body.id);
    expect(response.body.state).toBe('transcribing');
    expect(response.body.recordingArtifact.storageKey).toBe(
      `meeting-bot/meeting-bot-user/${created.body.id}.webm`
    );
    expect(response.body.recordingArtifact.downloadUrl).toBe(
      `http://minio:9000/meeting-artifacts/meeting-bot/meeting-bot-user/${created.body.id}.webm`
    );
  });

  it('accepts a meeting-bot completion webhook without storage metadata when blobUrl is present', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV'
      });

    await request(app)
      .post('/recording-workers/claims')
      .send({
        workerId: 'worker-alpha'
      });

    const blobUrl =
      'http://minio:9000/meeting-artifacts/meeting-bot/meeting-bot-user/Microsoft%20Teams%20Recording.webm';

    const response = await request(app)
      .post('/integrations/meeting-bot/completions')
      .send({
        recordingId: 'rec_456',
        meetingLink: created.body.meetingUrl,
        status: 'completed',
        timestamp: '2026-03-30T10:00:00Z',
        metadata: {
          userId: 'meeting-bot-user',
          teamId: 'meeting-bot-team',
          botId: created.body.id,
          contentType: 'video/webm',
          uploaderType: 's3'
        },
        blobUrl
      });

    expect(response.status).toBe(202);
    expect(response.body.id).toBe(created.body.id);
    expect(response.body.state).toBe('transcribing');
    expect(response.body.recordingArtifact.storageKey).toBe(
      'meeting-artifacts/meeting-bot/meeting-bot-user/Microsoft Teams Recording.webm'
    );
    expect(response.body.recordingArtifact.downloadUrl).toBe(blobUrl);
  });

  it('returns 404 when the webhook botId does not match a known job', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/integrations/meeting-bot/completions')
      .send({
        recordingId: 'rec_missing',
        meetingLink: 'https://meet.google.com/abc-defg-hij',
        status: 'completed',
        timestamp: '2026-03-26T10:00:00Z',
        metadata: {
          userId: 'meeting-bot-user',
          teamId: 'meeting-bot-team',
          botId: 'job_missing',
          contentType: 'video/webm',
          uploaderType: 's3',
          storage: {
            provider: 's3',
            bucket: 'meeting-artifacts',
            key: 'meeting-bot/meeting-bot-user/job_missing.webm',
            url: 'http://minio:9000/meeting-artifacts/meeting-bot/meeting-bot-user/job_missing.webm'
          }
        },
        blobUrl: 'http://minio:9000/meeting-artifacts/meeting-bot/meeting-bot-user/job_missing.webm'
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('recording-job-not-found');
  });
});
