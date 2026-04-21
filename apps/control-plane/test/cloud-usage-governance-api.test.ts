import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { AuthenticatedUser } from '../src/domain/authenticated-user.js';
import { createSummaryProviderCatalog } from '../src/infrastructure/summary-provider-catalog.js';
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

describe('cloud usage governance API', () => {
  const auth = new FakeOperatorAuth({
    'admin-token': { id: 'admin-user', email: 'admin@example.com' },
    'operator-token': { id: 'operator-user', email: 'operator@example.com' }
  });

  beforeEach(() => {
    vi.stubEnv('SUMMARY_MODEL', 'gpt-5.4-mini');
  });

  const buildApp = () =>
    createApp(undefined, {
      operatorAuth: auth,
      authenticatedUserRepository: new FakeAuthenticatedUserRepository(),
      uploadedAudioStorage: new FakeUploadedAudioStorage(),
      adminEmails: ['admin@example.com'],
      transcriptionProviderCatalog: createTranscriptionProviderCatalog({
        whisperModel: 'large-v3',
        azureOpenAiEndpoint: 'https://azure.example.test',
        azureOpenAiDeployment: 'gpt-4o-mini-transcribe',
        azureOpenAiApiKey: 'secret'
      }),
      summaryProviderCatalog: createSummaryProviderCatalog({
        summaryEnabled: true,
        azureOpenAiSummaryEndpoint: 'https://azure-summary.example.test/openai/v1/chat/completions',
        azureOpenAiSummaryApiKey: 'secret'
      })
    });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the current AI policy for admins', async () => {
    const app = buildApp();

    const response = await request(app)
      .get('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token');

    expect(response.status).toBe(200);
    expect(response.body.transcriptionProvider).toBe('self-hosted-whisper');
    expect(response.body.transcriptionModel).toBe('large-v3');
    expect(response.body.summaryProvider).toBe('local-codex');
    expect(response.body.summaryModel).toBe('gpt-5.4-mini');
    expect(response.body.pricingVersion).toBe('v1');
    expect(response.body.defaultDailyCloudQuotaUsd).toBeGreaterThan(0);
    expect(response.body.concurrencyPools).toEqual({
      localTranscription: 1,
      cloudTranscription: 1,
      localSummary: 1,
      cloudSummary: 1
    });
  });

  it('uses the azure deployment as the default transcription model when azure is the default provider', async () => {
    vi.stubEnv('DEFAULT_TRANSCRIPTION_PROVIDER', 'azure-openai-gpt-4o-mini-transcribe');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'gpt-4o-mini-transcribe');
    vi.stubEnv('WHISPER_MODEL', 'large-v3');

    const app = createApp(undefined, {
      operatorAuth: auth,
      authenticatedUserRepository: new FakeAuthenticatedUserRepository(),
      uploadedAudioStorage: new FakeUploadedAudioStorage(),
      adminEmails: ['admin@example.com'],
      transcriptionProviderCatalog: createTranscriptionProviderCatalog({
        whisperModel: 'large-v3',
        defaultProvider: 'azure-openai-gpt-4o-mini-transcribe',
        azureOpenAiEndpoint: 'https://azure.example.test',
        azureOpenAiDeployment: 'gpt-4o-mini-transcribe',
        azureOpenAiApiKey: 'secret'
      })
    });

    const response = await request(app)
      .get('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token');

    expect(response.status).toBe(200);
    expect(response.body.transcriptionProvider).toBe('azure-openai-gpt-4o-mini-transcribe');
    expect(response.body.transcriptionModel).toBe('gpt-4o-mini-transcribe');
  });

  it('snapshots AI routing policy onto jobs at submission time', async () => {
    const app = buildApp();

    const switched = await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
        transcriptionModel: 'gpt-4o-mini-transcribe',
        summaryProvider: 'azure-openai',
        summaryModel: 'gpt-5.4-nano',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 10,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 2,
          localSummary: 1,
          cloudSummary: 2
        }
      });

    expect(switched.status).toBe(200);

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer admin-token')
      .attach('audio', Buffer.from('audio-a'), {
        filename: 'snapshot.wav',
        contentType: 'audio/wav'
      });

    expect(created.status).toBe(201);
    expect(created.body.transcriptionProvider).toBe('azure-openai-gpt-4o-mini-transcribe');
    expect(created.body.transcriptionModel).toBe('gpt-4o-mini-transcribe');
    expect(created.body.summaryProvider).toBe('azure-openai');
    expect(created.body.summaryModel).toBe('gpt-5.4-nano');
    expect(created.body.pricingVersion).toBe('v1');
    expect(created.body.reservedCloudQuotaUsd).toBe(0.11);

    const changedAgain = await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'self-hosted-whisper',
        transcriptionModel: 'large-v3',
        summaryProvider: 'local-codex',
        summaryModel: 'gpt-5-mini',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 10,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 2,
          localSummary: 1,
          cloudSummary: 2
        }
      });

    expect(changedAgain.status).toBe(200);

    const claim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcriber-alpha' });

    expect(claim.status).toBe(200);
    expect(claim.body.transcriptionProvider).toBe('azure-openai-gpt-4o-mini-transcribe');
    expect(claim.body.transcriptionModel).toBe('gpt-4o-mini-transcribe');
    expect(claim.body.summaryProvider).toBe('azure-openai');
    expect(claim.body.summaryModel).toBe('gpt-5.4-nano');
  });

  it('reports remaining operator cloud quota after reserving a cloud-routed job', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
        transcriptionModel: 'gpt-4o-mini-transcribe',
        summaryProvider: 'azure-openai',
        summaryModel: 'gpt-5.4-nano',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 2,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-quota'), {
        filename: 'quota.wav',
        contentType: 'audio/wav'
      });

    expect(created.status).toBe(201);

    const quota = await request(app)
      .get('/api/operator/quota')
      .set('authorization', 'Bearer operator-token');

    expect(quota.status).toBe(200);
    expect(quota.body.dailyQuotaUsd).toBe(2);
    expect(quota.body.reservedUsd).toBeGreaterThan(0);
    expect(quota.body.consumedUsd).toBe(0);
    expect(quota.body.remainingUsd).toBeLessThan(2);
  });

  it('rejects submissions that would exceed the remaining daily cloud quota', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
        transcriptionModel: 'gpt-4o-mini-transcribe',
        summaryProvider: 'azure-openai',
        summaryModel: 'gpt-5.4-nano',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 0,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-over'), {
        filename: 'over-quota.wav',
        contentType: 'audio/wav'
      });

    expect(created.status).toBe(409);
    expect(created.body.error.code).toBe('cloud-quota-exceeded');
  });

  it('settles actual cloud usage into consumed quota after transcript and summary events', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
        transcriptionModel: 'gpt-4o-mini-transcribe',
        summaryProvider: 'azure-openai',
        summaryModel: 'gpt-5.4-nano',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 2,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-consumed'), {
        filename: 'consumed.wav',
        contentType: 'audio/wav'
      });

    expect(created.status).toBe(201);

    const transcriptStored = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: `transcripts/${created.body.id}/transcript.json`,
          downloadUrl: `https://storage.example.test/transcripts/${created.body.id}/transcript.json`,
          contentType: 'application/json',
          language: 'zh',
          segments: [{ startMs: 0, endMs: 1000, text: 'quota settlement' }]
        },
        usage: {
          audioMs: 600000
        }
      });

    expect(transcriptStored.status).toBe(202);

    const summaryStored = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        summaryArtifact: {
          model: 'gpt-5.4-nano',
          reasoningEffort: 'cloud-default',
          text: 'summary',
          structured: {
            summary: 'summary',
            keyPoints: [],
            actionItems: [],
            decisions: [],
            risks: [],
            openQuestions: []
          }
        },
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500
        }
      });

    expect(summaryStored.status).toBe(202);

    const quota = await request(app)
      .get('/api/operator/quota')
      .set('authorization', 'Bearer operator-token');

    expect(quota.status).toBe(200);
    expect(quota.body.reservedUsd).toBe(0);
    expect(quota.body.consumedUsd).toBeGreaterThan(0);
    expect(quota.body.remainingUsd).toBeLessThan(2);

    const jobs = await request(app)
      .get('/api/operator/jobs')
      .set('authorization', 'Bearer operator-token');

    expect(jobs.status).toBe(200);
    expect(jobs.body.jobs[0].actualTranscriptionCostUsd).toBe(0.03);
    expect(jobs.body.jobs[0].actualSummaryCostUsd).toBeGreaterThan(0);
    expect(jobs.body.jobs[0].actualCloudCostUsd).toBeGreaterThan(0);
    expect(jobs.body.jobs[0].actualCloudCostUsd).toBe(
      jobs.body.jobs[0].actualTranscriptionCostUsd + jobs.body.jobs[0].actualSummaryCostUsd
    );
  });

  it('keeps summary reservation held after cloud transcription settles but before summary finishes', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
        transcriptionModel: 'gpt-4o-mini-transcribe',
        summaryProvider: 'azure-openai',
        summaryModel: 'gpt-5.4-nano',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 2,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-summary-held'), {
        filename: 'summary-held.wav',
        contentType: 'audio/wav'
      });

    expect(created.status).toBe(201);

    const transcriptStored = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: `transcripts/${created.body.id}/transcript.json`,
          downloadUrl: `https://storage.example.test/transcripts/${created.body.id}/transcript.json`,
          contentType: 'application/json',
          language: 'zh',
          segments: [{ startMs: 0, endMs: 1000, text: 'quota summary held' }]
        },
        usage: {
          audioMs: 600000
        }
      });

    expect(transcriptStored.status).toBe(202);
    expect(transcriptStored.body.state).toBe('transcribing');
    expect(transcriptStored.body.processingStage).toBe('summary-pending');

    const quota = await request(app)
      .get('/api/operator/quota')
      .set('authorization', 'Bearer operator-token');

    expect(quota.status).toBe(200);
    expect(quota.body.consumedUsd).toBeGreaterThan(0);
    expect(quota.body.reservedUsd).toBeGreaterThan(0);
  });

  it('does not duplicate consumed cloud usage when a terminal callback is retried', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
        transcriptionModel: 'gpt-4o-mini-transcribe',
        summaryProvider: 'azure-openai',
        summaryModel: 'gpt-5.4-nano',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 2,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-duplicate'), {
        filename: 'duplicate.wav',
        contentType: 'audio/wav'
      });

    expect(created.status).toBe(201);

    const transcriptPayload = {
      type: 'transcript-artifact-stored' as const,
      transcriptArtifact: {
        storageKey: `transcripts/${created.body.id}/transcript.json`,
        downloadUrl: `https://storage.example.test/transcripts/${created.body.id}/transcript.json`,
        contentType: 'application/json',
        language: 'zh',
        segments: [{ startMs: 0, endMs: 1000, text: 'quota duplicate' }]
      },
      usage: {
        audioMs: 600000
      }
    };

    const firstTranscript = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send(transcriptPayload);

    const secondTranscript = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send(transcriptPayload);

    expect(firstTranscript.status).toBe(202);
    expect(secondTranscript.status).toBe(202);

    const quotaAfterDuplicateTranscript = await request(app)
      .get('/api/operator/quota')
      .set('authorization', 'Bearer operator-token');

    expect(quotaAfterDuplicateTranscript.status).toBe(200);
    expect(quotaAfterDuplicateTranscript.body.consumedUsd).toBe(0.03);

    const summaryPayload = {
      type: 'summary-artifact-stored' as const,
      summaryArtifact: {
        model: 'gpt-5.4-nano',
        reasoningEffort: 'cloud-default',
        text: 'summary',
        structured: {
          summary: 'summary',
          keyPoints: [],
          actionItems: [],
          decisions: [],
          risks: [],
          openQuestions: []
        }
      },
      usage: {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500
      }
    };

    const firstSummary = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send(summaryPayload);

    const secondSummary = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send(summaryPayload);

    expect(firstSummary.status).toBe(202);
    expect(secondSummary.status).toBe(202);

    const quotaAfterDuplicateSummary = await request(app)
      .get('/api/operator/quota')
      .set('authorization', 'Bearer operator-token');

    expect(quotaAfterDuplicateSummary.status).toBe(200);
    expect(quotaAfterDuplicateSummary.body.reservedUsd).toBe(0);
    expect(quotaAfterDuplicateSummary.body.consumedUsd).toBe(0.032);
  });

  it('records admin policy and override changes in the audit log', async () => {
    const app = buildApp();

    const policyUpdate = await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'self-hosted-whisper',
        transcriptionModel: 'large-v3',
        summaryProvider: 'local-codex',
        summaryModel: 'gpt-5-mini',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 7,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    expect(policyUpdate.status).toBe(200);

    const overrideUpdate = await request(app)
      .put('/api/admin/cloud-quota/overrides')
      .set('authorization', 'Bearer admin-token')
      .send({
        submitterId: 'operator-user',
        dailyQuotaUsd: 3.5
      });

    expect(overrideUpdate.status).toBe(200);

    const audit = await request(app)
      .get('/api/admin/audit-log')
      .set('authorization', 'Bearer admin-token');

    expect(audit.status).toBe(200);
    expect(audit.body.entries).toHaveLength(2);
    expect(audit.body.entries[0].action).toBe('cloud-quota-override.updated');
    expect(audit.body.entries[1].action).toBe('ai-policy.updated');
  });

  it('enforces separate cloud and local summary concurrency pools', async () => {
    const app = buildApp();

    const setCloudPolicy = await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'self-hosted-whisper',
        transcriptionModel: 'large-v3',
        summaryProvider: 'azure-openai',
        summaryModel: 'gpt-5.4-nano',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 10,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    expect(setCloudPolicy.status).toBe(200);

    const cloudJob = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-cloud-summary'), {
        filename: 'cloud-summary.wav',
        contentType: 'audio/wav'
      });

    expect(cloudJob.status).toBe(201);

    const cloudTranscript = await request(app)
      .post(`/recording-jobs/${cloudJob.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: `transcripts/${cloudJob.body.id}/transcript.json`,
          downloadUrl: `https://storage.example.test/transcripts/${cloudJob.body.id}/transcript.json`,
          contentType: 'application/json',
          language: 'zh',
          segments: [{ startMs: 0, endMs: 1000, text: 'cloud summary slot' }]
        }
      });

    expect(cloudTranscript.status).toBe(202);

    const cloudSummaryClaim = await request(app)
      .post('/transcription-workers/summary-claims')
      .send({
        workerId: 'transcriber-alpha',
        jobId: cloudJob.body.id
      });

    expect(cloudSummaryClaim.status).toBe(200);

    const localPolicy = await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'self-hosted-whisper',
        transcriptionModel: 'large-v3',
        summaryProvider: 'local-codex',
        summaryModel: 'gpt-5-mini',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 10,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    expect(localPolicy.status).toBe(200);

    const localJob = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-local-summary'), {
        filename: 'local-summary.wav',
        contentType: 'audio/wav'
      });

    expect(localJob.status).toBe(201);

    const localTranscript = await request(app)
      .post(`/recording-jobs/${localJob.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: `transcripts/${localJob.body.id}/transcript.json`,
          downloadUrl: `https://storage.example.test/transcripts/${localJob.body.id}/transcript.json`,
          contentType: 'application/json',
          language: 'zh',
          segments: [{ startMs: 0, endMs: 1000, text: 'local summary slot' }]
        }
      });

    expect(localTranscript.status).toBe(202);

    const localSummaryClaim = await request(app)
      .post('/transcription-workers/summary-claims')
      .send({
        workerId: 'transcriber-beta',
        jobId: localJob.body.id
      });

    expect(localSummaryClaim.status).toBe(200);

    const secondCloudJob = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-cloud-summary-2'), {
        filename: 'cloud-summary-2.wav',
        contentType: 'audio/wav'
      });

    expect(secondCloudJob.status).toBe(201);

    const secondCloudTranscript = await request(app)
      .post(`/recording-jobs/${secondCloudJob.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: `transcripts/${secondCloudJob.body.id}/transcript.json`,
          downloadUrl: `https://storage.example.test/transcripts/${secondCloudJob.body.id}/transcript.json`,
          contentType: 'application/json',
          language: 'zh',
          segments: [{ startMs: 0, endMs: 1000, text: 'cloud summary slot full' }]
        }
      });

    expect(secondCloudTranscript.status).toBe(202);

    const secondCloudSummaryClaim = await request(app)
      .post('/transcription-workers/summary-claims')
      .send({
        workerId: 'transcriber-gamma',
        jobId: secondCloudJob.body.id
      });

    expect(secondCloudSummaryClaim.status).toBe(204);
  });

  it('returns an admin cloud usage report grouped by submitter for a quota day', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
        transcriptionModel: 'gpt-4o-mini-transcribe',
        summaryProvider: 'azure-openai',
        summaryModel: 'gpt-5.4-nano',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 5,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-report'), {
        filename: 'report.wav',
        contentType: 'audio/wav'
      });

    expect(created.status).toBe(201);

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: `transcripts/${created.body.id}/transcript.json`,
          downloadUrl: `https://storage.example.test/transcripts/${created.body.id}/transcript.json`,
          contentType: 'application/json',
          language: 'zh',
          segments: [{ startMs: 0, endMs: 1000, text: 'usage report' }]
        },
        usage: {
          audioMs: 600000
        }
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        summaryArtifact: {
          model: 'gpt-5.4-nano',
          reasoningEffort: 'cloud-default',
          text: 'summary',
          structured: {
            summary: 'summary',
            keyPoints: [],
            actionItems: [],
            decisions: [],
            risks: [],
            openQuestions: []
          }
        },
        usage: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500
        }
      });

    const quota = await request(app)
      .get('/api/operator/quota')
      .set('authorization', 'Bearer operator-token');

    const report = await request(app)
      .get(`/api/admin/cloud-usage/report?quotaDayKey=${encodeURIComponent(quota.body.quotaDayKey)}`)
      .set('authorization', 'Bearer admin-token');

    expect(report.status).toBe(200);
    expect(report.body.quotaDayKey).toBe(quota.body.quotaDayKey);
    expect(report.body.totals.operatorCount).toBe(1);
    expect(report.body.totals.consumedUsd).toBeGreaterThan(0);
    expect(report.body.rows).toEqual([
      expect.objectContaining({
        submitterId: 'operator-user',
        email: 'operator@example.com',
        dailyQuotaUsd: 5,
        reservedUsd: 0,
        consumedUsd: expect.any(Number),
        remainingUsd: expect.any(Number),
        entries: [
          expect.objectContaining({
            stage: 'transcription'
          }),
          expect.objectContaining({
            stage: 'summary'
          })
        ]
      })
    ]);
  });

  it('rejects cloud usage report requests from non-admin operators', async () => {
    const app = buildApp();

    const response = await request(app)
      .get('/api/admin/cloud-usage/report?quotaDayKey=2026-04-09')
      .set('authorization', 'Bearer operator-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('operator-admin-required');
  });
});
