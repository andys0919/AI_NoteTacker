import type {
  ConcurrencyPools,
  TranscriptionProviderSetting,
  TranscriptionProviderSettingsRepository
} from '../domain/transcription-provider-settings-repository.js';
import {
  defaultSummaryProvider,
  type SummaryProvider
} from '../domain/summary-provider.js';
import type { TranscriptionProvider } from '../domain/transcription-provider.js';

const now = (): string => new Date().toISOString();

const cloneConcurrencyPools = (input: ConcurrencyPools): ConcurrencyPools => ({
  localTranscription: input.localTranscription,
  cloudTranscription: input.cloudTranscription,
  localSummary: input.localSummary,
  cloudSummary: input.cloudSummary
});

export class InMemoryTranscriptionProviderSettingsRepository
  implements TranscriptionProviderSettingsRepository
{
  private current: TranscriptionProviderSetting;
  private readonly localTranscriptionModel: string;
  private readonly qwenTranscriptionModel: string;
  private readonly maiTranscriptionModel: string;
  private readonly cloudTranscriptionModel: string;

  constructor(input: {
    defaultTranscriptionProvider: TranscriptionProvider;
    defaultTranscriptionModel: string;
    defaultLocalTranscriptionModel?: string;
    defaultQwenTranscriptionModel?: string;
    defaultMaiTranscriptionModel?: string;
    defaultCloudTranscriptionModel?: string;
    defaultSummaryProvider: SummaryProvider;
    defaultSummaryModel: string;
    defaultDailyCloudQuotaUsd: number;
    defaultLiveMeetingReservationCapUsd: number;
    defaultPricingVersion: string;
    defaultConcurrencyPools: ConcurrencyPools;
  }) {
    this.localTranscriptionModel =
      input.defaultLocalTranscriptionModel ?? input.defaultTranscriptionModel;
    this.qwenTranscriptionModel =
      input.defaultQwenTranscriptionModel ?? 'qwen3-asr-1.7b';
    this.maiTranscriptionModel =
      input.defaultMaiTranscriptionModel ?? 'mai-transcribe-1.5';
    this.cloudTranscriptionModel =
      input.defaultCloudTranscriptionModel ?? 'gpt-4o-transcribe';
    this.current = {
      provider: input.defaultTranscriptionProvider,
      transcriptionProvider: input.defaultTranscriptionProvider,
      transcriptionModel:
        input.defaultTranscriptionProvider === 'azure-openai-gpt-4o-transcribe'
          ? this.cloudTranscriptionModel
          : input.defaultTranscriptionProvider === 'azure-speech-mai-transcribe-1.5'
            ? this.maiTranscriptionModel
            : input.defaultTranscriptionProvider === 'qwen3-asr-1.7b'
              ? this.qwenTranscriptionModel
              : this.localTranscriptionModel,
      summaryProvider:
        input.defaultSummaryProvider === 'local-codex'
          ? input.defaultSummaryProvider
          : defaultSummaryProvider,
      summaryModel: input.defaultSummaryModel,
      pricingVersion: input.defaultPricingVersion,
      defaultDailyCloudQuotaUsd: input.defaultDailyCloudQuotaUsd,
      liveMeetingReservationCapUsd: input.defaultLiveMeetingReservationCapUsd,
      concurrencyPools: cloneConcurrencyPools(input.defaultConcurrencyPools),
      updatedAt: now()
    };
  }

  async getCurrent(): Promise<TranscriptionProviderSetting> {
    return {
      ...this.current,
      concurrencyPools: cloneConcurrencyPools(this.current.concurrencyPools)
    };
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
    const nextProvider = input.transcriptionProvider ?? this.current.transcriptionProvider;
    const nextTranscriptionModel =
      input.transcriptionModel ??
      (nextProvider !== this.current.transcriptionProvider
        ? nextProvider === 'azure-openai-gpt-4o-transcribe'
          ? this.cloudTranscriptionModel
          : nextProvider === 'azure-speech-mai-transcribe-1.5'
            ? this.maiTranscriptionModel
            : nextProvider === 'qwen3-asr-1.7b'
              ? this.qwenTranscriptionModel
              : this.localTranscriptionModel
        : this.current.transcriptionModel);
    const normalizedTranscriptionModel =
      nextProvider === 'azure-speech-mai-transcribe-1.5'
        ? this.maiTranscriptionModel
        : nextProvider === 'qwen3-asr-1.7b' &&
            [
              this.localTranscriptionModel,
              this.maiTranscriptionModel,
              this.cloudTranscriptionModel
            ].includes(nextTranscriptionModel)
          ? this.qwenTranscriptionModel
          : nextTranscriptionModel;

    this.current = {
      ...this.current,
      provider: nextProvider,
      transcriptionProvider: nextProvider,
      transcriptionModel: normalizedTranscriptionModel,
      summaryProvider:
        input.summaryProvider === undefined
          ? this.current.summaryProvider
          : input.summaryProvider === 'local-codex'
            ? input.summaryProvider
            : defaultSummaryProvider,
      summaryModel: input.summaryModel ?? this.current.summaryModel,
      pricingVersion: input.pricingVersion ?? this.current.pricingVersion,
      defaultDailyCloudQuotaUsd:
        input.defaultDailyCloudQuotaUsd ?? this.current.defaultDailyCloudQuotaUsd,
      liveMeetingReservationCapUsd:
        input.liveMeetingReservationCapUsd ?? this.current.liveMeetingReservationCapUsd,
      concurrencyPools: cloneConcurrencyPools(
        input.concurrencyPools ?? this.current.concurrencyPools
      ),
      updatedBy: input.updatedBy,
      updatedAt: now()
    };

    return await this.getCurrent();
  }
}
