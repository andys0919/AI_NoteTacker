import { describe, expect, it } from 'vitest';

import {
  CURRENT_SCHEMA_MIGRATION,
  runSchemaMigrations
} from '../src/infrastructure/repository-factory.js';

describe('schema migrations', () => {
  it('runs the provider-request schema once after the prior production migration', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const previousMigration = '20260805-runtime-hardening-v1';
    const applied = new Set<string>([previousMigration]);
    const client = {
      async query<TRow extends Record<string, unknown>>(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (text.includes('SELECT version FROM schema_migrations')) {
          const version = String(values?.[0]);
          return { rows: (applied.has(version) ? [{ version }] : []) as TRow[] };
        }
        if (text.includes('INSERT INTO schema_migrations')) {
          applied.add(String(values?.[0]));
        }
        return { rows: [] as TRow[] };
      },
      release() {}
    };
    const pool = { async connect() { return client; } };

    await runSchemaMigrations(pool);
    await runSchemaMigrations(pool);

    expect(CURRENT_SCHEMA_MIGRATION).toBe('20260806-summary-fallback-request-binding-v1');
    expect(applied).toEqual(new Set([previousMigration, CURRENT_SCHEMA_MIGRATION]));
    expect(
      queries.filter(({ text }) => text.includes('CREATE TABLE IF NOT EXISTS recording_jobs'))
    ).toHaveLength(1);
    expect(
      queries.filter(({ text }) => text.includes('pg_advisory_xact_lock'))
    ).toHaveLength(2);
  });
});
