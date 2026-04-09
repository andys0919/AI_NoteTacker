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

export const createRecordingJobRepositoryFromEnvironment = async (): Promise<RecordingJobRepository> => {
  const context = await createPersistenceContextFromEnvironment();
  return context.recordingJobRepository;
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
  const defaultCloudTranscriptionModel =
    process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini-transcribe';
  const defaultTranscriptionModel =
    defaultProvider === 'azure-openai-gpt-4o-mini-transcribe'
      ? defaultCloudTranscriptionModel
      : defaultLocalTranscriptionModel;
  const defaultSummaryModel = process.env.SUMMARY_MODEL ?? 'gpt-5-mini';
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

  await withRetry(async () => {
    await ensureRecordingJobSchema(pool);
    await ensureAuthenticatedUserSchema(pool);
    await ensureTranscriptionProviderSettingsSchema(pool);
    await ensureOperatorCloudQuotaOverrideSchema(pool);
    await ensureCloudUsageLedgerSchema(pool);
    await ensureAdminAuditLogSchema(pool);
  }, 10, 3000);

  return {
    recordingJobRepository: new PostgresRecordingJobRepository(pool),
    authenticatedUserRepository: new PostgresAuthenticatedUserRepository(pool),
    transcriptionProviderSettingsRepository: new PostgresTranscriptionProviderSettingsRepository(
      pool,
      {
        transcriptionProvider: defaultProvider,
        transcriptionModel: defaultTranscriptionModel,
        localTranscriptionModel: defaultLocalTranscriptionModel,
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
