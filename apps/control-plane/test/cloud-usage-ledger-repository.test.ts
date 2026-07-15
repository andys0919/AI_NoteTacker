import { describe, expect, it } from 'vitest';

import type { CloudUsageLedgerEntryInput } from '../src/domain/cloud-usage-ledger-repository.js';
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
      costUsd: null
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
        actualPunctuationCostUsd: 0,
        hasUnpricedPunctuationUsage: true,
        actualSummaryCostUsd: 0.02,
        hasUnpricedSummaryUsage: false,
        actualCloudCostUsd: null,
        hasUnpricedUsage: true
      }
    });
  });
});
