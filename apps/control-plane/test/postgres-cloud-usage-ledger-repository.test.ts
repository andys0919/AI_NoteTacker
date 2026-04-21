import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';

import { ensureCloudUsageLedgerSchema } from '../src/infrastructure/postgres/postgres-cloud-usage-ledger-repository.js';

describe('ensureCloudUsageLedgerSchema', () => {
  let db: ReturnType<typeof newDb>;
  let end: (() => Promise<void>) | undefined;

  const getTableIndexNames = (tableName: string): string[] => {
    const table = db.public.getTable(tableName);

    return [...table.indexByHashAndName.values()]
      .flatMap((indexesByName: Map<string, unknown>) => [...indexesByName.keys()])
      .sort();
  };

  beforeEach(async () => {
    db = newDb();
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();

    await ensureCloudUsageLedgerSchema(pool);
    end = async () => {
      await pool.end();
    };
  });

  afterEach(async () => {
    if (end) {
      await end();
    }
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
  });
});
