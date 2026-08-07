import { describe, expect, it } from 'vitest';

import type {
  CloudUsageLedgerEntryInput,
  ProviderRequestStartInput
} from '../src/domain/cloud-usage-ledger-repository.js';
import { InMemoryCloudUsageLedgerRepository } from '../src/infrastructure/in-memory-cloud-usage-ledger-repository.js';

const pricedUsage = (
  overrides: Partial<CloudUsageLedgerEntryInput> = {}
): CloudUsageLedgerEntryInput => ({
  entryKey: 'actual:job-1:transcription',
  jobId: 'job-1',
  submitterId: 'user-1',
  quotaDayKey: '2026-07-15',
  entryType: 'actual',
  stage: 'transcription',
  provider: 'azure-openai-gpt-4o-transcribe',
  model: 'gpt-4o-transcribe',
  pricingVersion: 'v1',
  usageQuantity: 60_000,
  usageUnit: 'audio-ms',
  pricingStatus: 'priced',
  costUsd: 0.003,
  ...overrides
});

const providerRequest = (
  overrides: Partial<ProviderRequestStartInput> = {}
): ProviderRequestStartInput => ({
  requestId: 'request-1',
  jobId: 'job-1',
  submitterId: 'user-1',
  quotaDayKey: '2026-07-15',
  stage: 'transcription',
  provider: 'azure-speech-mai-transcribe-1.5',
  model: 'mai-transcribe-1.5',
  pricingVersion: 'v1',
  leaseTokenHash: 'lease-hash',
  billingClass: 'metered-api',
  startedAt: '2026-07-15T00:00:00.000Z',
  detail: { rawAudioMs: 60_000 },
  ...overrides
});

describe('cloud usage ledger repository contract', () => {
  it('returns the first entry for an exact duplicate append', async () => {
    const repository = new InMemoryCloudUsageLedgerRepository();
    const input = pricedUsage();

    const first = await repository.append(input);
    const duplicate = await repository.append(input);

    expect(duplicate).toEqual(first);
    await expect(repository.listByJob('job-1')).resolves.toEqual([first]);
  });

  it('rejects a reused entry key with a different payload without mutating the first entry', async () => {
    const repository = new InMemoryCloudUsageLedgerRepository();
    const first = await repository.append(pricedUsage());

    await expect(repository.append(pricedUsage({ costUsd: 0.004 }))).rejects.toThrow(
      /conflict/i
    );
    await expect(repository.listByJob('job-1')).resolves.toEqual([first]);
  });

  it('keeps priced stage subtotals while making an unpriced complete total explicit', async () => {
    const repository = new InMemoryCloudUsageLedgerRepository();
    await repository.append(pricedUsage({ costUsd: 0.03 }));
    await repository.append({
      entryKey: 'actual:job-1:punctuation',
      jobId: 'job-1',
      submitterId: 'user-1',
      quotaDayKey: '2026-07-15',
      entryType: 'actual',
      stage: 'punctuation',
      provider: 'azure-openai',
      model: 'gpt-5.6-luna',
      pricingVersion: 'v1',
      usageQuantity: 1_000,
      usageUnit: 'tokens',
      pricingStatus: 'unpriced',
      costUsd: null,
      detail: {
        inputTokens: 1_000,
        cachedInputTokens: 0,
        outputTokens: 500,
        totalTokens: 1_500,
        unmeteredRequestCount: 1
      }
    });
    await repository.append(
      pricedUsage({
        entryKey: 'actual:job-1:summary',
        stage: 'summary',
        provider: 'azure-openai',
        model: 'priced-summary-model',
        usageQuantity: 500,
        usageUnit: 'tokens',
        costUsd: 0.02
      })
    );

    await expect(repository.summarizeActualCostByJobIds(['job-1'])).resolves.toEqual({
      'job-1': {
        actualTranscriptionCostUsd: 0.03,
        hasUnpricedTranscriptionUsage: false,
        actualPunctuationCostUsd: 0.004,
        hasUnpricedPunctuationUsage: true,
        actualSummaryCostUsd: 0.02,
        hasUnpricedSummaryUsage: false,
        actualCloudCostUsd: null,
        hasUnpricedUsage: true
      }
    });
  });

  it('persists provider requests before contact and finalizes them exactly once', async () => {
    const repository = new InMemoryCloudUsageLedgerRepository();
    const started = await repository.startProviderRequest(providerRequest());

    await expect(
      repository.startProviderRequest(
        providerRequest({ startedAt: '2026-07-15T00:00:01.000Z' })
      )
    ).resolves.toEqual(started);
    await expect(
      repository.startProviderRequest(providerRequest({ model: 'different-model' }))
    ).rejects.toThrow(/conflict/i);
    await expect(repository.summarizeActualCostByJobIds(['job-1'])).resolves.toMatchObject({
      'job-1': {
        actualTranscriptionCostUsd: 0,
        hasUnpricedTranscriptionUsage: true,
        actualCloudCostUsd: null
      }
    });

    const finish = {
      requestId: 'request-1',
      status: 'succeeded' as const,
      providerRequestId: 'azure-request-1',
      httpStatus: 200,
      usageQuantity: 60_000,
      usageUnit: 'audio-ms' as const,
      pricingStatus: 'priced' as const,
      knownCostUsd: 0.006,
      costUsd: 0.006,
      detail: { rawAudioMs: 60_000, billedAudioMs: 60_000 },
      finishedAt: '2026-07-15T00:00:02.000Z'
    };
    const finished = await repository.finishProviderRequest(finish);

    await expect(
      repository.finishProviderRequest({
        ...finish,
        finishedAt: '2026-07-15T00:00:03.000Z'
      })
    ).resolves.toEqual(finished);
    await expect(
      repository.finishProviderRequest({ ...finish, costUsd: 0.007 })
    ).rejects.toThrow(/conflict/i);
    await expect(repository.listProviderRequestsByJob('job-1')).resolves.toEqual([finished]);
    await expect(repository.summarizeActualCostByJobIds(['job-1'])).resolves.toMatchObject({
      'job-1': {
        actualTranscriptionCostUsd: 0.006,
        hasUnpricedTranscriptionUsage: false,
        actualCloudCostUsd: 0.006
      }
    });
  });

  it('tracks subscription requests without adding them to Azure spend', async () => {
    const repository = new InMemoryCloudUsageLedgerRepository();
    await repository.startProviderRequest(
      providerRequest({
        requestId: 'local-request',
        stage: 'summary',
        provider: 'local-codex',
        model: 'gpt-5.6-codex',
        billingClass: 'subscription'
      })
    );

    await expect(repository.summarizeActualCostByJobIds(['job-1'])).resolves.toEqual({});
  });
});
