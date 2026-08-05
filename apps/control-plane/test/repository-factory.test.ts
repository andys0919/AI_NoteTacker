import { describe, expect, it } from 'vitest';

import {
  CURRENT_SCHEMA_MIGRATION,
  runSchemaMigrations
} from '../src/infrastructure/repository-factory.js';

describe('schema migrations', () => {
  it('runs the current schema once and records its version under a transaction lock', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const applied = new Set<string>();
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

    expect(applied).toEqual(new Set([CURRENT_SCHEMA_MIGRATION]));
    expect(
      queries.filter(({ text }) => text.includes('CREATE TABLE IF NOT EXISTS recording_jobs'))
    ).toHaveLength(1);
    expect(
      queries.filter(({ text }) => text.includes('pg_advisory_xact_lock'))
    ).toHaveLength(2);
  });
});
