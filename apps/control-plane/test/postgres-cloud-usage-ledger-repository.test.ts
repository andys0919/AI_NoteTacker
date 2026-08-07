import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';

import type {
  CloudUsageLedgerEntryInput,
  ProviderRequestStartInput
} from '../src/domain/cloud-usage-ledger-repository.js';
import {
  ensureCloudUsageLedgerSchema,
  PostgresCloudUsageLedgerRepository
} from '../src/infrastructure/postgres/postgres-cloud-usage-ledger-repository.js';

type TestPool = {
  query: <TRow extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
  end: () => Promise<void>;
};

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

describe('ensureCloudUsageLedgerSchema', () => {
  let db: ReturnType<typeof newDb>;
  let pool: TestPool;

  const getTableIndexNames = (tableName: string): string[] => {
    const table = db.public.getTable(tableName);

    return [...table.indexByHashAndName.values()]
      .flatMap((indexesByName: Map<string, unknown>) => [...indexesByName.keys()])
      .sort();
  };

  beforeEach(async () => {
    db = newDb({ noAstCoverageCheck: true });
    const adapter = db.adapters.createPg();
    pool = new adapter.Pool();

    await ensureCloudUsageLedgerSchema(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('creates the quota and job lookup indexes required for usage reporting', () => {
    expect(getTableIndexNames('cloud_usage_ledger')).toEqual(
      expect.arrayContaining([
        'cloud_usage_ledger_entry_key_key',
        'cloud_usage_ledger_job_created_at_idx',
        'cloud_usage_ledger_quota_day_created_at_idx',
        'cloud_usage_ledger_submitter_day_created_at_idx',
        'cloud_usage_ledger_pkey'
      ])
    );
    expect(getTableIndexNames('provider_request_ledger')).toEqual(
      expect.arrayContaining([
        'provider_request_ledger_job_started_at_idx',
        'provider_request_ledger_pkey',
        'provider_request_ledger_quota_day_started_at_idx',
        'provider_request_ledger_started_at_desc_idx',
        'provider_request_ledger_status_started_at_idx',
        'provider_request_ledger_submitter_day_started_at_idx'
      ])
    );
  });

  it('backfills legacy usage as unpriced when rows lack authoritative meter identity', async () => {
    await pool.end();

    db = newDb({ noAstCoverageCheck: true });
    const adapter = db.adapters.createPg();
    pool = new adapter.Pool();
    await pool.query(`
      CREATE TABLE cloud_usage_ledger (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        submitter_id TEXT NOT NULL,
        quota_day_key TEXT NOT NULL,
        entry_type TEXT NOT NULL,
        stage TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        pricing_version TEXT NOT NULL,
        usage_quantity NUMERIC(18, 6) NOT NULL,
        usage_unit TEXT NOT NULL,
        cost_usd NUMERIC(12, 6) NOT NULL,
        detail JSONB,
        created_at TIMESTAMPTZ NOT NULL
      );

      INSERT INTO cloud_usage_ledger (
        id,
        job_id,
        submitter_id,
        quota_day_key,
        entry_type,
        stage,
        provider,
        model,
        pricing_version,
        usage_quantity,
        usage_unit,
        cost_usd,
        created_at
      ) VALUES
        (
          'legacy_summary',
          'job-legacy',
          'user-1',
          '2026-07-14',
          'actual',
          'summary',
          'azure-openai',
          'gpt-5.6-luna',
          'v1',
          1500,
          'tokens',
          0.002,
          '2026-07-14T00:00:00.000Z'
        ),
        (
          'legacy_transcription',
          'job-legacy',
          'user-1',
          '2026-07-14',
          'actual',
          'transcription',
          'azure-openai-gpt-4o-transcribe',
          'gpt-4o-transcribe',
          'v1',
          60000,
          'audio-ms',
          0.003,
          '2026-07-14T00:01:00.000Z'
        );
    `);

    await ensureCloudUsageLedgerSchema(pool);

    const migrated = await pool.query<{
      id: string;
      cost_usd: number | null;
      pricing_status: string;
    }>(`
      SELECT id, cost_usd, pricing_status
      FROM cloud_usage_ledger
      ORDER BY id ASC
    `);

    expect(migrated.rows).toEqual([
      { id: 'legacy_summary', cost_usd: null, pricing_status: 'unpriced' },
      { id: 'legacy_transcription', cost_usd: null, pricing_status: 'unpriced' }
    ]);

    const repository = new PostgresCloudUsageLedgerRepository(pool);
    await expect(
      repository.append({
        entryKey: 'actual:job-new:punctuation',
        jobId: 'job-new',
        submitterId: 'user-1',
        quotaDayKey: '2026-07-15',
        entryType: 'actual',
        stage: 'punctuation',
        provider: 'azure-openai',
        model: 'gpt-5.6-luna',
        pricingVersion: 'v1',
        usageQuantity: 200,
        usageUnit: 'tokens',
        pricingStatus: 'unpriced',
        costUsd: null
      })
    ).resolves.toMatchObject({ pricingStatus: 'unpriced', costUsd: null });
  });

  it('keeps the first payload for an entry key and rejects a conflicting retry', async () => {
    const repository = new PostgresCloudUsageLedgerRepository(pool);
    const input = pricedUsage();
    const first = await repository.append(input);

    await expect(repository.append(input)).resolves.toEqual(first);
    await expect(repository.append(pricedUsage({ costUsd: 0.004 }))).rejects.toThrow(
      /conflict/i
    );
    await expect(repository.listByJob('job-1')).resolves.toEqual([first]);
  });

  it('summarizes punctuation and unpriced stage usage without reporting a false total', async () => {
    const repository = new PostgresCloudUsageLedgerRepository(pool);
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

  it('persists and idempotently finalizes request-level provider usage', async () => {
    const repository = new PostgresCloudUsageLedgerRepository(pool);
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
    await expect(repository.listRecentProviderRequests(10)).resolves.toEqual([finished]);
  });
});
