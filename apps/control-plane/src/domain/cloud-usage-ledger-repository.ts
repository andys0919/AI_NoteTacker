import type { SummaryProvider } from './summary-provider.js';
import type { TranscriptionProvider } from './transcription-provider.js';

export type CloudUsageStage = 'transcription' | 'summary';
export type CloudUsageEntryType = 'estimate' | 'actual';
export type CloudUsageUnit = 'usd' | 'audio-ms' | 'tokens';
export type CloudUsageProvider = TranscriptionProvider | SummaryProvider;

export type CloudUsageLedgerEntry = {
  id: string;
  entryKey?: string;
  jobId: string;
  submitterId: string;
  quotaDayKey: string;
  entryType: CloudUsageEntryType;
  stage: CloudUsageStage;
  provider: CloudUsageProvider;
  model: string;
  pricingVersion: string;
  usageQuantity: number;
  usageUnit: CloudUsageUnit;
  costUsd: number;
  createdAt: string;
  detail?: Record<string, unknown>;
};

export type CloudUsageCostSummary = {
  actualTranscriptionCostUsd: number;
  actualSummaryCostUsd: number;
  actualCloudCostUsd: number;
};

export interface CloudUsageLedgerRepository {
  append(
    input: Omit<CloudUsageLedgerEntry, 'id' | 'createdAt'>
  ): Promise<CloudUsageLedgerEntry>;
  listByQuotaDayKey(quotaDayKey: string): Promise<CloudUsageLedgerEntry[]>;
  listBySubmitterAndDay(
    submitterId: string,
    quotaDayKey: string
  ): Promise<CloudUsageLedgerEntry[]>;
  listByJob(jobId: string): Promise<CloudUsageLedgerEntry[]>;
  summarizeActualCostByJobIds(jobIds: string[]): Promise<Record<string, CloudUsageCostSummary>>;
}
