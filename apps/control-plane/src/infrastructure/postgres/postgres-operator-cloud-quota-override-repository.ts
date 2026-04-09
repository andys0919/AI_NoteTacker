import type {
  OperatorCloudQuotaOverride,
  OperatorCloudQuotaOverrideRepository
} from '../../domain/operator-cloud-quota-override-repository.js';

type Queryable = {
  query: <TRow extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
};

type QuotaOverrideRow = {
  submitter_id: string;
  daily_quota_usd: number | string;
  updated_at: Date | string;
  updated_by: string | null;
};

const schemaSql = `
  CREATE TABLE IF NOT EXISTS operator_cloud_quota_overrides (
    submitter_id TEXT PRIMARY KEY,
    daily_quota_usd NUMERIC(12, 6) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    updated_by TEXT
  );
`;

const toNumber = (value: number | string): number =>
  typeof value === 'number' ? value : Number(value);

const mapRow = (row: QuotaOverrideRow): OperatorCloudQuotaOverride => ({
  submitterId: row.submitter_id,
  dailyQuotaUsd: toNumber(row.daily_quota_usd),
  updatedAt:
    row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  updatedBy: row.updated_by ?? undefined
});

export const ensureOperatorCloudQuotaOverrideSchema = async (
  database: Queryable
): Promise<void> => {
  await database.query(schemaSql);
};

export class PostgresOperatorCloudQuotaOverrideRepository
  implements OperatorCloudQuotaOverrideRepository
{
  constructor(private readonly database: Queryable) {}

  async getBySubmitterId(
    submitterId: string
  ): Promise<OperatorCloudQuotaOverride | undefined> {
    const result = await this.database.query<QuotaOverrideRow>(
      `
        SELECT *
        FROM operator_cloud_quota_overrides
        WHERE submitter_id = $1
      `,
      [submitterId]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async listAll(): Promise<OperatorCloudQuotaOverride[]> {
    const result = await this.database.query<QuotaOverrideRow>(
      `
        SELECT *
        FROM operator_cloud_quota_overrides
        ORDER BY submitter_id ASC
      `
    );

    return result.rows.map(mapRow);
  }

  async upsert(input: {
    submitterId: string;
    dailyQuotaUsd: number;
    updatedBy?: string;
  }): Promise<OperatorCloudQuotaOverride> {
    const result = await this.database.query<QuotaOverrideRow>(
      `
        INSERT INTO operator_cloud_quota_overrides (
          submitter_id,
          daily_quota_usd,
          updated_at,
          updated_by
        )
        VALUES ($1, $2, now(), $3)
        ON CONFLICT (submitter_id) DO UPDATE SET
          daily_quota_usd = EXCLUDED.daily_quota_usd,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by
        RETURNING *
      `,
      [input.submitterId, input.dailyQuotaUsd, input.updatedBy ?? null]
    );

    return mapRow(result.rows[0]);
  }
}
