import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

describe('meeting-bot status callbacks', () => {
  it('records join-request evidence when the meeting bot confirms it is waiting for host admission', async () => {
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

    const callback = await request(app)
      .patch('/v2/meeting/app/bot/log')
      .send({
        botId: created.body.id,
        provider: 'google',
        level: 'info',
        message: 'Google Meet join request was submitted and is waiting for host admission.',
        category: 'JoinRequest',
        subCategory: 'Submitted'
      });

    expect(callback.status).toBe(200);
    expect(callback.body.success).toBe(true);

    const fetched = await request(app).get(`/recording-jobs/${created.body.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.state).toBe('joining');
    expect(fetched.body.processingStage).toBe('waiting-for-host-admission');
    expect(fetched.body.processingMessage).toBe(
      'Google Meet join request was submitted and is waiting for host admission.'
    );
  });

  it('marks a joining job as actively recording when the meeting bot reports recording started', async () => {
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

    const callback = await request(app)
      .patch('/v2/meeting/app/bot/log')
      .send({
        botId: created.body.id,
        provider: 'google',
        level: 'info',
        message: 'Google Meet bot joined the meeting and started recording.',
        category: 'Recording',
        subCategory: 'Started'
      });

    expect(callback.status).toBe(200);
    expect(callback.body.success).toBe(true);

    const fetched = await request(app).get(`/recording-jobs/${created.body.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.state).toBe('recording');
    expect(fetched.body.processingStage).toBe('recording');
    expect(fetched.body.processingMessage).toBe(
      'Google Meet bot joined the meeting and started recording.'
    );
  });

  it('marks a joining job as failed when the meeting bot reports failed status', async () => {
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

    const callback = await request(app)
      .patch('/v2/meeting/app/bot/status')
      .send({
        botId: created.body.id,
        provider: 'microsoft',
        status: ['processing', 'failed']
      });

    expect(callback.status).toBe(200);
    expect(callback.body.success).toBe(true);

    const fetched = await request(app).get(`/recording-jobs/${created.body.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.state).toBe('failed');
    expect(fetched.body.failureCode).toBe('meeting-bot-failed');
    expect(fetched.body.failureMessage).toBe(
      'The meeting bot reported a failed join or recording attempt.'
    );
  });

  it('captures a more specific failure when the meeting bot sends an error log callback', async () => {
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

    await request(app)
      .patch('/v2/meeting/app/bot/status')
      .send({
        botId: created.body.id,
        provider: 'microsoft',
        status: ['processing', 'failed']
      });

    const callback = await request(app)
      .patch('/v2/meeting/app/bot/log')
      .send({
        botId: created.body.id,
        provider: 'microsoft',
        level: 'error',
        message: 'Microsoft Teams Meeting bot could not enter the meeting...',
        category: 'WaitingAtLobby',
        subCategory: 'Timeout'
      });

    expect(callback.status).toBe(200);
    expect(callback.body.success).toBe(true);

    const fetched = await request(app).get(`/recording-jobs/${created.body.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.state).toBe('failed');
    expect(fetched.body.failureCode).toBe('meeting-bot-waiting-at-lobby-timeout');
    expect(fetched.body.failureMessage).toBe(
      'Microsoft Teams Meeting bot could not enter the meeting...'
    );
  });
});
