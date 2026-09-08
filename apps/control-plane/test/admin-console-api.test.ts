import request, { TEST_ADMIN_CONSOLE_PASSWORD } from './test-request.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { attachSummaryArtifact, attachTranscriptArtifact, createRecordingJob, markRecordingJobFailed } from '../src/domain/recording-job.js';
import { toPublicMeeting } from '../src/domain/meeting-share.js';
import { createAdminConsoleAuth } from '../src/infrastructure/admin-console-auth.js';
import { InMemoryCloudUsageLedgerRepository } from '../src/infrastructure/in-memory-cloud-usage-ledger-repository.js';
import { InMemoryRecordingJobRepository } from '../src/infrastructure/in-memory-recording-job-repository.js';
import { createTranscriptionProviderCatalog } from '../src/infrastructure/transcription-provider-catalog.js';

describe('admin console (username/password) API', () => {
  const buildAuth = () =>
    createAdminConsoleAuth({
      username: 'admin',
      password: TEST_ADMIN_CONSOLE_PASSWORD,
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
      })
    });

  const login = async (
    app: ReturnType<typeof buildApp>,
    password = TEST_ADMIN_CONSOLE_PASSWORD
  ) => {
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

  it('fails closed when no dedicated admin password is configured', () => {
    expect(() => createAdminConsoleAuth()).toThrow(/ADMIN_CONSOLE_PASSWORD/);
    expect(() => createAdminConsoleAuth({ password: '   ' })).toThrow(
      /ADMIN_CONSOLE_PASSWORD/
    );
    expect(() => createAdminConsoleAuth({ password: '12345' })).toThrow(/at least 6 bytes/);
    expect(() => createAdminConsoleAuth({ password: 'solomonvbuandy' })).toThrow(
      /ADMIN_CONSOLE_PASSWORD/
    );
    expect(() => createAdminConsoleAuth({ password: '123456' })).not.toThrow();
  });

  it('rejects an incorrect password', async () => {
    const app = buildApp();

    const response = await login(app, 'wrong-password');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('admin-login-invalid');
  });

  it('throttles repeated failed admin login attempts from one source', async () => {
    const app = buildApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(app, 'wrong-password')).status).toBe(401);
    }

    const blocked = await login(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('admin-login-rate-limited');
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

  it('shows only the sanitized Codex weekly usage to an administrator', async () => {
    const app = buildApp();
    const checkedAt = new Date().toISOString();

    expect((await request(app).get('/api/admin/codex-usage')).status).toBe(401);

    const report = await request(app).post('/summary-workers/claims').send({
      workerId: 'summary-alpha',
      codexUsage: {
        status: 'available',
        planType: 'team',
        usedPercent: 37.5,
        windowDurationMins: 10_080,
        resetsAt: 1_786_680_000,
        checkedAt
      }
    });
    expect(report.status).toBe(204);

    const { body: loginBody } = await login(app);
    const response = await request(app)
      .get('/api/admin/codex-usage')
      .set('authorization', `Bearer ${loginBody.token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'available',
      planType: 'team',
      usedPercent: 37.5,
      windowDurationMins: 10_080,
      resetsAt: 1_786_680_000,
      checkedAt
    });
    expect(response.body).not.toHaveProperty('accountId');
    expect(response.body).not.toHaveProperty('auth');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 181_000);
    try {
      const stale = await request(app).get('/api/admin/codex-usage')
        .set('authorization', `Bearer ${loginBody.token}`);
      expect(stale.body.status).toBe('unavailable');
      expect(stale.body).not.toHaveProperty('usedPercent');
    } finally {
      clock.mockRestore();
    }
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
        summaryProvider: 'local-codex',
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
      pricingStatus: 'priced',
      costUsd: 0.0021,
      detail: {
        promptTokens: 1000,
        cachedPromptTokens: 200,
        completionTokens: 500,
        reasoningCompletionTokens: 100,
        totalTokens: 1500
      }
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
      pricingStatus: 'unpriced',
      costUsd: null,
      detail: { audioMs: 60000 }
    });
    await ledger.append({
      entryKey: 'actual:job-1:punctuation:lease-1',
      jobId: 'job-1',
      submitterId: 'operator-user',
      quotaDayKey: '2026-06-01',
      entryType: 'actual',
      stage: 'punctuation',
      provider: 'azure-openai',
      model: 'gpt-5.6-luna',
      pricingVersion: '2026-07-09',
      usageQuantity: 130,
      usageUnit: 'tokens',
      pricingStatus: 'unpriced',
      costUsd: null,
      detail: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningOutputTokens: 10,
        totalTokens: 130
      }
    });

    const app = buildApp(ledger);
    const { body } = await login(app);

    const response = await request(app)
      .get('/api/admin/usage/history')
      .set('authorization', `Bearer ${body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.totals.entryCount).toBe(3);
    expect(response.body.totals.inputTokens).toBe(1100);
    expect(response.body.totals.cachedInputTokens).toBe(220);
    expect(response.body.totals.outputTokens).toBe(530);
    expect(response.body.totals.reasoningOutputTokens).toBe(110);
    expect(response.body.totals.totalTokens).toBe(1630);
    expect(response.body.totals.pricedCostUsd).toBe(0.0021);
    expect(response.body.totals.totalCostUsd).toBeNull();
    expect(response.body.totals.hasUnpricedUsage).toBe(true);
    expect(response.body.totals.unpricedEntryCount).toBe(2);

    const summaryEntry = response.body.entries.find(
      (entry: { stage: string }) => entry.stage === 'summary'
    );
    expect(summaryEntry.model).toBe('gpt-5.4-mini');
    expect(summaryEntry.inputTokens).toBe(1000);
    expect(summaryEntry.cachedInputTokens).toBe(200);
    expect(summaryEntry.outputTokens).toBe(500);
    expect(summaryEntry.reasoningOutputTokens).toBe(100);

    const transcriptionEntry = response.body.entries.find(
      (entry: { stage: string }) => entry.stage === 'transcription'
    );
    expect(transcriptionEntry.model).toBe('gpt-4o-transcribe');
    expect(transcriptionEntry.audioMs).toBe(60000);
    expect(transcriptionEntry.pricingStatus).toBe('unpriced');
    expect(transcriptionEntry.costUsd).toBeNull();

    const punctuationEntry = response.body.entries.find(
      (entry: { stage: string }) => entry.stage === 'punctuation'
    );
    expect(punctuationEntry.inputTokens).toBe(100);
    expect(punctuationEntry.cachedInputTokens).toBe(20);
    expect(punctuationEntry.outputTokens).toBe(30);
    expect(punctuationEntry.reasoningOutputTokens).toBe(10);

    const summaryModelBreakdown = response.body.byModel.find(
      (row: { model: string }) => row.model === 'gpt-5.4-mini'
    );
    expect(summaryModelBreakdown.inputTokens).toBe(1000);
    expect(summaryModelBreakdown.outputTokens).toBe(500);
    expect(summaryModelBreakdown.pricedCostUsd).toBe(0.0021);
    expect(summaryModelBreakdown.totalCostUsd).toBe(0.0021);
    expect(summaryModelBreakdown.hasUnpricedUsage).toBe(false);

    const punctuationModelBreakdown = response.body.byModel.find(
      (row: { stage: string }) => row.stage === 'punctuation'
    );
    expect(punctuationModelBreakdown.pricedCostUsd).toBe(0);
    expect(punctuationModelBreakdown.totalCostUsd).toBeNull();
    expect(punctuationModelBreakdown.hasUnpricedUsage).toBe(true);
    expect(punctuationModelBreakdown.unpricedEntryCount).toBe(1);
  });

  it('returns request-level billed audio, cache-write tokens, and subscription identity', async () => {
    const ledger = seedLedger();
    await ledger.startProviderRequest({
      requestId: 'request-mai-history',
      jobId: 'job-mai',
      submitterId: 'operator-user',
      quotaDayKey: '2026-08-06',
      stage: 'transcription',
      provider: 'azure-speech-mai-transcribe-1.5',
      model: 'mai-transcribe-1.5',
      pricingVersion: 'v1',
      leaseTokenHash: 'hash-mai',
      billingClass: 'metered-api',
      startedAt: '2026-08-06T01:00:00.000Z',
      detail: { audioMs: 60_001 }
    });
    await ledger.finishProviderRequest({
      requestId: 'request-mai-history',
      status: 'succeeded',
      httpStatus: 200,
      usageQuantity: 61_000,
      usageUnit: 'audio-ms',
      pricingStatus: 'priced',
      knownCostUsd: 0.0061,
      costUsd: 0.0061,
      detail: { audioMs: 60_001, billedAudioMs: 61_000 },
      finishedAt: '2026-08-06T01:00:02.000Z'
    });
    await ledger.startProviderRequest({
      requestId: 'request-local-history',
      jobId: 'job-local',
      submitterId: 'operator-user',
      quotaDayKey: '2026-08-06',
      stage: 'summary',
      provider: 'local-codex',
      model: 'gpt-5.6-luna',
      pricingVersion: 'v1',
      leaseTokenHash: 'hash-local',
      billingClass: 'subscription',
      startedAt: '2026-08-06T01:01:00.000Z'
    });
    await ledger.finishProviderRequest({
      requestId: 'request-local-history',
      status: 'succeeded',
      usageQuantity: 1_300,
      usageUnit: 'tokens',
      pricingStatus: 'not-applicable',
      knownCostUsd: 0,
      costUsd: null,
      detail: {
        inputTokens: 1_000,
        cachedInputTokens: 200,
        cacheWriteInputTokens: 100,
        outputTokens: 300,
        reasoningOutputTokens: 50,
        totalTokens: 1_300
      },
      finishedAt: '2026-08-06T01:01:03.000Z'
    });

    const app = buildApp(ledger);
    const { body } = await login(app);
    const response = await request(app)
      .get('/api/admin/usage/history')
      .set('authorization', `Bearer ${body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.totals).toMatchObject({
      providerRequestCount: 2,
      billedAudioMs: 61_000,
      cacheWritePromptTokens: 100,
      pricedCostUsd: 0.0061,
      totalCostUsd: 0.0061
    });
    expect(response.body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'request-mai-history',
          recordKind: 'provider-request',
          hasTokenUsage: false,
          billedAudioMs: 61_000,
          providerRequestCount: 1
        }),
        expect.objectContaining({
          id: 'request-local-history',
          billingClass: 'subscription',
          pricingStatus: 'not-applicable',
          hasTokenUsage: true,
          cacheWritePromptTokens: 100,
          providerRequestCount: 1
        })
      ])
    );
  });

  it('rejects the usage history endpoint without a token', async () => {
    const app = buildApp();

    const response = await request(app).get('/api/admin/usage/history');

    expect(response.status).toBe(401);
  });

  it('limits history by whole jobs and includes every chunk in the job cost', async () => {
    const ledger = seedLedger();
    for (const [requestId, jobId, stage, startedAt] of [
      ['old', 'job-old', 'transcription', '2026-09-06T00:00:00.000Z'],
      ['chunk-1', 'job-chunked', 'transcription', '2026-09-07T09:22:00.000Z'],
      ['chunk-2', 'job-chunked', 'transcription', '2026-09-07T09:22:01.000Z'],
      ['summary', 'job-chunked', 'summary', '2026-09-07T09:22:02.000Z']
    ] as const) {
      const isSummary = stage === 'summary';
      await ledger.startProviderRequest({
        requestId, jobId, stage, startedAt,
        submitterId: 'operator-user', quotaDayKey: '2026-09-07',
        provider: isSummary ? 'local-codex' : 'azure-speech-mai-transcribe-1.5',
        model: isSummary ? 'gpt-5.6-luna' : 'mai-transcribe-1.5',
        billingClass: isSummary ? 'subscription' : 'metered-api',
        pricingVersion: 'v1', leaseTokenHash: 'hash'
      });
      await ledger.finishProviderRequest({
        requestId, status: 'succeeded', finishedAt: startedAt,
        pricingStatus: isSummary ? 'not-applicable' : 'priced',
        knownCostUsd: isSummary ? 0 : 0.003,
        costUsd: isSummary ? null : 0.003,
        detail: isSummary ? {} : { audioMs: 30_000, billedAudioMs: 30_000 }
      });
    }
    const app = buildApp(ledger);
    const { body } = await login(app);
    const response = await request(app)
      .get('/api/admin/usage/history?limit=1')
      .set('authorization', `Bearer ${body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.entries).toHaveLength(3);
    expect(new Set(response.body.entries.map((entry: { jobId: string }) => entry.jobId)))
      .toEqual(new Set(['job-chunked']));
    expect(response.body.totals).toMatchObject({
      jobCount: 1, providerRequestCount: 3, billedAudioMs: 60_000, totalCostUsd: 0.006
    });
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

  it('returns transcription duration and punctuation details in the admin job ledger', async () => {
    const recordingJobRepository = new InMemoryRecordingJobRepository();
    const job = createRecordingJob({
      meetingUrl: 'uploaded://punctuation.wav',
      platform: 'uploaded-audio',
      inputSource: 'uploaded-audio',
      submitterId: 'operator-a'
    });
    await recordingJobRepository.save(job);
    const ledger = seedLedger();
    await ledger.append({
      entryKey: `actual:${job.id}:transcription:lease-1`,
      jobId: job.id,
      submitterId: job.submitterId,
      quotaDayKey: '2026-07-15',
      entryType: 'actual',
      stage: 'transcription',
      provider: 'azure-openai-gpt-4o-transcribe',
      model: 'gpt-4o-transcribe',
      pricingVersion: '2026-07-09',
      usageQuantity: 60_000,
      usageUnit: 'audio-ms',
      pricingStatus: 'unpriced',
      costUsd: null,
      detail: { audioMs: 60_000 }
    });
    await ledger.append({
      entryKey: `actual:${job.id}:punctuation:lease-1`,
      jobId: job.id,
      submitterId: job.submitterId,
      quotaDayKey: '2026-07-15',
      entryType: 'actual',
      stage: 'punctuation',
      provider: 'azure-openai',
      model: 'gpt-5.6-luna',
      pricingVersion: '2026-07-09',
      usageQuantity: 130,
      usageUnit: 'tokens',
      pricingStatus: 'unpriced',
      costUsd: null,
      detail: {
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningOutputTokens: 10,
        totalTokens: 130,
        requestCount: 2,
        acceptedChunkCount: 1,
        fallbackChunkCount: 1,
        unmeteredRequestCount: 1
      }
    });
    const app = createApp(recordingJobRepository, {
      adminConsoleAuth: buildAuth(),
      cloudUsageLedgerRepository: ledger
    });
    const { body } = await login(app);

    const response = await request(app)
      .get(`/api/admin/jobs/${job.id}`)
      .set('authorization', `Bearer ${body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.ledgerEntries).toEqual([
      expect.objectContaining({
        stage: 'transcription',
        pricingStatus: 'unpriced',
        costUsd: null,
        audioMs: 60_000
      }),
      expect.objectContaining({
        stage: 'punctuation',
        pricingStatus: 'unpriced',
        costUsd: null,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningOutputTokens: 10,
        totalTokens: 130,
        requestCount: 2,
        acceptedChunkCount: 1,
        fallbackChunkCount: 1,
        unmeteredRequestCount: 1
      })
    ]);
  });

  it('records lightweight final-result metadata and renders the user document for admins after hiding', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const ledger = seedLedger();
    const job = attachSummaryArtifact(attachTranscriptArtifact(createRecordingJob({
      meetingUrl: 'uploaded://meeting.wav', platform: 'uploaded-audio', inputSource: 'uploaded-audio',
      uploadedFileName: '專案會議.wav', submitterId: 'operator-result', summaryRequested: true
    }), {
      storageKey: 'transcript.json', contentType: 'application/json', language: 'zh-Hant',
      segments: [{ startMs: 0, endMs: 1000, text: 'Speaker A：完成需求確認。' }]
    }), { model: 'local-codex', text: '已確認需求。' });
    await repository.save(job);
    await ledger.append({ jobId: job.id, submitterId: job.submitterId, quotaDayKey: '2026-09-08',
      stage: 'transcription', provider: 'azure-openai', model: 'test', pricingVersion: 'v1',
      entryType: 'actual', pricingStatus: 'priced', costUsd: 0.25, usageQuantity: 1000, usageUnit: 'audio-ms' });
    const app = createApp(repository, { adminConsoleAuth: buildAuth(), cloudUsageLedgerRepository: ledger });
    const { body } = await login(app);
    const resultPath = `/api/admin/jobs/${job.id}/result`;
    expect((await request(app).get(resultPath)).status).toBe(401);
    const history = await request(app).get('/api/admin/usage/history').set('authorization', `Bearer ${body.token}`);
    expect(history.body.jobResults).toEqual([{ id: job.id, title: '專案會議.wav', state: 'completed', resultAvailable: true }]);
    expect(JSON.stringify(history.body)).not.toContain('完成需求確認');
    await repository.clearTerminalHistoryForSubmitter(job.submitterId);
    expect(await repository.getById(job.id)).toBeUndefined();
    const result = await request(app).get(resultPath).set('authorization', `Bearer ${body.token}`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual(toPublicMeeting(job));
    expect(result.headers['cache-control']).toContain('no-store');
    expect(await repository.getMeetingShareLinkByJobId(job.id)).toBeUndefined();
    const missing = await request(app).get('/api/admin/jobs/missing/result').set('authorization', `Bearer ${body.token}`);
    expect(missing.status).toBe(404);
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
    expect(deleted.status).toBe(200);
    expect(deleted.body.artifactCleanup).toEqual({ status: 'completed', objectCount: 0 });

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
    expect(
      adminView.body.jobHistory.some(
        (entry: { stage: string }) => entry.stage === 'artifact-lifecycle-policy'
      )
    ).toBe(true);
  });
});
