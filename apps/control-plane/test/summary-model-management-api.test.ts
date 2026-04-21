import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { AuthenticatedUser } from '../src/domain/authenticated-user.js';

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

class FakeOperatorAuth {
  constructor(private readonly usersByToken: Record<string, { id: string; email: string }>) {}

  async verifyAuthorizationHeader(header: string | undefined) {
    const token = header?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return undefined;
    }

    return this.usersByToken[token];
  }
}

class FakeAuthenticatedUserRepository {
  private readonly users = new Map<string, AuthenticatedUser>();

  async upsert(user: { id: string; email: string }) {
    const now = new Date().toISOString();
    const existing = this.users.get(user.id);
    const saved = {
      id: user.id,
      email: user.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.users.set(user.id, saved);
    return saved;
  }

  async getById(id: string) {
    return this.users.get(id);
  }
}

describe('summary model management API', () => {
  const auth = new FakeOperatorAuth({
    'admin-token': { id: 'admin-user', email: 'admin@example.com' },
    'operator-token': { id: 'operator-user', email: 'operator@example.com' }
  });

  beforeEach(() => {
    vi.stubEnv('SUMMARY_MODEL', 'gpt-5.4-mini');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const buildApp = () =>
    createApp(undefined, {
      operatorAuth: auth,
      authenticatedUserRepository: new FakeAuthenticatedUserRepository(),
      uploadedAudioStorage: new FakeUploadedAudioStorage(),
      adminEmails: ['admin@example.com']
    });

  it('returns the current summary model for admins', async () => {
    const app = buildApp();

    const response = await request(app)
      .get('/api/admin/summary-model')
      .set('authorization', 'Bearer admin-token');

    expect(response.status).toBe(200);
    expect(response.body.summaryModel).toBe('gpt-5.4-mini');
  });

  it('rejects summary model management requests from non-admin operators', async () => {
    const app = buildApp();

    const response = await request(app)
      .get('/api/admin/summary-model')
      .set('authorization', 'Bearer operator-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('operator-admin-required');
  });

  it('latches the selected summary model onto newly claimed transcription jobs', async () => {
    const app = buildApp();

    const switched = await request(app)
      .put('/api/admin/summary-model')
      .set('authorization', 'Bearer admin-token')
      .send({
        summaryModel: 'gpt-5.4-nano'
      });

    expect(switched.status).toBe(200);
    expect(switched.body.summaryModel).toBe('gpt-5.4-nano');

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer admin-token')
      .attach('audio', Buffer.from('audio-a'), {
        filename: 'summary-model.wav',
        contentType: 'audio/wav'
      });

    const claim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcriber-alpha' });

    expect(created.status).toBe(201);
    expect(claim.status).toBe(200);
    expect(claim.body.summaryModel).toBe('gpt-5.4-nano');
  });
});
