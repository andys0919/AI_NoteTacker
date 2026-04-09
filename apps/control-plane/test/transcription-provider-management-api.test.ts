import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import type { AuthenticatedUser } from '../src/domain/authenticated-user.js';
import { createTranscriptionProviderCatalog } from '../src/infrastructure/transcription-provider-catalog.js';

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

describe('transcription provider management API', () => {
  const auth = new FakeOperatorAuth({
    'admin-token': { id: 'admin-user', email: 'admin@example.com' },
    'operator-token': { id: 'operator-user', email: 'operator@example.com' }
  });

  const buildApp = (catalog = createTranscriptionProviderCatalog({ whisperModel: 'large-v3' })) =>
    createApp(undefined, {
      operatorAuth: auth,
      authenticatedUserRepository: new FakeAuthenticatedUserRepository(),
      uploadedAudioStorage: new FakeUploadedAudioStorage(),
      adminEmails: ['admin@example.com'],
      transcriptionProviderCatalog: catalog,
      maxConcurrentTranscriptionJobs: 2
    });

  it('returns the current provider and provider readiness metadata for admins', async () => {
    const app = buildApp(
      createTranscriptionProviderCatalog({
        whisperModel: 'large-v3',
        azureOpenAiEndpoint: 'https://azure.example.test',
        azureOpenAiDeployment: 'gpt-4o-mini-transcribe',
        azureOpenAiApiKey: 'secret'
      })
    );

    const response = await request(app)
      .get('/api/admin/transcription-provider')
      .set('authorization', 'Bearer admin-token');

    expect(response.status).toBe(200);
    expect(response.body.currentProvider).toBe('self-hosted-whisper');
    expect(response.body.options).toEqual([
      {
        value: 'self-hosted-whisper',
        label: 'Self-hosted Whisper',
        ready: true
      },
      {
        value: 'azure-openai-gpt-4o-mini-transcribe',
        label: 'Azure OpenAI gpt-4o-mini-transcribe',
        ready: true
      }
    ]);
  });

  it('rejects provider management requests from non-admin operators', async () => {
    const app = buildApp();

    const response = await request(app)
      .get('/api/admin/transcription-provider')
      .set('authorization', 'Bearer operator-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('operator-admin-required');
  });

  it('refuses to switch to Azure when the server-side Azure configuration is incomplete', async () => {
    const app = buildApp();

    const response = await request(app)
      .put('/api/admin/transcription-provider')
      .set('authorization', 'Bearer admin-token')
      .send({
        provider: 'azure-openai-gpt-4o-mini-transcribe'
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('transcription-provider-not-ready');
  });

  it('latches the selected provider onto newly claimed transcription jobs', async () => {
    const app = buildApp(
      createTranscriptionProviderCatalog({
        whisperModel: 'large-v3',
        azureOpenAiEndpoint: 'https://azure.example.test',
        azureOpenAiDeployment: 'gpt-4o-mini-transcribe',
        azureOpenAiApiKey: 'secret'
      })
    );

    const firstJob = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer admin-token')
      .attach('audio', Buffer.from('audio-a'), {
        filename: 'first.wav',
        contentType: 'audio/wav'
      });

    const firstClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcriber-alpha' });

    expect(firstClaim.status).toBe(200);
    expect(firstClaim.body.transcriptionProvider).toBe('self-hosted-whisper');

    const switched = await request(app)
      .put('/api/admin/transcription-provider')
      .set('authorization', 'Bearer admin-token')
      .send({
        provider: 'azure-openai-gpt-4o-mini-transcribe'
      });

    expect(switched.status).toBe(200);
    expect(switched.body.currentProvider).toBe('azure-openai-gpt-4o-mini-transcribe');

    const secondJob = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-b'), {
        filename: 'second.wav',
        contentType: 'audio/wav'
      });

    const secondClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcriber-beta' });

    expect(firstJob.status).toBe(201);
    expect(secondJob.status).toBe(201);
    expect(secondClaim.status).toBe(200);
    expect(secondClaim.body.id).not.toBe(firstClaim.body.id);
    expect(secondClaim.body.transcriptionProvider).toBe('azure-openai-gpt-4o-mini-transcribe');
  });
});
