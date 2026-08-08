import request from './test-request.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { AuthenticatedUser } from '../src/domain/authenticated-user.js';
import { InMemoryCloudUsageLedgerRepository } from '../src/infrastructure/in-memory-cloud-usage-ledger-repository.js';
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

  const buildApp = (
    cloudUsageLedgerRepository = new InMemoryCloudUsageLedgerRepository()
  ) =>
    createApp(undefined, {
      operatorAuth: auth,
      authenticatedUserRepository: new FakeAuthenticatedUserRepository(),
      uploadedAudioStorage: new FakeUploadedAudioStorage(),
      adminEmails: ['admin@example.com'],
      cloudUsageLedgerRepository,
      transcriptionProviderCatalog: createTranscriptionProviderCatalog({
        whisperModel: 'large-v3',
        azureOpenAiEndpoint: 'https://azure.example.test',
        azureOpenAiDeployment: 'gpt-4o-transcribe',
        azureOpenAiApiKey: 'secret'
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
    expect(response.body.summaryOptions).toEqual([
      { value: 'local-codex', label: 'Local Codex', ready: true }
    ]);
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
    vi.stubEnv('DEFAULT_TRANSCRIPTION_PROVIDER', 'azure-openai-gpt-4o-transcribe');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'gpt-4o-transcribe');
    vi.stubEnv('WHISPER_MODEL', 'large-v3');

    const app = createApp(undefined, {
      operatorAuth: auth,
      authenticatedUserRepository: new FakeAuthenticatedUserRepository(),
      uploadedAudioStorage: new FakeUploadedAudioStorage(),
      adminEmails: ['admin@example.com'],
      transcriptionProviderCatalog: createTranscriptionProviderCatalog({
        whisperModel: 'large-v3',
        defaultProvider: 'azure-openai-gpt-4o-transcribe',
        azureOpenAiEndpoint: 'https://azure.example.test',
        azureOpenAiDeployment: 'gpt-4o-transcribe',
        azureOpenAiApiKey: 'secret'
      })
    });

    const response = await request(app)
      .get('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token');

    expect(response.status).toBe(200);
    expect(response.body.transcriptionProvider).toBe('azure-openai-gpt-4o-transcribe');
    expect(response.body.transcriptionModel).toBe('gpt-4o-transcribe');
  });

  it('snapshots AI routing policy onto jobs at submission time', async () => {
    const app = buildApp();

    const switched = await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
        transcriptionModel: 'gpt-4o-transcribe',
        summaryProvider: 'local-codex',
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
    expect(created.body.transcriptionProvider).toBe('azure-openai-gpt-4o-transcribe');
    expect(created.body.transcriptionModel).toBe('gpt-4o-transcribe');
    expect(created.body.summaryProvider).toBe('local-codex');
    expect(created.body.summaryModel).toBe('gpt-5.4-nano');
    expect(created.body.pricingVersion).toBe('v1');
    expect(created.body.reservedCloudQuotaUsd).toBe(0.18);

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
    expect(claim.body.transcriptionProvider).toBe('azure-openai-gpt-4o-transcribe');
    expect(claim.body.transcriptionModel).toBe('gpt-4o-transcribe');
    expect(claim.body.summaryProvider).toBe('local-codex');
    expect(claim.body.summaryModel).toBe('gpt-5.4-nano');
  });

  it('reports remaining operator cloud quota after reserving a cloud-routed job', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
        transcriptionModel: 'gpt-4o-transcribe',
        summaryProvider: 'local-codex',
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

  it('accepts submissions when the estimated cloud cost exceeds the daily quota', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
        transcriptionModel: 'gpt-4o-transcribe',
        summaryProvider: 'local-codex',
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

    expect(created.status).toBe(201);
    expect(created.body.reservedCloudQuotaUsd).toBeGreaterThan(0);
  });

  it('settles cloud transcription without recording local summary API spend', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
        transcriptionModel: 'gpt-4o-transcribe',
        summaryProvider: 'local-codex',
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

    const transcriptionClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcription-worker-consumed' });

    expect(transcriptionClaim.status).toBe(200);

    const transcriptStored = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        leaseToken: transcriptionClaim.body.leaseToken,
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

    const summaryClaim = await request(app)
      .post('/summary-workers/claims')
      .send({ workerId: 'summary-worker-consumed' });

    expect(summaryClaim.status).toBe(200);

    const summaryStored = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        leaseToken: summaryClaim.body.leaseToken,
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
        }
      });

    expect(summaryStored.status).toBe(202);

    const quota = await request(app)
      .get('/api/operator/quota')
      .set('authorization', 'Bearer operator-token');

    expect(quota.status).toBe(200);
    expect(quota.body.reservedUsd).toBe(0);
    expect(quota.body.consumedUsd).toBeNull();
    expect(quota.body.pricedConsumedUsd).toBe(0);
    expect(quota.body.hasUnpricedUsage).toBe(true);
    expect(quota.body.remainingUsd).toBe(2);

    const jobs = await request(app)
      .get('/api/operator/jobs')
      .set('authorization', 'Bearer operator-token');

    expect(jobs.status).toBe(200);
    expect(jobs.body.jobs[0].actualTranscriptionCostUsd).toBe(0);
    expect(jobs.body.jobs[0].hasUnpricedTranscriptionUsage).toBe(true);
    expect(jobs.body.jobs[0].actualPunctuationCostUsd).toBe(0);
    expect(jobs.body.jobs[0].hasUnpricedPunctuationUsage).toBe(false);
    expect(jobs.body.jobs[0].actualSummaryCostUsd).toBe(0);
    expect(jobs.body.jobs[0].hasUnpricedSummaryUsage).toBe(false);
    expect(jobs.body.jobs[0].actualCloudCostUsd).toBeNull();
    expect(jobs.body.jobs[0].hasUnpricedUsage).toBe(true);
  });

  it('keeps the job reservation held until its local summary finishes', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
        transcriptionModel: 'gpt-4o-transcribe',
        summaryProvider: 'local-codex',
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

    const transcriptionClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcription-worker-summary-held' });

    expect(transcriptionClaim.status).toBe(200);

    const transcriptStored = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        leaseToken: transcriptionClaim.body.leaseToken,
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
    expect(quota.body.consumedUsd).toBeNull();
    expect(quota.body.pricedConsumedUsd).toBe(0);
    expect(quota.body.hasUnpricedUsage).toBe(true);
    expect(quota.body.reservedUsd).toBeGreaterThan(0);
  });

  it('does not duplicate consumed cloud usage when a terminal callback is retried', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
        transcriptionModel: 'gpt-4o-transcribe',
        summaryProvider: 'local-codex',
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

    const transcriptionClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcription-worker-duplicate' });

    expect(transcriptionClaim.status).toBe(200);

    const transcriptPayload = {
      type: 'transcript-artifact-stored' as const,
      leaseToken: transcriptionClaim.body.leaseToken,
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
    expect(quotaAfterDuplicateTranscript.body.consumedUsd).toBeNull();
    expect(quotaAfterDuplicateTranscript.body.pricedConsumedUsd).toBe(0);
    expect(quotaAfterDuplicateTranscript.body.hasUnpricedUsage).toBe(true);

    const summaryClaim = await request(app)
      .post('/summary-workers/claims')
      .send({ workerId: 'summary-worker-duplicate' });

    expect(summaryClaim.status).toBe(200);

    const summaryPayload = {
      type: 'summary-artifact-stored' as const,
      leaseToken: summaryClaim.body.leaseToken,
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
    expect(quotaAfterDuplicateSummary.body.consumedUsd).toBeNull();
    expect(quotaAfterDuplicateSummary.body.pricedConsumedUsd).toBe(0);
    expect(quotaAfterDuplicateSummary.body.hasUnpricedUsage).toBe(true);
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

  it('enforces the local summary concurrency pool', async () => {
    const app = buildApp();

    const setLocalPolicy = await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'self-hosted-whisper',
        transcriptionModel: 'large-v3',
        summaryProvider: 'local-codex',
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

    expect(setLocalPolicy.status).toBe(200);

    const firstJob = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-local-summary-1'), {
        filename: 'local-summary-1.wav',
        contentType: 'audio/wav'
      });

    expect(firstJob.status).toBe(201);

    const firstTranscript = await request(app)
      .post(`/recording-jobs/${firstJob.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: `transcripts/${firstJob.body.id}/transcript.json`,
          downloadUrl: `https://storage.example.test/transcripts/${firstJob.body.id}/transcript.json`,
          contentType: 'application/json',
          language: 'zh',
          segments: [{ startMs: 0, endMs: 1000, text: 'first local summary slot' }]
        }
      });

    expect(firstTranscript.status).toBe(202);

    const firstSummaryClaim = await request(app)
      .post('/transcription-workers/summary-claims')
      .send({
        workerId: 'transcriber-alpha',
        jobId: firstJob.body.id
      });

    expect(firstSummaryClaim.status).toBe(200);

    const secondJob = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('authorization', 'Bearer operator-token')
      .attach('audio', Buffer.from('audio-local-summary-2'), {
        filename: 'local-summary-2.wav',
        contentType: 'audio/wav'
      });

    expect(secondJob.status).toBe(201);

    const secondTranscript = await request(app)
      .post(`/recording-jobs/${secondJob.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: `transcripts/${secondJob.body.id}/transcript.json`,
          downloadUrl: `https://storage.example.test/transcripts/${secondJob.body.id}/transcript.json`,
          contentType: 'application/json',
          language: 'zh',
          segments: [{ startMs: 0, endMs: 1000, text: 'second local summary slot' }]
        }
      });

    expect(secondTranscript.status).toBe(202);

    const secondSummaryClaim = await request(app)
      .post('/transcription-workers/summary-claims')
      .send({
        workerId: 'transcriber-beta',
        jobId: secondJob.body.id
      });

    expect(secondSummaryClaim.status).toBe(204);
  });

  it('returns an admin cloud usage report grouped by submitter for a quota day', async () => {
    const app = buildApp();

    await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', 'Bearer admin-token')
      .send({
        transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
        transcriptionModel: 'gpt-4o-transcribe',
        summaryProvider: 'local-codex',
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

    const transcriptionClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcription-worker-report' });

    expect(transcriptionClaim.status).toBe(200);

    const transcriptStored = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        leaseToken: transcriptionClaim.body.leaseToken,
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

    expect(transcriptStored.status).toBe(202);

    const summaryClaim = await request(app)
      .post('/summary-workers/claims')
      .send({ workerId: 'summary-worker-report' });

    expect(summaryClaim.status).toBe(200);

    const summaryStored = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        leaseToken: summaryClaim.body.leaseToken,
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
        }
      });

    expect(summaryStored.status).toBe(202);

    const quota = await request(app)
      .get('/api/operator/quota')
      .set('authorization', 'Bearer operator-token');

    const report = await request(app)
      .get(`/api/admin/cloud-usage/report?quotaDayKey=${encodeURIComponent(quota.body.quotaDayKey)}`)
      .set('authorization', 'Bearer admin-token');

    expect(report.status).toBe(200);
    expect(report.body.quotaDayKey).toBe(quota.body.quotaDayKey);
    expect(report.body.totals.operatorCount).toBe(1);
    expect(report.body.totals.consumedUsd).toBeNull();
    expect(report.body.totals.pricedConsumedUsd).toBe(0);
    expect(report.body.totals.hasUnpricedUsage).toBe(true);
    expect(report.body.totals.unpricedEntryCount).toBe(1);
    expect(report.body.rows).toEqual([
      expect.objectContaining({
        submitterId: 'operator-user',
        email: 'operator@example.com',
        dailyQuotaUsd: 5,
        reservedUsd: 0,
        consumedUsd: null,
        pricedConsumedUsd: 0,
        hasUnpricedUsage: true,
        remainingUsd: expect.any(Number),
        entries: [
          expect.objectContaining({
            stage: 'transcription',
            pricingStatus: 'unpriced',
            costUsd: null
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

  it('includes a crash-window provider request even when no job or aggregate row remains', async () => {
    const ledger = new InMemoryCloudUsageLedgerRepository();
    await ledger.startProviderRequest({
      requestId: 'request-crash-window',
      jobId: 'job-no-longer-present',
      submitterId: 'operator-request-only',
      quotaDayKey: '2026-04-09',
      stage: 'transcription',
      provider: 'azure-speech-mai-transcribe-1.5',
      model: 'mai-transcribe-1.5',
      pricingVersion: 'v1',
      leaseTokenHash: 'lease-hash',
      billingClass: 'metered-api',
      startedAt: '2026-04-09T01:00:00.000Z'
    });
    const app = buildApp(ledger);

    const response = await request(app)
      .get('/api/admin/cloud-usage/report?quotaDayKey=2026-04-09')
      .set('authorization', 'Bearer admin-token');

    expect(response.status).toBe(200);
    expect(response.body.totals).toMatchObject({
      operatorCount: 1,
      providerRequestCount: 1,
      hasUnpricedUsage: true
    });
    expect(response.body.rows[0]).toMatchObject({
      submitterId: 'operator-request-only',
      consumedUsd: null,
      providerRequests: [expect.objectContaining({ requestId: 'request-crash-window' })]
    });
  });
});
