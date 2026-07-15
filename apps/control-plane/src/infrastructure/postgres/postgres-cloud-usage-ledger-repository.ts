import type {
  CloudUsageCostSummary,
  CloudUsageLedgerEntry,
  CloudUsageLedgerEntryInput,
  CloudUsagePricingStatus,
  CloudUsageProvider,
  CloudUsageLedgerRepository
} from '../../domain/cloud-usage-ledger-repository.js';
import {
  CloudUsageLedgerConflictError,
  isSameCloudUsageLedgerPayload
} from '../../domain/cloud-usage-ledger-repository.js';
import { roundUsd } from '../../domain/cloud-usage.js';

type Queryable = {
  query: <TRow extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
};

type LedgerRow = {
  id: string;
  entry_key: string | null;
  job_id: string;
  submitter_id: string;
  quota_day_key: string;
  entry_type: CloudUsageLedgerEntry['entryType'];
  stage: CloudUsageLedgerEntry['stage'];
  provider: string;
  model: string;
  pricing_version: string;
  usage_quantity: number | string;
  usage_unit: CloudUsageLedgerEntry['usageUnit'];
  pricing_status: CloudUsagePricingStatus;
  cost_usd: number | string | null;
  detail: Record<string, unknown> | null;
  created_at: Date | string;
};

const schemaSql = `
  CREATE TABLE IF NOT EXISTS cloud_usage_ledger (
    id TEXT PRIMARY KEY,
    entry_key TEXT UNIQUE,
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
    pricing_status TEXT NOT NULL,
    cost_usd NUMERIC(12, 6),
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL
  );

  ALTER TABLE cloud_usage_ledger
  ADD COLUMN IF NOT EXISTS entry_key TEXT;

  ALTER TABLE cloud_usage_ledger
  ALTER COLUMN cost_usd DROP NOT NULL;

  ALTER TABLE cloud_usage_ledger
  ADD COLUMN IF NOT EXISTS pricing_status TEXT;

  UPDATE cloud_usage_ledger
  SET
    pricing_status = 'unpriced',
    cost_usd = NULL
  WHERE pricing_status IS NULL;

  ALTER TABLE cloud_usage_ledger
  ALTER COLUMN pricing_status SET NOT NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS cloud_usage_ledger_entry_key_key
  ON cloud_usage_ledger (entry_key)
  WHERE entry_key IS NOT NULL;

  CREATE INDEX IF NOT EXISTS cloud_usage_ledger_job_created_at_idx
  ON cloud_usage_ledger (job_id, created_at ASC);

  CREATE INDEX IF NOT EXISTS cloud_usage_ledger_quota_day_created_at_idx
  ON cloud_usage_ledger (quota_day_key, created_at ASC);

  CREATE INDEX IF NOT EXISTS cloud_usage_ledger_submitter_day_created_at_idx
  ON cloud_usage_ledger (submitter_id, quota_day_key, created_at ASC);
`;

const nextId = (): string => `usage_${crypto.randomUUID().replace(/-/g, '')}`;
const now = (): string => new Date().toISOString();

const toNumber = (value: number | string): number =>
  typeof value === 'number' ? value : Number(value);

const mapRow = (row: LedgerRow): CloudUsageLedgerEntry => {
  const entry = {
    id: row.id,
    entryKey: row.entry_key ?? undefined,
    jobId: row.job_id,
    submitterId: row.submitter_id,
    quotaDayKey: row.quota_day_key,
    entryType: row.entry_type,
    stage: row.stage,
    provider: row.provider as CloudUsageProvider,
    model: row.model,
    pricingVersion: row.pricing_version,
    usageQuantity: toNumber(row.usage_quantity),
    usageUnit: row.usage_unit,
    detail: row.detail ?? undefined,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString()
  };

  if (row.pricing_status !== 'priced' || row.cost_usd === null) {
    return { ...entry, pricingStatus: 'unpriced', costUsd: null };
  }

  return { ...entry, pricingStatus: 'priced', costUsd: toNumber(row.cost_usd) };
};

export const ensureCloudUsageLedgerSchema = async (database: Queryable): Promise<void> => {
  await database.query(schemaSql);
};

export class PostgresCloudUsageLedgerRepository implements CloudUsageLedgerRepository {
  constructor(private readonly database: Queryable) {}

  async append(input: CloudUsageLedgerEntryInput): Promise<CloudUsageLedgerEntry> {
    const result = await this.database.query<LedgerRow>(
      `
        INSERT INTO cloud_usage_ledger (
          id,
          entry_key,
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
          pricing_status,
          cost_usd,
          detail,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [
        nextId(),
        input.entryKey ?? null,
        input.jobId,
        input.submitterId,
        input.quotaDayKey,
        input.entryType,
        input.stage,
        input.provider,
        input.model,
        input.pricingVersion,
        input.usageQuantity,
        input.usageUnit,
        input.pricingStatus,
        input.costUsd,
        input.detail ? JSON.stringify(input.detail) : null,
        now()
      ]
    );

    if (result.rows[0]) {
      return mapRow(result.rows[0]);
    }

    if (!input.entryKey) {
      throw new Error('Cloud usage ledger insert conflicted without an entry key');
    }

    const existingResult = await this.database.query<LedgerRow>(
      `
        SELECT *
        FROM cloud_usage_ledger
        WHERE entry_key = $1
      `,
      [input.entryKey]
    );
    const existing = existingResult.rows[0] ? mapRow(existingResult.rows[0]) : undefined;

    if (existing && isSameCloudUsageLedgerPayload(existing, input)) {
      return existing;
    }

    throw new CloudUsageLedgerConflictError(input.entryKey);
  }

  async listByQuotaDayKey(quotaDayKey: string): Promise<CloudUsageLedgerEntry[]> {
    const result = await this.database.query<LedgerRow>(
      `
        SELECT *
        FROM cloud_usage_ledger
        WHERE quota_day_key = $1
        ORDER BY created_at ASC
      `,
      [quotaDayKey]
    );

    return result.rows.map(mapRow);
  }

  async listRecentEntries(limit: number): Promise<CloudUsageLedgerEntry[]> {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 500;
    const result = await this.database.query<LedgerRow>(
      `
        SELECT *
        FROM cloud_usage_ledger
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [safeLimit]
    );

    return result.rows.map(mapRow);
  }

  async listBySubmitterAndDay(
    submitterId: string,
    quotaDayKey: string
  ): Promise<CloudUsageLedgerEntry[]> {
    const result = await this.database.query<LedgerRow>(
      `
        SELECT *
        FROM cloud_usage_ledger
        WHERE submitter_id = $1
          AND quota_day_key = $2
        ORDER BY created_at ASC
      `,
      [submitterId, quotaDayKey]
    );

    return result.rows.map(mapRow);
  }

  async listByJob(jobId: string): Promise<CloudUsageLedgerEntry[]> {
    const result = await this.database.query<LedgerRow>(
      `
        SELECT *
        FROM cloud_usage_ledger
        WHERE job_id = $1
        ORDER BY created_at ASC
      `,
      [jobId]
    );

    return result.rows.map(mapRow);
  }

  async summarizeActualCostByJobIds(
    jobIds: string[]
  ): Promise<Record<string, CloudUsageCostSummary>> {
    if (jobIds.length === 0) {
      return {};
    }

    const placeholders = jobIds.map((_, index) => `$${index + 1}`).join(', ');
    const result = await this.database.query<{
      job_id: string;
      actual_transcription_cost_usd: number | string;
      unpriced_transcription_count: number | string;
      actual_punctuation_cost_usd: number | string;
      unpriced_punctuation_count: number | string;
      actual_summary_cost_usd: number | string;
      unpriced_summary_count: number | string;
    }>(
      `
        SELECT
          job_id,
          COALESCE(
            SUM(
              CASE
                WHEN entry_type = 'actual'
                  AND stage = 'transcription'
                  AND pricing_status = 'priced'
                THEN cost_usd
                ELSE 0
              END
            ),
            0
          ) AS actual_transcription_cost_usd,
          COALESCE(
            SUM(
              CASE
                WHEN entry_type = 'actual'
                  AND stage = 'transcription'
                  AND (pricing_status <> 'priced' OR cost_usd IS NULL)
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS unpriced_transcription_count,
          COALESCE(
            SUM(
              CASE
                WHEN entry_type = 'actual'
                  AND stage = 'punctuation'
                  AND pricing_status = 'priced'
                THEN cost_usd
                ELSE 0
              END
            ),
            0
          ) AS actual_punctuation_cost_usd,
          COALESCE(
            SUM(
              CASE
                WHEN entry_type = 'actual'
                  AND stage = 'punctuation'
                  AND (pricing_status <> 'priced' OR cost_usd IS NULL)
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS unpriced_punctuation_count,
          COALESCE(
            SUM(
              CASE
                WHEN entry_type = 'actual'
                  AND stage = 'summary'
                  AND pricing_status = 'priced'
                THEN cost_usd
                ELSE 0
              END
            ),
            0
          ) AS actual_summary_cost_usd,
          COALESCE(
            SUM(
              CASE
                WHEN entry_type = 'actual'
                  AND stage = 'summary'
                  AND (pricing_status <> 'priced' OR cost_usd IS NULL)
                THEN 1
                ELSE 0
              END
            ),
            0
          ) AS unpriced_summary_count
        FROM cloud_usage_ledger
        WHERE job_id IN (${placeholders})
        GROUP BY job_id
      `,
      jobIds
    );

    return Object.fromEntries(
      result.rows.map((row) => {
        const actualTranscriptionCostUsd =
          typeof row.actual_transcription_cost_usd === 'number'
            ? row.actual_transcription_cost_usd
            : Number(row.actual_transcription_cost_usd);
        const actualSummaryCostUsd =
          typeof row.actual_summary_cost_usd === 'number'
            ? row.actual_summary_cost_usd
            : Number(row.actual_summary_cost_usd);
        const actualPunctuationCostUsd =
          typeof row.actual_punctuation_cost_usd === 'number'
            ? row.actual_punctuation_cost_usd
            : Number(row.actual_punctuation_cost_usd);
        const hasUnpricedTranscriptionUsage = Number(row.unpriced_transcription_count) > 0;
        const hasUnpricedPunctuationUsage = Number(row.unpriced_punctuation_count) > 0;
        const hasUnpricedSummaryUsage = Number(row.unpriced_summary_count) > 0;
        const hasUnpricedUsage =
          hasUnpricedTranscriptionUsage ||
          hasUnpricedPunctuationUsage ||
          hasUnpricedSummaryUsage;

        return [
          row.job_id,
          {
            actualTranscriptionCostUsd: roundUsd(actualTranscriptionCostUsd),
            hasUnpricedTranscriptionUsage,
            actualPunctuationCostUsd: roundUsd(actualPunctuationCostUsd),
            hasUnpricedPunctuationUsage,
            actualSummaryCostUsd: roundUsd(actualSummaryCostUsd),
            hasUnpricedSummaryUsage,
            actualCloudCostUsd: hasUnpricedUsage
              ? null
              : roundUsd(
                  actualTranscriptionCostUsd +
                    actualPunctuationCostUsd +
                    actualSummaryCostUsd
                ),
            hasUnpricedUsage
          }
        ];
      })
    );
  }
}
