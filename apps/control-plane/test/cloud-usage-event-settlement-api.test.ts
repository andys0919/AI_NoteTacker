import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import {
  AZURE_RESPONSES_PRICING_CATALOG,
  type AzureResponsesPricing
} from '../src/domain/cloud-usage.js';
import {
  assignSummaryJobToWorker,
  assignTranscriptionJobToWorker,
  attachRecordingArtifact,
  attachTranscriptArtifact,
  createRecordingJob,
  markRecordingJobFailed
} from '../src/domain/recording-job.js';
import type { CloudUsageLedgerEntryInput } from '../src/domain/cloud-usage-ledger-repository.js';
import { InMemoryCloudUsageLedgerRepository } from '../src/infrastructure/in-memory-cloud-usage-ledger-repository.js';
import { InMemoryRecordingJobRepository } from '../src/infrastructure/in-memory-recording-job-repository.js';

const createAssignedCloudJob = () =>
  assignTranscriptionJobToWorker(
    createRecordingJob({
      meetingUrl: 'uploaded://settlement.wav',
      platform: 'uploaded-audio',
      inputSource: 'uploaded-audio',
      submitterId: 'operator-1',
      transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
      transcriptionModel: 'gpt-4o-transcribe',
      summaryProvider: 'azure-openai',
      summaryModel: 'gpt-5.6-luna',
      summaryRequested: true,
      pricingVersion: '2026-07-09',
      quotaDayKey: '2026-07-15',
      estimatedCloudReservationUsd: 0.2,
      reservedCloudQuotaUsd: 0.2
    }),
    'transcription-worker-1'
  );

const transcriptArtifact = {
  storageKey: 'transcripts/job/transcript.json',
  downloadUrl: 'https://storage.example.test/transcripts/job/transcript.json',
  contentType: 'application/json',
  language: 'zh',
  segments: [{ startMs: 0, endMs: 1_000, text: '逐字稿' }]
};

const punctuationUsage = {
  provider: 'azure-openai' as const,
  model: 'gpt-5.6-luna',
  inputTokens: 1_000,
  cachedInputTokens: 200,
  outputTokens: 300,
  reasoningOutputTokens: 100,
  totalTokens: 1_300,
  requestCount: 2,
  acceptedChunkCount: 1,
  fallbackChunkCount: 1,
  unmeteredRequestCount: 0
};

class FailOnceCloudUsageLedgerRepository extends InMemoryCloudUsageLedgerRepository {
  private shouldFail = true;

  override async append(input: CloudUsageLedgerEntryInput) {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('simulated ledger outage');
    }

    return await super.append(input);
  }
}

class DelayedCloudUsageLedgerRepository extends InMemoryCloudUsageLedgerRepository {
  private resolveAppendStarted!: () => void;
  private resolveAppendRelease!: () => void;
  readonly appendStarted = new Promise<void>((resolve) => {
    this.resolveAppendStarted = resolve;
  });
  private readonly appendRelease = new Promise<void>((resolve) => {
    this.resolveAppendRelease = resolve;
  });

  releaseAppend(): void {
    this.resolveAppendRelease();
  }

  override async append(input: CloudUsageLedgerEntryInput) {
    this.resolveAppendStarted();
    await this.appendRelease;
    return await super.append(input);
  }
}

describe('cloud usage event settlement API', () => {
  it('settles distinct unpriced transcription and punctuation usage before storing a transcript', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        leaseToken: job.transcriptionLeaseToken,
        transcriptArtifact,
        usage: {
          audioMs: 60_000,
          punctuation: punctuationUsage
        }
      });

    expect(response.status, response.text).toBe(202);
    const entries = await cloudUsage.listByJob(job.id);
    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryKey: `actual:${job.id}:transcription:${job.transcriptionLeaseToken}`,
          stage: 'transcription',
          usageQuantity: 60_000,
          usageUnit: 'audio-ms',
          pricingStatus: 'unpriced',
          costUsd: null,
          detail: { audioMs: 60_000 }
        }),
        expect.objectContaining({
          entryKey: `actual:${job.id}:punctuation:${job.transcriptionLeaseToken}`,
          stage: 'punctuation',
          provider: 'azure-openai',
          model: 'gpt-5.6-luna',
          pricingVersion: '2026-07-09',
          usageQuantity: 1_300,
          usageUnit: 'tokens',
          pricingStatus: 'unpriced',
          costUsd: null,
          detail: punctuationUsage
        })
      ])
    );
  });

  it('stores the resolved transcription duration when event audio usage is omitted', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = {
      ...createAssignedCloudJob(),
      progressTotalMs: 90_000
    };
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        leaseToken: job.transcriptionLeaseToken,
        transcriptArtifact,
        usage: { punctuation: punctuationUsage }
      });

    expect(response.status).toBe(202);
    const transcriptionEntry = (await cloudUsage.listByJob(job.id)).find(
      (entry) => entry.stage === 'transcription'
    );
    expect(transcriptionEntry?.usageQuantity).toBe(90_000);
    expect(transcriptionEntry?.detail).toEqual({ audioMs: 90_000 });
  });

  it('keeps punctuation usage unpriced when any request lacks token metering', async () => {
    const mutableCatalog = AZURE_RESPONSES_PRICING_CATALOG as AzureResponsesPricing[];
    const originalCatalog = [...mutableCatalog];
    mutableCatalog.splice(0, mutableCatalog.length, {
      model: 'gpt-5.6-luna',
      pricingVersion: '2026-07-09',
      baseModel: 'gpt-5.6-luna',
      modelVersion: '2026-07-09',
      sku: 'GlobalStandard',
      currency: 'USD',
      effectiveDate: '2026-07-09',
      meterSource: 'official-test-meter',
      inputUsdPerMillionTokens: 1,
      cachedInputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 2
    });

    try {
      const recordingJobs = new InMemoryRecordingJobRepository();
      const cloudUsage = new InMemoryCloudUsageLedgerRepository();
      const job = createAssignedCloudJob();
      await recordingJobs.save(job);
      const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

      const response = await request(app)
        .post(`/recording-jobs/${job.id}/events`)
        .send({
          type: 'transcript-artifact-stored',
          leaseToken: job.transcriptionLeaseToken,
          transcriptArtifact,
          usage: {
            punctuation: {
              ...punctuationUsage,
              unmeteredRequestCount: 1
            }
          }
        });

      expect(response.status).toBe(202);
      const punctuationEntry = (await cloudUsage.listByJob(job.id)).find(
        (entry) => entry.stage === 'punctuation'
      );
      expect(punctuationEntry).toEqual(
        expect.objectContaining({ pricingStatus: 'unpriced', costUsd: null })
      );
    } finally {
      mutableCatalog.splice(0, mutableCatalog.length, ...originalCatalog);
    }
  });

  it('rejects punctuation usage without a lease token', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact,
        usage: {
          audioMs: 60_000,
          punctuation: punctuationUsage
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
    expect((await recordingJobs.getById(job.id))?.transcriptArtifact).toBeUndefined();
  });

  it('rejects cloud transcription settlement without a lease token', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact,
        usage: { audioMs: 60_000 }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
    expect((await recordingJobs.getById(job.id))?.transcriptArtifact).toBeUndefined();
  });

  it('rejects a cloud transcription failure without a lease token even when it has no usage', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcription-failed',
        failure: { code: 'transcription-failed', message: 'worker failed before metering' }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
    expect(await recordingJobs.getById(job.id)).toEqual(job);
  });

  it.each([
    {
      type: 'transcript-artifact-stored',
      transcriptArtifact,
      usage: { audioMs: 60_000 }
    },
    {
      type: 'transcription-failed',
      failure: { code: 'transcription-failed', message: 'stale worker failed' }
    }
  ])('rejects an unissued token on a cloud transcription $type callback', async (payload) => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({ ...payload, leaseToken: 'lease_never_issued' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
    expect(await recordingJobs.getById(job.id)).toEqual(job);
  });

  it.each([
    ['missing quota day', { quotaDayKey: undefined }],
    ['blank quota day', { quotaDayKey: ' ' }],
    ['impossible quota day', { quotaDayKey: '2026-02-30' }],
    ['missing pricing version', { pricingVersion: undefined }],
    ['blank pricing version', { pricingVersion: ' \t' }]
  ])('does not advance lifecycle when cloud usage has an invalid %s identity', async (_label, invalidIdentity) => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = { ...createAssignedCloudJob(), ...invalidIdentity };
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcription-failed',
        leaseToken: job.transcriptionLeaseToken,
        failure: { code: 'transcription-failed', message: 'provider usage must settle first' },
        usage: { audioMs: 60_000 }
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('cloud-usage-settlement-metadata-missing');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
    expect(await recordingJobs.getById(job.id)).toEqual(job);
  });

  it.each([
    ['cached input exceeds input', { cachedInputTokens: 1_001 }],
    ['reasoning output exceeds output', { reasoningOutputTokens: 301 }],
    ['total does not equal input plus output', { totalTokens: 1_299 }],
    ['unmetered requests exceed fallbacks', { unmeteredRequestCount: 2 }],
    ['chunk outcomes do not equal requests', { acceptedChunkCount: 0, fallbackChunkCount: 1 }]
  ])('rejects punctuation usage when %s', async (_description, invalidFields) => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        leaseToken: job.transcriptionLeaseToken,
        transcriptArtifact,
        usage: {
          punctuation: {
            ...punctuationUsage,
            ...invalidFields
          }
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
  });

  it('leaves lifecycle state unsaved when settlement fails so the callback can heal on retry', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new FailOnceCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });
    const payload = {
      type: 'transcript-artifact-stored' as const,
      leaseToken: job.transcriptionLeaseToken,
      transcriptArtifact,
      usage: {
        audioMs: 60_000,
        punctuation: punctuationUsage
      }
    };

    const failed = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send(payload);

    expect(failed.status).toBe(500);
    expect((await recordingJobs.getById(job.id))?.transcriptArtifact).toBeUndefined();
    expect((await recordingJobs.getById(job.id))?.transcriptionLeaseToken).toBe(
      job.transcriptionLeaseToken
    );

    const retried = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send(payload);

    expect(retried.status, retried.text).toBe(202);
    expect((await recordingJobs.getById(job.id))?.transcriptArtifact).toEqual(transcriptArtifact);
    expect(await cloudUsage.listByJob(job.id)).toHaveLength(2);
  });

  it('records Luna summary Responses usage as unpriced with cached and reasoning details', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const transcriptionJob = createAssignedCloudJob();
    const job = assignSummaryJobToWorker(
      attachTranscriptArtifact(transcriptionJob, transcriptArtifact),
      'summary-worker-1'
    );
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        leaseToken: job.summaryLeaseToken,
        summaryArtifact: {
          model: 'gpt-5.6-luna',
          reasoningEffort: 'medium',
          text: '摘要'
        },
        usage: {
          promptTokens: 1_000,
          cachedPromptTokens: 200,
          completionTokens: 300,
          reasoningCompletionTokens: 100,
          totalTokens: 1_300
        }
      });

    expect(response.status, response.text).toBe(202);
    expect(await cloudUsage.listByJob(job.id)).toEqual([
      expect.objectContaining({
        entryKey: `actual:${job.id}:summary:${job.summaryLeaseToken}`,
        stage: 'summary',
        provider: 'azure-openai',
        model: 'gpt-5.6-luna',
        pricingVersion: '2026-07-09',
        usageQuantity: 1_300,
        usageUnit: 'tokens',
        pricingStatus: 'unpriced',
        costUsd: null,
        detail: {
          promptTokens: 1_000,
          cachedPromptTokens: 200,
          completionTokens: 300,
          reasoningCompletionTokens: 100,
          totalTokens: 1_300
        }
      })
    ]);
  });

  it('settles valid Luna usage before storing a summary failure', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const transcriptionJob = createAssignedCloudJob();
    const job = assignSummaryJobToWorker(
      attachTranscriptArtifact(transcriptionJob, transcriptArtifact),
      'summary-worker-1'
    );
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-failed',
        leaseToken: job.summaryLeaseToken,
        failure: { code: 'summary-failed', message: 'summary JSON was invalid' },
        usage: {
          promptTokens: 1_000,
          cachedPromptTokens: 200,
          completionTokens: 300,
          reasoningCompletionTokens: 100,
          totalTokens: 1_300
        }
      });

    expect(response.status, response.text).toBe(202);
    expect((await recordingJobs.getById(job.id))?.failureCode).toBe('summary-failed');
    expect(await cloudUsage.listByJob(job.id)).toEqual([
      expect.objectContaining({
        entryKey: `actual:${job.id}:summary:${job.summaryLeaseToken}`,
        stage: 'summary',
        usageQuantity: 1_300,
        pricingStatus: 'unpriced',
        costUsd: null
      })
    ]);
  });

  it('rejects cloud summary settlement without a lease token', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const transcriptionJob = createAssignedCloudJob();
    const job = assignSummaryJobToWorker(
      attachTranscriptArtifact(transcriptionJob, transcriptArtifact),
      'summary-worker-1'
    );
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        summaryArtifact: {
          model: 'gpt-5.6-luna',
          reasoningEffort: 'medium',
          text: '摘要'
        },
        usage: {
          promptTokens: 1_000,
          cachedPromptTokens: 200,
          completionTokens: 300,
          reasoningCompletionTokens: 100,
          totalTokens: 1_300
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
    expect((await recordingJobs.getById(job.id))?.summaryArtifact).toBeUndefined();
  });

  it('rejects a cloud summary failure without a lease token even when it has no usage', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const transcriptionJob = createAssignedCloudJob();
    const job = assignSummaryJobToWorker(
      attachTranscriptArtifact(transcriptionJob, transcriptArtifact),
      'summary-worker-1'
    );
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-failed',
        failure: { code: 'summary-failed', message: 'worker failed before metering' }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
    expect(await recordingJobs.getById(job.id)).toEqual(job);
  });

  it.each([
    {
      type: 'summary-artifact-stored',
      summaryArtifact: {
        model: 'gpt-5.6-luna',
        reasoningEffort: 'medium',
        text: '摘要'
      },
      usage: {
        promptTokens: 1_000,
        cachedPromptTokens: 200,
        completionTokens: 300,
        reasoningCompletionTokens: 100,
        totalTokens: 1_300
      }
    },
    {
      type: 'summary-failed',
      failure: { code: 'summary-failed', message: 'stale worker failed' }
    }
  ])('rejects an unissued token on a cloud summary $type callback', async (payload) => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const transcriptionJob = createAssignedCloudJob();
    const job = assignSummaryJobToWorker(
      attachTranscriptArtifact(transcriptionJob, transcriptArtifact),
      'summary-worker-1'
    );
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({ ...payload, leaseToken: 'lease_never_issued' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
    expect(await recordingJobs.getById(job.id)).toEqual(job);
  });

  it.each([
    ['cached prompt exceeds prompt', { cachedPromptTokens: 1_001 }],
    ['reasoning completion exceeds completion', { reasoningCompletionTokens: 301 }],
    ['total does not equal prompt plus completion', { totalTokens: 1_299 }]
  ])('rejects summary usage when %s', async (_description, invalidFields) => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const transcriptionJob = createAssignedCloudJob();
    const job = assignSummaryJobToWorker(
      attachTranscriptArtifact(transcriptionJob, transcriptArtifact),
      'summary-worker-1'
    );
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        leaseToken: job.summaryLeaseToken,
        summaryArtifact: {
          model: 'gpt-5.6-luna',
          reasoningEffort: 'medium',
          text: '摘要'
        },
        usage: {
          promptTokens: 1_000,
          cachedPromptTokens: 200,
          completionTokens: 300,
          reasoningCompletionTokens: 100,
          totalTokens: 1_300,
          ...invalidFields
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
  });

  it('rejects partial summary usage instead of fabricating omitted token counts', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const transcriptionJob = createAssignedCloudJob();
    const job = assignSummaryJobToWorker(
      attachTranscriptArtifact(transcriptionJob, transcriptArtifact),
      'summary-worker-1'
    );
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        leaseToken: job.summaryLeaseToken,
        summaryArtifact: {
          model: 'gpt-5.6-luna',
          reasoningEffort: 'medium',
          text: '摘要'
        },
        usage: {
          promptTokens: 1_000,
          completionTokens: 300,
          totalTokens: 1_300
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
  });

  it('rejects a cloud summary callback without usage instead of recording zero tokens', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const transcriptionJob = createAssignedCloudJob();
    const job = assignSummaryJobToWorker(
      attachTranscriptArtifact(transcriptionJob, transcriptArtifact),
      'summary-worker-1'
    );
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        leaseToken: job.summaryLeaseToken,
        summaryArtifact: {
          model: 'gpt-5.6-luna',
          reasoningEffort: 'medium',
          text: '摘要'
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid-request');
    expect(await cloudUsage.listByJob(job.id)).toEqual([]);
    expect((await recordingJobs.getById(job.id))?.summaryArtifact).toBeUndefined();
  });

  it('records punctuation usage for each failed transcription lease', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const firstAttempt = createAssignedCloudJob();
    await recordingJobs.save(firstAttempt);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const firstFailure = await request(app)
      .post(`/recording-jobs/${firstAttempt.id}/events`)
      .send({
        type: 'transcription-failed',
        leaseToken: firstAttempt.transcriptionLeaseToken,
        failure: { code: 'transcription-failed', message: 'first attempt failed' },
        usage: { punctuation: punctuationUsage }
      });

    expect(firstFailure.status).toBe(202);
    const retryJob = assignTranscriptionJobToWorker(
      (await recordingJobs.getById(firstAttempt.id))!,
      'transcription-worker-2'
    );
    await recordingJobs.save(retryJob);
    const secondUsage = {
      ...punctuationUsage,
      inputTokens: 1_100,
      totalTokens: 1_400
    };

    const secondFailure = await request(app)
      .post(`/recording-jobs/${retryJob.id}/events`)
      .send({
        type: 'transcription-failed',
        leaseToken: retryJob.transcriptionLeaseToken,
        failure: { code: 'transcription-failed', message: 'second attempt failed' },
        usage: { punctuation: secondUsage }
      });

    expect(secondFailure.status).toBe(202);
    const entries = await cloudUsage.listByJob(retryJob.id);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.entryKey)).toEqual(
      expect.arrayContaining([
        `actual:${retryJob.id}:punctuation:${firstAttempt.transcriptionLeaseToken}`,
        `actual:${retryJob.id}:punctuation:${retryJob.transcriptionLeaseToken}`
      ])
    );
    expect(entries.map((entry) => entry.detail)).toEqual(
      expect.arrayContaining([punctuationUsage, secondUsage])
    );
  });

  it('records successful partial transcription usage for a failed lease', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        type: 'transcription-failed',
        leaseToken: job.transcriptionLeaseToken,
        failure: { code: 'transcription-failed', message: 'later Azure upload failed' },
        usage: { audioMs: 60_000 }
      });

    expect(response.status, response.text).toBe(202);
    expect(await cloudUsage.listByJob(job.id)).toEqual([
      expect.objectContaining({
        entryKey: `actual:${job.id}:transcription:${job.transcriptionLeaseToken}`,
        stage: 'transcription',
        usageQuantity: 60_000,
        pricingStatus: 'unpriced',
        costUsd: null,
        detail: { audioMs: 60_000 }
      })
    ]);
  });

  it('settles a cancelled worker attempt without changing the cancelled job', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const assignedJob = createAssignedCloudJob();
    const cancelledJob = markRecordingJobFailed(assignedJob, {
      code: 'operator-cancel-requested',
      message: 'cancelled by operator'
    });
    await recordingJobs.save(cancelledJob);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${assignedJob.id}/events`)
      .send({
        type: 'transcription-failed',
        leaseToken: assignedJob.transcriptionLeaseToken,
        failure: { code: 'operator-cancel-requested', message: 'cancelled by operator' },
        usage: { punctuation: punctuationUsage }
      });

    expect(response.status).toBe(202);
    expect(await recordingJobs.getById(assignedJob.id)).toEqual(cancelledJob);
    expect(await cloudUsage.listByJob(assignedJob.id)).toEqual([
      expect.objectContaining({
        entryKey: `actual:${assignedJob.id}:punctuation:${assignedJob.transcriptionLeaseToken}`,
        stage: 'punctuation'
      })
    ]);
  });

  it('settles a cancelled worker attempt after the operator hides the job from history', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const assignedJob = createAssignedCloudJob();
    const cancelledJob = markRecordingJobFailed(assignedJob, {
      code: 'operator-cancel-requested',
      message: 'cancelled by operator'
    });
    await recordingJobs.save(cancelledJob);
    expect(
      await recordingJobs.deleteTerminalJobForSubmitter(cancelledJob.id, cancelledJob.submitterId)
    ).toBe(true);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${assignedJob.id}/events`)
      .send({
        type: 'transcription-failed',
        leaseToken: assignedJob.transcriptionLeaseToken,
        failure: { code: 'operator-cancel-requested', message: 'cancelled by operator' },
        usage: { audioMs: 60_000 }
      });

    expect(response.status).toBe(202);
    expect(await recordingJobs.getById(assignedJob.id)).toBeUndefined();
    expect(await recordingJobs.getByIdIncludingHidden(assignedJob.id)).toEqual(cancelledJob);
    expect(await cloudUsage.listByJob(assignedJob.id)).toEqual([
      expect.objectContaining({
        entryKey: `actual:${assignedJob.id}:transcription:${assignedJob.transcriptionLeaseToken}`,
        usageQuantity: 60_000
      })
    ]);
  });

  it('does not let a non-cloud callback mutate a hidden terminal job', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const completedJob = attachTranscriptArtifact(
      attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'uploaded://hidden-local-job.wav',
          platform: 'uploaded-audio',
          inputSource: 'uploaded-audio',
          submitterId: 'operator-hidden-local'
        }),
        {
          storageKey: 'recordings/hidden-local/meeting.wav',
          downloadUrl: 'https://storage.example.test/recordings/hidden-local/meeting.wav',
          contentType: 'audio/wav'
        }
      ),
      transcriptArtifact
    );
    await recordingJobs.save(completedJob);
    expect(
      await recordingJobs.deleteTerminalJobForSubmitter(
        completedJob.id,
        completedJob.submitterId
      )
    ).toBe(true);
    const app = createApp(recordingJobs);

    const response = await request(app)
      .post(`/recording-jobs/${completedJob.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/hidden-local/replacement.wav',
          downloadUrl: 'https://storage.example.test/recordings/hidden-local/replacement.wav',
          contentType: 'audio/wav'
        }
      });

    expect(response.status).toBe(404);
    expect(await recordingJobs.getByIdIncludingHidden(completedJob.id)).toEqual(completedJob);
  });

  it('settles a superseded worker attempt without changing the active lease', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const supersededJob = createAssignedCloudJob();
    const activeJob = assignTranscriptionJobToWorker(
      supersededJob,
      'transcription-worker-2'
    );
    await recordingJobs.save(activeJob);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const response = await request(app)
      .post(`/recording-jobs/${activeJob.id}/events`)
      .send({
        type: 'transcription-failed',
        leaseToken: supersededJob.transcriptionLeaseToken,
        failure: { code: 'transcription-failed', message: 'stale attempt failed' },
        usage: { punctuation: punctuationUsage }
      });

    expect(response.status).toBe(202);
    expect(await recordingJobs.getById(activeJob.id)).toEqual(activeJob);
    expect(await cloudUsage.listByJob(activeJob.id)).toEqual([
      expect.objectContaining({
        entryKey: `actual:${activeJob.id}:punctuation:${supersededJob.transcriptionLeaseToken}`,
        stage: 'punctuation'
      })
    ]);
  });

  it('does not overwrite a newer transcription lease issued while usage append is delayed', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new DelayedCloudUsageLedgerRepository();
    const staleJob = createAssignedCloudJob();
    await recordingJobs.save(staleJob);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const callback = request(app)
      .post(`/recording-jobs/${staleJob.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        leaseToken: staleJob.transcriptionLeaseToken,
        transcriptArtifact,
        usage: { audioMs: 60_000 }
      })
      .then((response) => response);

    await cloudUsage.appendStarted;
    const activeJob = assignTranscriptionJobToWorker(staleJob, 'transcription-worker-2');
    await recordingJobs.save(activeJob);
    cloudUsage.releaseAppend();

    const response = await callback;

    expect(response.status).toBe(202);
    expect(await recordingJobs.getById(activeJob.id)).toEqual(activeJob);
    expect((await recordingJobs.getById(activeJob.id))?.transcriptArtifact).toBeUndefined();
    expect(await cloudUsage.listByJob(activeJob.id)).toEqual([
      expect.objectContaining({
        entryKey: `actual:${activeJob.id}:transcription:${staleJob.transcriptionLeaseToken}`,
        usageQuantity: 60_000
      })
    ]);
  });

  it('does not overwrite cancellation recorded while usage append is delayed', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new DelayedCloudUsageLedgerRepository();
    const assignedJob = createAssignedCloudJob();
    await recordingJobs.save(assignedJob);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });

    const callback = request(app)
      .post(`/recording-jobs/${assignedJob.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        leaseToken: assignedJob.transcriptionLeaseToken,
        transcriptArtifact,
        usage: { audioMs: 60_000 }
      })
      .then((response) => response);

    await cloudUsage.appendStarted;
    const cancelledJob = markRecordingJobFailed(assignedJob, {
      code: 'operator-cancel-requested',
      message: 'cancelled by operator'
    });
    await recordingJobs.save(cancelledJob);
    cloudUsage.releaseAppend();

    const response = await callback;

    expect(response.status).toBe(202);
    expect(await recordingJobs.getById(cancelledJob.id)).toEqual(cancelledJob);
    expect((await recordingJobs.getById(cancelledJob.id))?.transcriptArtifact).toBeUndefined();
    expect(await cloudUsage.listByJob(cancelledJob.id)).toEqual([
      expect.objectContaining({
        entryKey: `actual:${cancelledJob.id}:transcription:${assignedJob.transcriptionLeaseToken}`,
        usageQuantity: 60_000
      })
    ]);
  });

  it('keeps an exact duplicate callback idempotent', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });
    const payload = {
      type: 'transcript-artifact-stored' as const,
      leaseToken: job.transcriptionLeaseToken,
      transcriptArtifact,
      usage: { audioMs: 60_000, punctuation: punctuationUsage }
    };

    const first = await request(app).post(`/recording-jobs/${job.id}/events`).send(payload);
    const firstEntries = await cloudUsage.listByJob(job.id);
    const duplicate = await request(app).post(`/recording-jobs/${job.id}/events`).send(payload);

    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(202);
    expect(await cloudUsage.listByJob(job.id)).toEqual(firstEntries);
  });

  it('surfaces a conflicting duplicate callback without mutating the first ledger payload', async () => {
    const recordingJobs = new InMemoryRecordingJobRepository();
    const cloudUsage = new InMemoryCloudUsageLedgerRepository();
    const job = createAssignedCloudJob();
    await recordingJobs.save(job);
    const app = createApp(recordingJobs, { cloudUsageLedgerRepository: cloudUsage });
    const payload = {
      type: 'transcript-artifact-stored' as const,
      leaseToken: job.transcriptionLeaseToken,
      transcriptArtifact,
      usage: { audioMs: 60_000, punctuation: punctuationUsage }
    };
    await request(app).post(`/recording-jobs/${job.id}/events`).send(payload);
    const firstEntries = await cloudUsage.listByJob(job.id);

    const conflict = await request(app)
      .post(`/recording-jobs/${job.id}/events`)
      .send({
        ...payload,
        usage: {
          ...payload.usage,
          punctuation: {
            ...punctuationUsage,
            inputTokens: 1_100,
            totalTokens: 1_400
          }
        }
      });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('cloud-usage-ledger-conflict');
    expect(await cloudUsage.listByJob(job.id)).toEqual(firstEntries);
  });
});
