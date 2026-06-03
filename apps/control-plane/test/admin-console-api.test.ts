import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { createRecordingJob, markRecordingJobFailed } from '../src/domain/recording-job.js';
import { createAdminConsoleAuth } from '../src/infrastructure/admin-console-auth.js';
import { InMemoryCloudUsageLedgerRepository } from '../src/infrastructure/in-memory-cloud-usage-ledger-repository.js';
import { InMemoryRecordingJobRepository } from '../src/infrastructure/in-memory-recording-job-repository.js';
import { createSummaryProviderCatalog } from '../src/infrastructure/summary-provider-catalog.js';
import { createTranscriptionProviderCatalog } from '../src/infrastructure/transcription-provider-catalog.js';

describe('admin console (username/password) API', () => {
  const buildAuth = () =>
    createAdminConsoleAuth({
      username: 'admin',
      password: 'solomonvbnAndy',
      sessionSecret: 'unit-test-secret'
    });

  const seedLedger = () => {
    const ledger = new InMemoryCloudUsageLedgerRepository();
    return ledger;
  };

  beforeEach(() => {
    vi.stubEnv('SUMMARY_MODEL', 'gpt-5.4-mini');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const buildApp = (cloudUsageLedgerRepository = seedLedger()) =>
    createApp(undefined, {
      adminConsoleAuth: buildAuth(),
      cloudUsageLedgerRepository,
      transcriptionProviderCatalog: createTranscriptionProviderCatalog({
        whisperModel: 'large-v3',
        azureOpenAiEndpoint: 'https://azure.example.test',
        azureOpenAiDeployment: 'gpt-4o-transcribe',
        azureOpenAiApiKey: 'secret'
      }),
      summaryProviderCatalog: createSummaryProviderCatalog({
        summaryEnabled: true,
        azureOpenAiSummaryEndpoint: 'https://azure-summary.example.test/openai/v1/chat/completions',
        azureOpenAiSummaryApiKey: 'secret'
      })
    });

  const login = async (app: ReturnType<typeof buildApp>, password = 'solomonvbnAndy') => {
    const response = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password });
    return response;
  };

  it('issues a session token for the correct credentials', async () => {
    const app = buildApp();

    const response = await login(app);

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');
    expect(response.body.token.length).toBeGreaterThan(0);
    expect(response.body.username).toBe('admin');
  });

  it('rejects an incorrect password', async () => {
    const app = buildApp();

    const response = await login(app, 'wrong-password');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('admin-login-invalid');
  });

  it('rejects admin endpoints without a token (guest mode)', async () => {
    const app = buildApp();

    const response = await request(app).get('/api/admin/ai-policy');

    expect(response.status).toBe(401);
  });

  it('grants access to admin endpoints with the session token', async () => {
    const app = buildApp();
    const { body } = await login(app);

    const response = await request(app)
      .get('/api/admin/ai-policy')
      .set('authorization', `Bearer ${body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.transcriptionProvider).toBeTruthy();
  });

  it('accepts the token via the x-admin-console-token header too', async () => {
    const app = buildApp();
    const { body } = await login(app);

    const response = await request(app)
      .get('/api/admin/session')
      .set('x-admin-console-token', body.token);

    expect(response.status).toBe(200);
    expect(response.body.username).toBe('admin');
  });

  it('lets the admin change the summary model through the policy endpoint', async () => {
    const app = buildApp();
    const { body } = await login(app);

    const updateResponse = await request(app)
      .put('/api/admin/ai-policy')
      .set('authorization', `Bearer ${body.token}`)
      .send({
        transcriptionProvider: 'self-hosted-whisper',
        transcriptionModel: 'large-v3',
        summaryProvider: 'azure-openai',
        summaryModel: 'gpt-5.4-nano',
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 5,
        liveMeetingReservationCapUsd: 1,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.summaryModel).toBe('gpt-5.4-nano');

    const policyResponse = await request(app)
      .get('/api/admin/ai-policy')
      .set('authorization', `Bearer ${body.token}`);

    expect(policyResponse.body.summaryModel).toBe('gpt-5.4-nano');
  });

  it('returns historical token usage and model breakdown', async () => {
    const ledger = seedLedger();
    await ledger.append({
      entryKey: 'actual:job-1:summary',
      jobId: 'job-1',
      submitterId: 'operator-user',
      quotaDayKey: '2026-06-01',
      entryType: 'actual',
      stage: 'summary',
      provider: 'azure-openai',
      model: 'gpt-5.4-mini',
      pricingVersion: 'v1',
      usageQuantity: 1500,
      usageUnit: 'tokens',
      costUsd: 0.0021,
      detail: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }
    });
    await ledger.append({
      entryKey: 'actual:job-1:transcription',
      jobId: 'job-1',
      submitterId: 'operator-user',
      quotaDayKey: '2026-06-01',
      entryType: 'actual',
      stage: 'transcription',
      provider: 'azure-openai-gpt-4o-transcribe',
      model: 'gpt-4o-transcribe',
      pricingVersion: 'v1',
      usageQuantity: 60000,
      usageUnit: 'audio-ms',
      costUsd: 0.003,
      detail: { audioMs: 60000 }
    });

    const app = buildApp(ledger);
    const { body } = await login(app);

    const response = await request(app)
      .get('/api/admin/usage/history')
      .set('authorization', `Bearer ${body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.totals.entryCount).toBe(2);
    expect(response.body.totals.inputTokens).toBe(1000);
    expect(response.body.totals.outputTokens).toBe(500);
    expect(response.body.totals.totalTokens).toBe(1500);

    const summaryEntry = response.body.entries.find(
      (entry: { stage: string }) => entry.stage === 'summary'
    );
    expect(summaryEntry.model).toBe('gpt-5.4-mini');
    expect(summaryEntry.inputTokens).toBe(1000);
    expect(summaryEntry.outputTokens).toBe(500);

    const transcriptionEntry = response.body.entries.find(
      (entry: { stage: string }) => entry.stage === 'transcription'
    );
    expect(transcriptionEntry.model).toBe('gpt-4o-transcribe');
    expect(transcriptionEntry.audioMs).toBe(60000);

    const summaryModelBreakdown = response.body.byModel.find(
      (row: { model: string }) => row.model === 'gpt-5.4-mini'
    );
    expect(summaryModelBreakdown.inputTokens).toBe(1000);
    expect(summaryModelBreakdown.outputTokens).toBe(500);
  });

  it('rejects the usage history endpoint without a token', async () => {
    const app = buildApp();

    const response = await request(app).get('/api/admin/usage/history');

    expect(response.status).toBe(401);
  });

  it('rejects the admin job detail endpoint without a token', async () => {
    const app = buildApp();

    const response = await request(app).get('/api/admin/jobs/job-123');

    expect(response.status).toBe(401);
  });

  it('returns 404 for an unknown job when authenticated', async () => {
    const app = buildApp();
    const { body } = await login(app);

    const response = await request(app)
      .get('/api/admin/jobs/job-does-not-exist')
      .set('authorization', `Bearer ${body.token}`);

    expect(response.status).toBe(404);
  });

  it('keeps soft-deleted job content visible to the admin after an operator clears it', async () => {
    const recordingJobRepository = new InMemoryRecordingJobRepository();
    const job = markRecordingJobFailed(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/soft-delete',
        platform: 'google-meet',
        submitterId: 'operator-a'
      }),
      { code: 'meeting-bot-failed', message: 'join failed' }
    );
    await recordingJobRepository.save(job);

    const app = createApp(recordingJobRepository, {
      adminConsoleAuth: buildAuth(),
      cloudUsageLedgerRepository: seedLedger()
    });
    const { body } = await login(app);

    const deleted = await request(app)
      .delete(`/api/operator/jobs/${job.id}`)
      .send({ submitterId: 'operator-a' });
    expect(deleted.status).toBe(204);

    // The operator (and internal views) no longer see the job.
    const operatorView = await request(app).get(`/recording-jobs/${job.id}`);
    expect(operatorView.status).toBe(404);

    // The admin can still audit its content.
    const adminView = await request(app)
      .get(`/api/admin/jobs/${job.id}`)
      .set('authorization', `Bearer ${body.token}`);
    expect(adminView.status).toBe(200);
    expect(adminView.body.id).toBe(job.id);
    expect(adminView.body.state).toBe('failed');
  });
});
