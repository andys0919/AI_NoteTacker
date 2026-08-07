import { Pool } from 'pg';

import type { AdminAuditLogRepository } from '../domain/admin-audit-log-repository.js';
import type { AuthenticatedUserRepository } from '../domain/authenticated-user-repository.js';
import type { CloudUsageLedgerRepository } from '../domain/cloud-usage-ledger-repository.js';
import type { OperatorCloudQuotaOverrideRepository } from '../domain/operator-cloud-quota-override-repository.js';
import type { RecordingJobRepository } from '../domain/recording-job-repository.js';
import type { TranscriptionProviderSettingsRepository } from '../domain/transcription-provider-settings-repository.js';
import { InMemoryAdminAuditLogRepository } from './in-memory-admin-audit-log-repository.js';
import { InMemoryAuthenticatedUserRepository } from './in-memory-authenticated-user-repository.js';
import { InMemoryCloudUsageLedgerRepository } from './in-memory-cloud-usage-ledger-repository.js';
import { InMemoryOperatorCloudQuotaOverrideRepository } from './in-memory-operator-cloud-quota-override-repository.js';
import { InMemoryRecordingJobRepository } from './in-memory-recording-job-repository.js';
import { InMemoryTranscriptionProviderSettingsRepository } from './in-memory-transcription-provider-settings-repository.js';
import {
  ensureAdminAuditLogSchema,
  PostgresAdminAuditLogRepository
} from './postgres/postgres-admin-audit-log-repository.js';
import {
  ensureAuthenticatedUserSchema,
  PostgresAuthenticatedUserRepository
} from './postgres/postgres-authenticated-user-repository.js';
import {
  ensureCloudUsageLedgerSchema,
  PostgresCloudUsageLedgerRepository
} from './postgres/postgres-cloud-usage-ledger-repository.js';
import {
  ensureOperatorCloudQuotaOverrideSchema,
  PostgresOperatorCloudQuotaOverrideRepository
} from './postgres/postgres-operator-cloud-quota-override-repository.js';
import {
  ensureRecordingJobSchema,
  PostgresRecordingJobRepository
} from './postgres/postgres-recording-job-repository.js';
import {
  ensureTranscriptionProviderSettingsSchema,
  PostgresTranscriptionProviderSettingsRepository
} from './postgres/postgres-transcription-provider-settings-repository.js';
import { createSummaryProviderCatalogFromEnvironment } from './summary-provider-catalog.js';
import { createTranscriptionProviderCatalogFromEnvironment } from './transcription-provider-catalog.js';

const isPostgresDriver = (value: string | undefined): boolean => value === 'postgres';

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const withRetry = async <T>(operation: () => Promise<T>, attempts: number, delayMs: number): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
};

export const CURRENT_SCHEMA_MIGRATION = '20260806-summary-fallback-request-binding-v1';

type MigrationClient = {
  query: <TRow extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
  release: () => void;
};

type MigrationPool = {
  connect: () => Promise<MigrationClient>;
};

export const runSchemaMigrations = async (pool: MigrationPool): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ai-notetacker-schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [CURRENT_SCHEMA_MIGRATION]
    );

    if (applied.rows.length === 0) {
      await ensureRecordingJobSchema(client);
      await ensureAuthenticatedUserSchema(client);
      await ensureTranscriptionProviderSettingsSchema(client);
      await ensureOperatorCloudQuotaOverrideSchema(client);
      await ensureCloudUsageLedgerSchema(client);
      await ensureAdminAuditLogSchema(client);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [
        CURRENT_SCHEMA_MIGRATION
      ]);
    }

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the migration failure when rollback also fails.
    }
    throw error;
  } finally {
    client.release();
  }
};

export type PersistenceContext = {
  recordingJobRepository: RecordingJobRepository;
  authenticatedUserRepository: AuthenticatedUserRepository;
  transcriptionProviderSettingsRepository: TranscriptionProviderSettingsRepository;
  operatorCloudQuotaOverrideRepository: OperatorCloudQuotaOverrideRepository;
  cloudUsageLedgerRepository: CloudUsageLedgerRepository;
  adminAuditLogRepository: AdminAuditLogRepository;
};

export const createPersistenceContextFromEnvironment = async (): Promise<PersistenceContext> => {
  const transcriptionCatalog = createTranscriptionProviderCatalogFromEnvironment();
  const summaryCatalog = createSummaryProviderCatalogFromEnvironment();
  const defaultProvider = transcriptionCatalog.defaultProvider;
  const defaultLocalTranscriptionModel = process.env.WHISPER_MODEL ?? 'large-v3';
  const defaultQwenTranscriptionModel = process.env.QWEN_ASR_MODEL ?? 'qwen3-asr-1.7b';
  const defaultMaiTranscriptionModel =
    process.env.AZURE_SPEECH_MAI_MODEL ?? 'mai-transcribe-1.5';
  const defaultCloudTranscriptionModel =
    process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-transcribe';
  const defaultTranscriptionModel =
    defaultProvider === 'azure-openai-gpt-4o-transcribe'
      ? defaultCloudTranscriptionModel
      : defaultProvider === 'azure-speech-mai-transcribe-1.5'
        ? defaultMaiTranscriptionModel
      : defaultProvider === 'qwen3-asr-1.7b'
        ? defaultQwenTranscriptionModel
        : defaultLocalTranscriptionModel;
  const defaultSummaryModel = process.env.SUMMARY_MODEL ?? 'gpt-5.6-luna';
  const defaultSummaryProvider = summaryCatalog.defaultProvider;
  const defaultDailyCloudQuotaUsd = Number(process.env.DEFAULT_DAILY_CLOUD_QUOTA_USD ?? '5');
  const defaultLiveMeetingReservationCapUsd = Number(
    process.env.LIVE_MEETING_RESERVATION_CAP_USD ?? '1.5'
  );
  const defaultPricingVersion = process.env.AI_PRICING_VERSION ?? 'v1';
  const defaultConcurrency = Math.max(
    1,
    Number(process.env.MAX_CONCURRENT_TRANSCRIPTION_JOBS ?? '1')
  );

  if (!isPostgresDriver(process.env.PERSISTENCE_DRIVER)) {
    return {
      recordingJobRepository: new InMemoryRecordingJobRepository(),
      authenticatedUserRepository: new InMemoryAuthenticatedUserRepository(),
      transcriptionProviderSettingsRepository: new InMemoryTranscriptionProviderSettingsRepository(
        {
          defaultTranscriptionProvider: defaultProvider,
          defaultTranscriptionModel,
          defaultLocalTranscriptionModel,
          defaultQwenTranscriptionModel,
          defaultMaiTranscriptionModel,
          defaultCloudTranscriptionModel,
          defaultSummaryProvider,
          defaultSummaryModel,
          defaultDailyCloudQuotaUsd,
          defaultLiveMeetingReservationCapUsd,
          defaultPricingVersion,
          defaultConcurrencyPools: {
            localTranscription: defaultConcurrency,
            cloudTranscription: defaultConcurrency,
            localSummary: 1,
            cloudSummary: 1
          }
        }
      ),
      operatorCloudQuotaOverrideRepository: new InMemoryOperatorCloudQuotaOverrideRepository(),
      cloudUsageLedgerRepository: new InMemoryCloudUsageLedgerRepository(),
      adminAuditLogRepository: new InMemoryAdminAuditLogRepository()
    };
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL must be set when PERSISTENCE_DRIVER=postgres');
  }

  const pool = new Pool({
    connectionString
  });

  try {
    await withRetry(async () => {
      await runSchemaMigrations(pool);
    }, 10, 3000);
  } catch (error) {
    // Release the pool's TCP connections before bubbling up; otherwise a restart loop
    // (e.g. in Docker) leaks connections until the previous pool's FIN_WAIT expires.
    // Swallow any drain error so the original schema-init failure is what propagates.
    try {
      await pool.end();
    } catch {
      // ignore pool drain error
    }
    throw error;
  }

  return {
    recordingJobRepository: new PostgresRecordingJobRepository(pool),
    authenticatedUserRepository: new PostgresAuthenticatedUserRepository(pool),
    transcriptionProviderSettingsRepository: new PostgresTranscriptionProviderSettingsRepository(
      pool,
      {
        transcriptionProvider: defaultProvider,
        transcriptionModel: defaultTranscriptionModel,
        localTranscriptionModel: defaultLocalTranscriptionModel,
        qwenTranscriptionModel: defaultQwenTranscriptionModel,
        maiTranscriptionModel: defaultMaiTranscriptionModel,
        cloudTranscriptionModel: defaultCloudTranscriptionModel,
        summaryProvider: defaultSummaryProvider,
        summaryModel: defaultSummaryModel,
        pricingVersion: defaultPricingVersion,
        defaultDailyCloudQuotaUsd,
        liveMeetingReservationCapUsd: defaultLiveMeetingReservationCapUsd,
        concurrencyPools: {
          localTranscription: defaultConcurrency,
          cloudTranscription: defaultConcurrency,
          localSummary: 1,
          cloudSummary: 1
        }
      }
    ),
    operatorCloudQuotaOverrideRepository: new PostgresOperatorCloudQuotaOverrideRepository(pool),
    cloudUsageLedgerRepository: new PostgresCloudUsageLedgerRepository(pool),
    adminAuditLogRepository: new PostgresAdminAuditLogRepository(pool)
  };
};
