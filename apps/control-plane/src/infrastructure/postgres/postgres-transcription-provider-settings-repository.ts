import type {
  ConcurrencyPools,
  TranscriptionProviderSetting,
  TranscriptionProviderSettingsRepository
} from '../../domain/transcription-provider-settings-repository.js';
import type { SummaryProvider } from '../../domain/summary-provider.js';
import type { TranscriptionProvider } from '../../domain/transcription-provider.js';

type Queryable = {
  query: <TRow extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
};

type PolicySettingsRow = {
  singleton_key: string;
  transcription_provider: TranscriptionProvider;
  transcription_model: string | null;
  summary_provider: SummaryProvider | null;
  summary_model: string | null;
  pricing_version: string | null;
  default_daily_cloud_quota_usd: number | string | null;
  live_meeting_reservation_cap_usd: number | string | null;
  local_transcription_concurrency: number | null;
  cloud_transcription_concurrency: number | null;
  local_summary_concurrency: number | null;
  cloud_summary_concurrency: number | null;
  updated_at: Date | string;
  updated_by: string | null;
};

type LegacySettingsRow = {
  provider: TranscriptionProvider;
  summary_model: string | null;
  updated_at: Date | string;
  updated_by: string | null;
};

const schemaSql = `
  CREATE TABLE IF NOT EXISTS ai_processing_policy_settings (
    singleton_key TEXT PRIMARY KEY,
    transcription_provider TEXT NOT NULL,
    transcription_model TEXT,
    summary_provider TEXT,
    summary_model TEXT,
    pricing_version TEXT,
    default_daily_cloud_quota_usd NUMERIC(12, 6),
    live_meeting_reservation_cap_usd NUMERIC(12, 6),
    local_transcription_concurrency INTEGER,
    cloud_transcription_concurrency INTEGER,
    local_summary_concurrency INTEGER,
    cloud_summary_concurrency INTEGER,
    updated_at TIMESTAMPTZ NOT NULL,
    updated_by TEXT
  );
`;

const now = (): string => new Date().toISOString();

const toNumber = (value: number | string | null | undefined, fallback: number): number => {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
};

const cloneConcurrencyPools = (input: ConcurrencyPools): ConcurrencyPools => ({
  localTranscription: input.localTranscription,
  cloudTranscription: input.cloudTranscription,
  localSummary: input.localSummary,
  cloudSummary: input.cloudSummary
});

export const ensureTranscriptionProviderSettingsSchema = async (
  database: Queryable
): Promise<void> => {
  await database.query(schemaSql);
};

export class PostgresTranscriptionProviderSettingsRepository
  implements TranscriptionProviderSettingsRepository
{
  private readonly singletonKey = 'global';
  private readonly defaults: {
    transcriptionProvider: TranscriptionProvider;
    transcriptionModel: string;
    localTranscriptionModel: string;
    cloudTranscriptionModel: string;
    summaryProvider: SummaryProvider;
    summaryModel: string;
    pricingVersion: string;
    defaultDailyCloudQuotaUsd: number;
    liveMeetingReservationCapUsd: number;
    concurrencyPools: ConcurrencyPools;
  };

  constructor(
    private readonly database: Queryable,
    defaultsOrProvider:
      | {
          transcriptionProvider: TranscriptionProvider;
          transcriptionModel: string;
          localTranscriptionModel?: string;
          cloudTranscriptionModel?: string;
          summaryProvider: SummaryProvider;
          summaryModel: string;
          pricingVersion: string;
          defaultDailyCloudQuotaUsd: number;
          liveMeetingReservationCapUsd: number;
          concurrencyPools: ConcurrencyPools;
        }
      | TranscriptionProvider,
    legacyDefaultSummaryModel = 'gpt-5.4-mini'
  ) {
    if (typeof defaultsOrProvider === 'string') {
      this.defaults = {
        transcriptionProvider: defaultsOrProvider,
        transcriptionModel: 'large-v3',
        localTranscriptionModel: 'large-v3',
        cloudTranscriptionModel: 'gpt-4o-mini-transcribe',
        summaryProvider: 'local-codex',
        summaryModel: legacyDefaultSummaryModel,
        pricingVersion: 'v1',
        defaultDailyCloudQuotaUsd: 5,
        liveMeetingReservationCapUsd: 1.5,
        concurrencyPools: {
          localTranscription: 1,
          cloudTranscription: 1,
          localSummary: 1,
          cloudSummary: 1
        }
      };
      return;
    }

    this.defaults = {
      ...defaultsOrProvider,
      localTranscriptionModel:
        defaultsOrProvider.localTranscriptionModel ?? defaultsOrProvider.transcriptionModel,
      cloudTranscriptionModel:
        defaultsOrProvider.cloudTranscriptionModel ?? 'gpt-4o-mini-transcribe'
    };
  }

  private resolveDefaultTranscriptionModelForProvider(provider: TranscriptionProvider): string {
    return provider === 'azure-openai-gpt-4o-mini-transcribe'
      ? this.defaults.cloudTranscriptionModel
      : this.defaults.localTranscriptionModel;
  }

  private normalizeTranscriptionModel(
    provider: TranscriptionProvider,
    model: string | null | undefined
  ): string {
    if (!model) {
      return this.resolveDefaultTranscriptionModelForProvider(provider);
    }

    if (
      provider === 'azure-openai-gpt-4o-mini-transcribe' &&
      model === this.defaults.localTranscriptionModel &&
      this.defaults.cloudTranscriptionModel !== this.defaults.localTranscriptionModel
    ) {
      return this.defaults.cloudTranscriptionModel;
    }

    if (
      provider === 'self-hosted-whisper' &&
      model === this.defaults.cloudTranscriptionModel &&
      this.defaults.cloudTranscriptionModel !== this.defaults.localTranscriptionModel
    ) {
      return this.defaults.localTranscriptionModel;
    }

    return model;
  }

  private mapRow(row: PolicySettingsRow): TranscriptionProviderSetting {
    const concurrencyPools: ConcurrencyPools = {
      localTranscription:
        row.local_transcription_concurrency ?? this.defaults.concurrencyPools.localTranscription,
      cloudTranscription:
        row.cloud_transcription_concurrency ?? this.defaults.concurrencyPools.cloudTranscription,
      localSummary: row.local_summary_concurrency ?? this.defaults.concurrencyPools.localSummary,
      cloudSummary: row.cloud_summary_concurrency ?? this.defaults.concurrencyPools.cloudSummary
    };

    return {
      provider: row.transcription_provider,
      transcriptionProvider: row.transcription_provider,
      transcriptionModel: this.normalizeTranscriptionModel(
        row.transcription_provider,
        row.transcription_model
      ),
      summaryProvider: row.summary_provider ?? this.defaults.summaryProvider,
      summaryModel: row.summary_model ?? this.defaults.summaryModel,
      pricingVersion: row.pricing_version ?? this.defaults.pricingVersion,
      defaultDailyCloudQuotaUsd: toNumber(
        row.default_daily_cloud_quota_usd,
        this.defaults.defaultDailyCloudQuotaUsd
      ),
      liveMeetingReservationCapUsd: toNumber(
        row.live_meeting_reservation_cap_usd,
        this.defaults.liveMeetingReservationCapUsd
      ),
      concurrencyPools,
      updatedAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at).toISOString(),
      updatedBy: row.updated_by ?? undefined
    };
  }

  private async upsertCurrent(input: {
    transcriptionProvider: TranscriptionProvider;
    transcriptionModel: string;
    summaryProvider: SummaryProvider;
    summaryModel: string;
    pricingVersion: string;
    defaultDailyCloudQuotaUsd: number;
    liveMeetingReservationCapUsd: number;
    concurrencyPools: ConcurrencyPools;
    updatedBy?: string;
  }): Promise<TranscriptionProviderSetting> {
    const result = await this.database.query<PolicySettingsRow>(
      `
        INSERT INTO ai_processing_policy_settings (
          singleton_key,
          transcription_provider,
          transcription_model,
          summary_provider,
          summary_model,
          pricing_version,
          default_daily_cloud_quota_usd,
          live_meeting_reservation_cap_usd,
          local_transcription_concurrency,
          cloud_transcription_concurrency,
          local_summary_concurrency,
          cloud_summary_concurrency,
          updated_at,
          updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14)
        ON CONFLICT (singleton_key) DO UPDATE SET
          transcription_provider = EXCLUDED.transcription_provider,
          transcription_model = EXCLUDED.transcription_model,
          summary_provider = EXCLUDED.summary_provider,
          summary_model = EXCLUDED.summary_model,
          pricing_version = EXCLUDED.pricing_version,
          default_daily_cloud_quota_usd = EXCLUDED.default_daily_cloud_quota_usd,
          live_meeting_reservation_cap_usd = EXCLUDED.live_meeting_reservation_cap_usd,
          local_transcription_concurrency = EXCLUDED.local_transcription_concurrency,
          cloud_transcription_concurrency = EXCLUDED.cloud_transcription_concurrency,
          local_summary_concurrency = EXCLUDED.local_summary_concurrency,
          cloud_summary_concurrency = EXCLUDED.cloud_summary_concurrency,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by
        RETURNING *
      `,
      [
        this.singletonKey,
        input.transcriptionProvider,
        input.transcriptionModel,
        input.summaryProvider,
        input.summaryModel,
        input.pricingVersion,
        input.defaultDailyCloudQuotaUsd,
        input.liveMeetingReservationCapUsd,
        input.concurrencyPools.localTranscription,
        input.concurrencyPools.cloudTranscription,
        input.concurrencyPools.localSummary,
        input.concurrencyPools.cloudSummary,
        now(),
        input.updatedBy ?? null
      ]
    );

    return this.mapRow(result.rows[0]);
  }

  private async getLegacyCurrent(): Promise<LegacySettingsRow | undefined> {
    try {
      const result = await this.database.query<LegacySettingsRow>(
        `
          SELECT provider, summary_model, updated_at, updated_by
          FROM transcription_provider_settings
          WHERE singleton_key = $1
        `,
        [this.singletonKey]
      );

      return result.rows[0];
    } catch {
      return undefined;
    }
  }

  async getCurrent(): Promise<TranscriptionProviderSetting> {
    const result = await this.database.query<PolicySettingsRow>(
      `
        SELECT *
        FROM ai_processing_policy_settings
        WHERE singleton_key = $1
      `,
      [this.singletonKey]
    );

    if (result.rows.length > 0) {
      const normalizedModel = this.normalizeTranscriptionModel(
        result.rows[0].transcription_provider,
        result.rows[0].transcription_model
      );

      if (normalizedModel !== (result.rows[0].transcription_model ?? null)) {
        return await this.upsertCurrent({
          transcriptionProvider: result.rows[0].transcription_provider,
          transcriptionModel: normalizedModel,
          summaryProvider: result.rows[0].summary_provider ?? this.defaults.summaryProvider,
          summaryModel: result.rows[0].summary_model ?? this.defaults.summaryModel,
          pricingVersion: result.rows[0].pricing_version ?? this.defaults.pricingVersion,
          defaultDailyCloudQuotaUsd: toNumber(
            result.rows[0].default_daily_cloud_quota_usd,
            this.defaults.defaultDailyCloudQuotaUsd
          ),
          liveMeetingReservationCapUsd: toNumber(
            result.rows[0].live_meeting_reservation_cap_usd,
            this.defaults.liveMeetingReservationCapUsd
          ),
          concurrencyPools: {
            localTranscription:
              result.rows[0].local_transcription_concurrency ??
              this.defaults.concurrencyPools.localTranscription,
            cloudTranscription:
              result.rows[0].cloud_transcription_concurrency ??
              this.defaults.concurrencyPools.cloudTranscription,
            localSummary:
              result.rows[0].local_summary_concurrency ??
              this.defaults.concurrencyPools.localSummary,
            cloudSummary:
              result.rows[0].cloud_summary_concurrency ??
              this.defaults.concurrencyPools.cloudSummary
          },
          updatedBy: result.rows[0].updated_by ?? undefined
        });
      }

      return this.mapRow(result.rows[0]);
    }

    const legacy = await this.getLegacyCurrent();

    if (legacy) {
      return await this.upsertCurrent({
        transcriptionProvider: legacy.provider,
        transcriptionModel: this.resolveDefaultTranscriptionModelForProvider(legacy.provider),
        summaryProvider: this.defaults.summaryProvider,
        summaryModel: legacy.summary_model ?? this.defaults.summaryModel,
        pricingVersion: this.defaults.pricingVersion,
        defaultDailyCloudQuotaUsd: this.defaults.defaultDailyCloudQuotaUsd,
        liveMeetingReservationCapUsd: this.defaults.liveMeetingReservationCapUsd,
        concurrencyPools: cloneConcurrencyPools(this.defaults.concurrencyPools),
        updatedBy: legacy.updated_by ?? undefined
      });
    }

    return await this.upsertCurrent({
      transcriptionProvider: this.defaults.transcriptionProvider,
      transcriptionModel: this.resolveDefaultTranscriptionModelForProvider(
        this.defaults.transcriptionProvider
      ),
      summaryProvider: this.defaults.summaryProvider,
      summaryModel: this.defaults.summaryModel,
      pricingVersion: this.defaults.pricingVersion,
      defaultDailyCloudQuotaUsd: this.defaults.defaultDailyCloudQuotaUsd,
      liveMeetingReservationCapUsd: this.defaults.liveMeetingReservationCapUsd,
      concurrencyPools: cloneConcurrencyPools(this.defaults.concurrencyPools)
    });
  }

  async setCurrent(input: {
    provider: TranscriptionProvider;
    updatedBy?: string;
  }): Promise<TranscriptionProviderSetting> {
    return await this.updatePolicy({
      transcriptionProvider: input.provider,
      updatedBy: input.updatedBy
    });
  }

  async setSummaryModel(input: {
    summaryModel: string;
    updatedBy?: string;
  }): Promise<TranscriptionProviderSetting> {
    return await this.updatePolicy({
      summaryModel: input.summaryModel,
      updatedBy: input.updatedBy
    });
  }

  async updatePolicy(input: {
    transcriptionProvider?: TranscriptionProvider;
    transcriptionModel?: string;
    summaryProvider?: SummaryProvider;
    summaryModel?: string;
    pricingVersion?: string;
    defaultDailyCloudQuotaUsd?: number;
    liveMeetingReservationCapUsd?: number;
    concurrencyPools?: ConcurrencyPools;
    updatedBy?: string;
  }): Promise<TranscriptionProviderSetting> {
    const current = await this.getCurrent();
    const nextProvider = input.transcriptionProvider ?? current.transcriptionProvider;
    const nextTranscriptionModel =
      input.transcriptionModel ??
      (nextProvider !== current.transcriptionProvider
        ? this.resolveDefaultTranscriptionModelForProvider(nextProvider)
        : current.transcriptionModel);

    return await this.upsertCurrent({
      transcriptionProvider: nextProvider,
      transcriptionModel: nextTranscriptionModel,
      summaryProvider: input.summaryProvider ?? current.summaryProvider,
      summaryModel: input.summaryModel ?? current.summaryModel,
      pricingVersion: input.pricingVersion ?? current.pricingVersion,
      defaultDailyCloudQuotaUsd:
        input.defaultDailyCloudQuotaUsd ?? current.defaultDailyCloudQuotaUsd,
      liveMeetingReservationCapUsd:
        input.liveMeetingReservationCapUsd ?? current.liveMeetingReservationCapUsd,
      concurrencyPools: cloneConcurrencyPools(input.concurrencyPools ?? current.concurrencyPools),
      updatedBy: input.updatedBy
    });
  }
}
