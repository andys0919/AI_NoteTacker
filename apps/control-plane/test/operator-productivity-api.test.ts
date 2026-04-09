import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

class FakeUploadedAudioStorage {
  async storeUpload(input: {
    jobId: string;
    submitterId: string;
    originalName: string;
    contentType: string;
  }) {
    return {
      storageKey: `uploads/${input.submitterId}/${input.jobId}/${input.originalName}`,
      downloadUrl: `https://storage.example.test/uploads/${input.submitterId}/${input.jobId}/${input.originalName}`,
      contentType: input.contentType
    };
  }
}

class FakeJobNotificationSender {
  async sendTerminalJobNotification() {}
}

describe('operator productivity workflows API', () => {
  it('returns built-in submission templates and notification capabilities from operator config', async () => {
    const app = createApp(undefined, {
      jobNotificationSender: new FakeJobNotificationSender()
    });

    const response = await request(app).get('/api/operator/config');

    expect(response.status).toBe(200);
    expect(response.body.submissionTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'general',
          summaryProfile: 'general'
        }),
        expect.objectContaining({
          id: 'sales',
          summaryProfile: 'sales'
        }),
        expect.objectContaining({
          id: 'product',
          summaryProfile: 'product'
        }),
        expect.objectContaining({
          id: 'hr',
          summaryProfile: 'hr'
        })
      ])
    );
    expect(response.body.notifications).toEqual({
      emailConfigured: true
    });
  });

  it('persists template-derived workflow preferences on meeting jobs', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-productivity',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        requestedJoinName: 'Sales NoteTaker',
        submissionTemplateId: 'sales'
      });

    expect(created.status).toBe(201);
    expect(created.body.submissionTemplateId).toBe('sales');
    expect(created.body.summaryProfile).toBe('sales');
    expect(created.body.preferredExportFormat).toBe('markdown');

    const listed = await request(app)
      .get('/api/operator/jobs')
      .query({ submitterId: 'operator-productivity' });

    expect(listed.status).toBe(200);
    expect(listed.body.jobs[0].submissionTemplateId).toBe('sales');
    expect(listed.body.jobs[0].summaryProfile).toBe('sales');
    expect(listed.body.jobs[0].preferredExportFormat).toBe('markdown');
  });

  it('persists template-derived workflow preferences on uploaded-media jobs', async () => {
    const app = createApp(undefined, {
      uploadedAudioStorage: new FakeUploadedAudioStorage()
    });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-productivity')
      .field('submissionTemplateId', 'product')
      .attach('audio', Buffer.from('audio-bytes'), {
        filename: 'roadmap-review.m4a',
        contentType: 'audio/mp4'
      });

    expect(created.status).toBe(201);
    expect(created.body.submissionTemplateId).toBe('product');
    expect(created.body.summaryProfile).toBe('product');
    expect(created.body.preferredExportFormat).toBe('json');
  });
});
