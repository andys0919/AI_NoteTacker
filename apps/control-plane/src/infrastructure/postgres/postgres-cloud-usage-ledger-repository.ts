import type {
  CloudUsageCostSummary,
  CloudUsageLedgerEntry,
  CloudUsageLedgerEntryInput,
  CloudUsagePricingStatus,
  CloudUsageProvider,
  CloudUsageLedgerRepository,
  ProviderRequestAudit,
  ProviderRequestBillingClass,
  ProviderRequestFinishInput,
  ProviderRequestPricingStatus,
  ProviderRequestStartInput,
  ProviderRequestStatus
} from '../../domain/cloud-usage-ledger-repository.js';
import {
  CloudUsageLedgerConflictError,
  isSameCloudUsageLedgerPayload,
  isSameProviderRequestFinish,
  isSameProviderRequestStart,
  ProviderRequestAuditConflictError
} from '../../domain/cloud-usage-ledger-repository.js';
import { summarizeActualCostsByJobIds } from '../../domain/cloud-usage.js';

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

type ProviderRequestRow = {
  request_id: string;
  job_id: string;
  submitter_id: string;
  quota_day_key: string;
  stage: ProviderRequestAudit['stage'];
  provider: string;
  model: string;
  pricing_version: string;
  lease_token_hash: string;
  billing_class: ProviderRequestBillingClass;
  status: ProviderRequestStatus;
  provider_request_id: string | null;
  http_status: number | null;
  error_code: string | null;
  usage_quantity: number | string | null;
  usage_unit: ProviderRequestAudit['usageUnit'] | null;
  pricing_status: ProviderRequestPricingStatus;
  known_cost_usd: number | string;
  cost_usd: number | string | null;
  detail: Record<string, unknown> | null;
  started_at: Date | string;
  finished_at: Date | string | null;
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

  CREATE TABLE IF NOT EXISTS provider_request_ledger (
    request_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    submitter_id TEXT NOT NULL,
    quota_day_key TEXT NOT NULL,
    stage TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    pricing_version TEXT NOT NULL,
    lease_token_hash TEXT NOT NULL,
    billing_class TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_request_id TEXT,
    http_status INTEGER,
    error_code TEXT,
    usage_quantity NUMERIC(18, 6),
    usage_unit TEXT,
    pricing_status TEXT NOT NULL,
    known_cost_usd NUMERIC(12, 6) NOT NULL,
    cost_usd NUMERIC(12, 6),
    detail JSONB,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ
  );

  CREATE INDEX IF NOT EXISTS provider_request_ledger_job_started_at_idx
  ON provider_request_ledger (job_id, started_at ASC);

  CREATE INDEX IF NOT EXISTS provider_request_ledger_submitter_day_started_at_idx
  ON provider_request_ledger (submitter_id, quota_day_key, started_at ASC);

  CREATE INDEX IF NOT EXISTS provider_request_ledger_quota_day_started_at_idx
  ON provider_request_ledger (quota_day_key, started_at ASC);

  CREATE INDEX IF NOT EXISTS provider_request_ledger_status_started_at_idx
  ON provider_request_ledger (status, started_at ASC);

  CREATE INDEX IF NOT EXISTS provider_request_ledger_started_at_desc_idx
  ON provider_request_ledger (started_at DESC);
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

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const mapProviderRequestRow = (row: ProviderRequestRow): ProviderRequestAudit => ({
  requestId: row.request_id,
  jobId: row.job_id,
  submitterId: row.submitter_id,
  quotaDayKey: row.quota_day_key,
  stage: row.stage,
  provider: row.provider as CloudUsageProvider,
  model: row.model,
  pricingVersion: row.pricing_version,
  leaseTokenHash: row.lease_token_hash,
  billingClass: row.billing_class,
  status: row.status,
  providerRequestId: row.provider_request_id ?? undefined,
  httpStatus: row.http_status ?? undefined,
  errorCode: row.error_code ?? undefined,
  usageQuantity:
    row.usage_quantity === null ? undefined : toNumber(row.usage_quantity),
  usageUnit: row.usage_unit ?? undefined,
  pricingStatus: row.pricing_status,
  knownCostUsd: toNumber(row.known_cost_usd),
  costUsd: row.cost_usd === null ? null : toNumber(row.cost_usd),
  detail: row.detail ?? undefined,
  startedAt: toIsoString(row.started_at),
  finishedAt: row.finished_at === null ? undefined : toIsoString(row.finished_at)
});

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

  async listProviderRequestsByQuotaDayKey(
    quotaDayKey: string
  ): Promise<ProviderRequestAudit[]> {
    const result = await this.database.query<ProviderRequestRow>(
      `
        SELECT *
        FROM provider_request_ledger
        WHERE quota_day_key = $1
        ORDER BY started_at ASC
      `,
      [quotaDayKey]
    );

    return result.rows.map(mapProviderRequestRow);
  }

  async startProviderRequest(input: ProviderRequestStartInput): Promise<ProviderRequestAudit> {
    const result = await this.database.query<ProviderRequestRow>(
      `
        INSERT INTO provider_request_ledger (
          request_id,
          job_id,
          submitter_id,
          quota_day_key,
          stage,
          provider,
          model,
          pricing_version,
          lease_token_hash,
          billing_class,
          status,
          pricing_status,
          known_cost_usd,
          cost_usd,
          detail,
          started_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'started', $11, 0, NULL, $12::jsonb, $13::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [
        input.requestId,
        input.jobId,
        input.submitterId,
        input.quotaDayKey,
        input.stage,
        input.provider,
        input.model,
        input.pricingVersion,
        input.leaseTokenHash,
        input.billingClass,
        input.billingClass === 'metered-api' ? 'pending' : 'not-applicable',
        input.detail ? JSON.stringify(input.detail) : null,
        input.startedAt
      ]
    );

    if (result.rows[0]) {
      return mapProviderRequestRow(result.rows[0]);
    }

    const existing = await this.getProviderRequest(input.requestId);
    if (existing && isSameProviderRequestStart(existing, input)) {
      return existing;
    }

    throw new ProviderRequestAuditConflictError(input.requestId);
  }

  async finishProviderRequest(input: ProviderRequestFinishInput): Promise<ProviderRequestAudit> {
    const result = await this.database.query<ProviderRequestRow>(
      `
        UPDATE provider_request_ledger
        SET
          status = $2,
          provider_request_id = $3,
          http_status = $4,
          error_code = $5,
          usage_quantity = $6,
          usage_unit = $7,
          pricing_status = $8,
          known_cost_usd = $9,
          cost_usd = $10,
          detail = $11::jsonb,
          finished_at = $12::timestamptz
        WHERE request_id = $1
          AND status = 'started'
        RETURNING *
      `,
      [
        input.requestId,
        input.status,
        input.providerRequestId ?? null,
        input.httpStatus ?? null,
        input.errorCode ?? null,
        input.usageQuantity ?? null,
        input.usageUnit ?? null,
        input.pricingStatus,
        input.knownCostUsd,
        input.costUsd,
        input.detail ? JSON.stringify(input.detail) : null,
        input.finishedAt
      ]
    );

    if (result.rows[0]) {
      return mapProviderRequestRow(result.rows[0]);
    }

    const existing = await this.getProviderRequest(input.requestId);
    if (!existing) {
      throw new Error(`Provider request audit not found: ${input.requestId}`);
    }
    if (isSameProviderRequestFinish(existing, input)) {
      return existing;
    }

    throw new ProviderRequestAuditConflictError(input.requestId);
  }

  async getProviderRequest(requestId: string): Promise<ProviderRequestAudit | undefined> {
    const result = await this.database.query<ProviderRequestRow>(
      `
        SELECT *
        FROM provider_request_ledger
        WHERE request_id = $1
      `,
      [requestId]
    );

    return result.rows[0] ? mapProviderRequestRow(result.rows[0]) : undefined;
  }

  async listProviderRequestsByJob(jobId: string): Promise<ProviderRequestAudit[]> {
    const result = await this.database.query<ProviderRequestRow>(
      `
        SELECT *
        FROM provider_request_ledger
        WHERE job_id = $1
        ORDER BY started_at ASC
      `,
      [jobId]
    );

    return result.rows.map(mapProviderRequestRow);
  }

  async listProviderRequestsBySubmitterAndDay(
    submitterId: string,
    quotaDayKey: string
  ): Promise<ProviderRequestAudit[]> {
    const result = await this.database.query<ProviderRequestRow>(
      `
        SELECT *
        FROM provider_request_ledger
        WHERE submitter_id = $1
          AND quota_day_key = $2
        ORDER BY started_at ASC
      `,
      [submitterId, quotaDayKey]
    );

    return result.rows.map(mapProviderRequestRow);
  }

  async listRecentProviderRequests(limit: number): Promise<ProviderRequestAudit[]> {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 500;
    const result = await this.database.query<ProviderRequestRow>(
      `
        SELECT *
        FROM provider_request_ledger
        ORDER BY started_at DESC
        LIMIT $1
      `,
      [safeLimit]
    );

    return result.rows.map(mapProviderRequestRow);
  }

  async summarizeActualCostByJobIds(
    jobIds: string[]
  ): Promise<Record<string, CloudUsageCostSummary>> {
    if (jobIds.length === 0) {
      return {};
    }

    const placeholders = jobIds.map((_, index) => `$${index + 1}`).join(', ');
    const result = await this.database.query<LedgerRow>(
      `
        SELECT *
        FROM cloud_usage_ledger
        WHERE job_id IN (${placeholders})
        ORDER BY created_at ASC
      `,
      jobIds
    );
    const requestResult = await this.database.query<ProviderRequestRow>(
      `
        SELECT *
        FROM provider_request_ledger
        WHERE job_id IN (${placeholders})
        ORDER BY started_at ASC
      `,
      jobIds
    );

    return summarizeActualCostsByJobIds(
      result.rows.map(mapRow),
      jobIds,
      requestResult.rows.map(mapProviderRequestRow)
    );
  }
}
