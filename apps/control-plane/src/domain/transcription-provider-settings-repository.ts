import type { SummaryProvider } from './summary-provider.js';
import type { TranscriptionProvider } from './transcription-provider.js';

export type ConcurrencyPools = {
  localTranscription: number;
  cloudTranscription: number;
  localSummary: number;
  cloudSummary: number;
};

export type TranscriptionProviderSetting = {
  provider: TranscriptionProvider;
  transcriptionProvider: TranscriptionProvider;
  transcriptionModel: string;
  summaryProvider: SummaryProvider;
  summaryModel: string;
  pricingVersion: string;
  defaultDailyCloudQuotaUsd: number;
  liveMeetingReservationCapUsd: number;
  concurrencyPools: ConcurrencyPools;
  updatedAt: string;
  updatedBy?: string;
};

export interface TranscriptionProviderSettingsRepository {
  getCurrent(): Promise<TranscriptionProviderSetting>;
  setCurrent(input: {
    provider: TranscriptionProvider;
    updatedBy?: string;
  }): Promise<TranscriptionProviderSetting>;
  setSummaryModel(input: {
    summaryModel: string;
    updatedBy?: string;
  }): Promise<TranscriptionProviderSetting>;
  updatePolicy(input: {
    transcriptionProvider?: TranscriptionProvider;
    transcriptionModel?: string;
    summaryProvider?: SummaryProvider;
    summaryModel?: string;
    pricingVersion?: string;
    defaultDailyCloudQuotaUsd?: number;
    liveMeetingReservationCapUsd?: number;
    concurrencyPools?: ConcurrencyPools;
    updatedBy?: string;
  }): Promise<TranscriptionProviderSetting>;
}
