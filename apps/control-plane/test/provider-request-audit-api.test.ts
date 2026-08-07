import request from './test-request.js';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import {
  assignSummaryJobToWorker,
  assignTranscriptionJobToWorker,
  attachTranscriptArtifact,
  createRecordingJob
} from '../src/domain/recording-job.js';
import { InMemoryCloudUsageLedgerRepository } from '../src/infrastructure/in-memory-cloud-usage-ledger-repository.js';
import { InMemoryRecordingJobRepository } from '../src/infrastructure/in-memory-recording-job-repository.js';

const transcriptArtifact = {
  storageKey: 'transcripts/job/transcript.json',
  downloadUrl: 'https://storage.example.test/transcripts/job/transcript.json',
  contentType: 'application/json',
  language: 'zh',
  segments: [{ startMs: 0, endMs: 1_000, text: '逐字稿' }]
};

const createTranscriptionJob = (provider = 'azure-openai-gpt-4o-transcribe' as const) =>
  assignTranscriptionJobToWorker(
    createRecordingJob({
      meetingUrl: 'uploaded://request-audit.wav',
      platform: 'uploaded-audio',
      inputSource: 'uploaded-audio',
      submitterId: 'operator-1',
      transcriptionProvider: provider,
      transcriptionModel:
        provider === 'azure-speech-mai-transcribe-1.5'
          ? 'mai-transcribe-1.5'
          : 'gpt-4o-transcribe',
      summaryProvider: 'local-codex',
      summaryModel: 'gpt-5.6-luna',
      summaryRequested: true,
      pricingVersion: 'v1',
      quotaDayKey: '2026-08-06',
      estimatedCloudReservationUsd: 0.2,
      reservedCloudQuotaUsd: 0.2
    }),
    'transcription-worker-1'
  );

const createSummaryJob = () =>
  assignSummaryJobToWorker(
    attachTranscriptArtifact(
      createRecordingJob({
        meetingUrl: 'uploaded://local-summary.wav',
        platform: 'uploaded-audio',
        inputSource: 'uploaded-audio',
        submitterId: 'operator-1',
        transcriptionProvider: 'self-hosted-whisper',
        transcriptionModel: 'large-v3',
        summaryProvider: 'local-codex',
        summaryModel: 'gpt-5.6-luna',
        summaryRequested: true,
        pricingVersion: 'v1',
        quotaDayKey: '2026-08-06',
        estimatedCloudReservationUsd: 0,
        reservedCloudQuotaUsd: 0
      }),
      transcriptArtifact
    ),
    'summary-worker-1'
  );

describe('provider request audit API', () => {
  it('rejects a runtime model mismatch before any provider request is recorded', async () => {
    const jobs = new InMemoryRecordingJobRepository();
    const ledger = new InMemoryCloudUsageLedgerRepository();
    const job = createTranscriptionJob();
    await jobs.save(job);
    const app = createApp(jobs, { cloudUsageLedgerRepository: ledger });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/provider-requests/request-mismatch/start`)
      .send({
        stage: 'transcription',
        leaseToken: job.transcriptionLeaseToken,
        provider: 'azure-openai-gpt-4o-transcribe',
        model: 'wrong-deployment'
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('provider-request-runtime-mismatch');
    await expect(ledger.listProviderRequestsByJob(job.id)).resolves.toEqual([]);
  });

  it('keeps a failed Azure call durable and prevents terminal aggregate duplication', async () => {
    const jobs = new InMemoryRecordingJobRepository();
    const ledger = new InMemoryCloudUsageLedgerRepository();
    const job = createTranscriptionJob();
    await jobs.save(job);
    const app = createApp(jobs, { cloudUsageLedgerRepository: ledger });
    const requestId = 'request-azure-failed';

    const started = await request(app)
      .post(`/recording-jobs/${job.id}/provider-requests/${requestId}/start`)
      .send({
        stage: 'transcription',
        leaseToken: job.transcriptionLeaseToken,
        provider: job.transcriptionProvider,
        model: job.transcriptionModel,
        operation: 'transcription',
        audioMs: 60_000
      });
    expect(started.status).toBe(201);
    expect(started.body.request).not.toHaveProperty('leaseTokenHash');

    const finishPayload = {
      leaseToken: job.transcriptionLeaseToken,
      status: 'failed',
      providerRequestId: 'azure-request-400',
      httpStatus: 400,
      errorCode: 'http-400',
      usage: { audioMs: 60_000 }
    };
    const finished = await request(app)
      .post(`/recording-jobs/${job.id}/provider-requests/${requestId}/finish`)
      .send(finishPayload);
    expect(finished.status).toBe(200);
    expect(finished.body.request).toMatchObject({
      status: 'failed',
      pricingStatus: 'unpriced',
      providerRequestId: 'azure-request-400',
      httpStatus: 400
    });
    expect(
      (
        await request(app)
          .post(`/recording-jobs/${job.id}/provider-requests/${requestId}/finish`)
          .send(finishPayload)
      ).status
    ).toBe(200);

    const omitted = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcription-failed',
        leaseToken: job.transcriptionLeaseToken,
        failure: { code: 'transcription-failed', message: 'provider rejected request' },
        usage: {
          audioMs: 60_000,
          providerRequestCount: 1,
          unmeteredRequestCount: 1
        }
      });
    expect(omitted.status).toBe(409);
    expect(omitted.body.error.code).toBe('provider-request-audit-incomplete');

    const terminal = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcription-failed',
        leaseToken: job.transcriptionLeaseToken,
        requestAuditIds: [requestId],
        failure: { code: 'transcription-failed', message: 'provider rejected request' },
        usage: {
          audioMs: 60_000,
          providerRequestCount: 1,
          unmeteredRequestCount: 1
        }
      });
    expect(terminal.status).toBe(202);
    await expect(ledger.listByJob(job.id)).resolves.toEqual([]);
    await expect(ledger.summarizeActualCostByJobIds([job.id])).resolves.toMatchObject({
      [job.id]: { hasUnpricedTranscriptionUsage: true, actualCloudCostUsd: null }
    });
  });

  it('prices MAI billed duration per request and tracks Local Codex as subscription usage', async () => {
    const jobs = new InMemoryRecordingJobRepository();
    const ledger = new InMemoryCloudUsageLedgerRepository();
    const transcriptionJob = createTranscriptionJob('azure-speech-mai-transcribe-1.5');
    await jobs.save(transcriptionJob);
    const app = createApp(jobs, { cloudUsageLedgerRepository: ledger });

    await request(app)
      .post(`/recording-jobs/${transcriptionJob.id}/provider-requests/request-mai-1/start`)
      .send({
        stage: 'transcription',
        leaseToken: transcriptionJob.transcriptionLeaseToken,
        provider: transcriptionJob.transcriptionProvider,
        model: transcriptionJob.transcriptionModel,
        audioMs: 60_001
      });
    const maiFinish = await request(app)
      .post(`/recording-jobs/${transcriptionJob.id}/provider-requests/request-mai-1/finish`)
      .send({
        leaseToken: transcriptionJob.transcriptionLeaseToken,
        status: 'succeeded',
        httpStatus: 200,
        usage: { audioMs: 60_001, billedAudioMs: 61_000 }
      });
    expect(maiFinish.body.request).toMatchObject({
      pricingStatus: 'priced',
      usageQuantity: 61_000,
      costUsd: 0.0061
    });

    const summaryJob = createSummaryJob();
    await jobs.save(summaryJob);

    await request(app)
      .post(`/recording-jobs/${summaryJob.id}/provider-requests/request-local-1/start`)
      .send({
        stage: 'summary',
        leaseToken: summaryJob.summaryLeaseToken,
        provider: 'local-codex',
        model: summaryJob.summaryModel
      });
    const localFinish = await request(app)
      .post(`/recording-jobs/${summaryJob.id}/provider-requests/request-local-1/finish`)
      .send({
        leaseToken: summaryJob.summaryLeaseToken,
        status: 'succeeded',
        usage: {
          inputTokens: 1_000,
          cachedInputTokens: 200,
          outputTokens: 300,
          reasoningOutputTokens: 100,
          totalTokens: 1_300
        }
      });
    expect(localFinish.body.request).toMatchObject({
      billingClass: 'subscription',
      pricingStatus: 'not-applicable',
      knownCostUsd: 0,
      costUsd: null
    });
  });

  it('requires and consumes one Azure fallback reservation before provider contact', async () => {
    const jobs = new InMemoryRecordingJobRepository();
    const ledger = new InMemoryCloudUsageLedgerRepository();
    const job = createSummaryJob();
    await jobs.save(job);
    const app = createApp(jobs, { cloudUsageLedgerRepository: ledger });
    const start = (requestId: string) =>
      request(app)
        .post(`/recording-jobs/${job.id}/provider-requests/${requestId}/start`)
        .send({
          stage: 'summary',
          leaseToken: job.summaryLeaseToken,
          provider: 'azure-openai',
          model: job.summaryModel
        });

    const unreserved = await start('request-azure-unreserved');
    expect(unreserved.status).toBe(409);
    expect(unreserved.body.error.code).toBe('summary-fallback-not-reserved');

    const reservation = await request(app)
      .post(`/recording-jobs/${job.id}/summary-fallback/reservations`)
      .send({ leaseToken: job.summaryLeaseToken });
    expect(reservation.body).toEqual({ reserved: true });

    expect((await start('request-azure-reserved')).status).toBe(201);
    expect((await start('request-azure-reserved')).status).toBe(200);
    const duplicate = await start('request-azure-second');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('summary-fallback-not-reserved');
    await expect(ledger.listProviderRequestsByJob(job.id)).resolves.toHaveLength(1);
  });

  it('rejects terminal request audits from a provider other than the actual summary provider', async () => {
    const jobs = new InMemoryRecordingJobRepository();
    const ledger = new InMemoryCloudUsageLedgerRepository();
    const job = createSummaryJob();
    await jobs.save(job);
    const app = createApp(jobs, { cloudUsageLedgerRepository: ledger });

    await request(app)
      .post(`/recording-jobs/${job.id}/provider-requests/request-local-mixed/start`)
      .send({
        stage: 'summary',
        leaseToken: job.summaryLeaseToken,
        provider: 'local-codex',
        model: job.summaryModel
      });
    await request(app)
      .post(`/recording-jobs/${job.id}/provider-requests/request-local-mixed/finish`)
      .send({ leaseToken: job.summaryLeaseToken, status: 'failed' });
    await request(app)
      .post(`/recording-jobs/${job.id}/summary-fallback/reservations`)
      .send({ leaseToken: job.summaryLeaseToken });
    await request(app)
      .post(`/recording-jobs/${job.id}/provider-requests/request-azure-mixed/start`)
      .send({
        stage: 'summary',
        leaseToken: job.summaryLeaseToken,
        provider: 'azure-openai',
        model: job.summaryModel
      });
    await request(app)
      .post(`/recording-jobs/${job.id}/provider-requests/request-azure-mixed/finish`)
      .send({ leaseToken: job.summaryLeaseToken, status: 'failed' });

    const terminal = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-failed',
        actualProvider: 'local-codex',
        leaseToken: job.summaryLeaseToken,
        requestAuditIds: ['request-local-mixed', 'request-azure-mixed'],
        failure: { code: 'summary-failed', message: 'local summary failed' }
      });

    expect(terminal.status).toBe(409);
    expect(terminal.body.error.code).toBe('provider-request-audit-incomplete');
  });

  it('does not fabricate Azure usage when fallback fails before provider contact', async () => {
    const jobs = new InMemoryRecordingJobRepository();
    const ledger = new InMemoryCloudUsageLedgerRepository();
    const job = createSummaryJob();
    await jobs.save(job);
    const app = createApp(jobs, { cloudUsageLedgerRepository: ledger });
    await request(app)
      .post(`/recording-jobs/${job.id}/summary-fallback/reservations`)
      .send({ leaseToken: job.summaryLeaseToken });

    const spoofed = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-failed',
        actualProvider: 'azure-openai',
        leaseToken: job.summaryLeaseToken,
        failure: { code: 'summary-failed', message: 'request audit unavailable' },
        usage: {
          promptTokens: 0,
          cachedPromptTokens: 0,
          completionTokens: 0,
          reasoningCompletionTokens: 0,
          totalTokens: 0,
          providerRequestCount: 1,
          unmeteredRequestCount: 1
        }
      });
    expect(spoofed.status).toBe(409);
    expect(spoofed.body.error.code).toBe('provider-request-audit-incomplete');

    const terminal = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-failed',
        leaseToken: job.summaryLeaseToken,
        failure: { code: 'summary-failed', message: 'request audit unavailable' }
      });

    expect(terminal.status).toBe(202);
    await expect(ledger.listByJob(job.id)).resolves.toEqual([]);
    await expect(ledger.listProviderRequestsByJob(job.id)).resolves.toEqual([]);
  });

  it('accepts every request ID from a long MAI recording', async () => {
    const jobs = new InMemoryRecordingJobRepository();
    const ledger = new InMemoryCloudUsageLedgerRepository();
    const job = createTranscriptionJob('azure-speech-mai-transcribe-1.5');
    await jobs.save(job);
    const leaseTokenHash = createHash('sha256')
      .update(job.transcriptionLeaseToken!)
      .digest('hex');
    const requestIds = Array.from({ length: 101 }, (_, index) => `request-long-${index}`);

    for (const [index, requestId] of requestIds.entries()) {
      const startedAt = new Date(Date.UTC(2026, 7, 6, 0, 0, index)).toISOString();
      await ledger.startProviderRequest({
        requestId,
        jobId: job.id,
        submitterId: job.submitterId,
        quotaDayKey: job.quotaDayKey,
        stage: 'transcription',
        provider: job.transcriptionProvider!,
        model: job.transcriptionModel!,
        pricingVersion: job.pricingVersion!,
        leaseTokenHash,
        billingClass: 'metered-api',
        startedAt,
        detail: { audioMs: 30_000 }
      });
      await ledger.finishProviderRequest({
        requestId,
        status: 'succeeded',
        usageQuantity: 30_000,
        usageUnit: 'audio-ms',
        pricingStatus: 'priced',
        knownCostUsd: 0.003,
        costUsd: 0.003,
        detail: { audioMs: 30_000, billedAudioMs: 30_000 },
        finishedAt: startedAt
      });
    }

    const app = createApp(jobs, { cloudUsageLedgerRepository: ledger });
    const terminal = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        leaseToken: job.transcriptionLeaseToken,
        requestAuditIds: requestIds,
        transcriptArtifact
      });

    expect(terminal.status).toBe(202);
  });
});
