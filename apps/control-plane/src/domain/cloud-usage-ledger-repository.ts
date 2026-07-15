import type { SummaryProvider } from './summary-provider.js';
import type { TranscriptionProvider } from './transcription-provider.js';

import { isDeepStrictEqual } from 'node:util';

export type CloudUsageStage = 'transcription' | 'punctuation' | 'summary';
export type CloudUsageEntryType = 'estimate' | 'actual';
export type CloudUsageUnit = 'usd' | 'audio-ms' | 'tokens';
export type CloudUsageProvider = TranscriptionProvider | SummaryProvider;
export type CloudUsagePricingStatus = 'priced' | 'unpriced';

type CloudUsageLedgerEntryBase = {
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
  createdAt: string;
  detail?: Record<string, unknown>;
};

export type CloudUsageLedgerEntry =
  | (CloudUsageLedgerEntryBase & {
      pricingStatus: 'priced';
      costUsd: number;
    })
  | (CloudUsageLedgerEntryBase & {
      pricingStatus: 'unpriced';
      costUsd: null;
    });

type WithoutPersistenceFields<T> = T extends unknown ? Omit<T, 'id' | 'createdAt'> : never;

export type CloudUsageLedgerEntryInput = WithoutPersistenceFields<CloudUsageLedgerEntry>;

export type CloudUsageCostSummary = {
  actualTranscriptionCostUsd: number;
  hasUnpricedTranscriptionUsage: boolean;
  actualPunctuationCostUsd: number;
  hasUnpricedPunctuationUsage: boolean;
  actualSummaryCostUsd: number;
  hasUnpricedSummaryUsage: boolean;
  actualCloudCostUsd: number | null;
  hasUnpricedUsage: boolean;
};

export class CloudUsageLedgerConflictError extends Error {
  constructor(entryKey: string) {
    super(`Cloud usage ledger entry key conflict: ${entryKey}`);
    this.name = 'CloudUsageLedgerConflictError';
  }
}

const comparablePayload = (entry: CloudUsageLedgerEntry | CloudUsageLedgerEntryInput) => ({
  entryKey: entry.entryKey ?? undefined,
  jobId: entry.jobId,
  submitterId: entry.submitterId,
  quotaDayKey: entry.quotaDayKey,
  entryType: entry.entryType,
  stage: entry.stage,
  provider: entry.provider,
  model: entry.model,
  pricingVersion: entry.pricingVersion,
  usageQuantity: entry.usageQuantity,
  usageUnit: entry.usageUnit,
  pricingStatus: entry.pricingStatus,
  costUsd: entry.costUsd,
  detail: entry.detail ?? undefined
});

export const isSameCloudUsageLedgerPayload = (
  existing: CloudUsageLedgerEntry,
  input: CloudUsageLedgerEntryInput
): boolean => isDeepStrictEqual(comparablePayload(existing), comparablePayload(input));

export interface CloudUsageLedgerRepository {
  append(input: CloudUsageLedgerEntryInput): Promise<CloudUsageLedgerEntry>;
  listByQuotaDayKey(quotaDayKey: string): Promise<CloudUsageLedgerEntry[]>;
  /**
   * Returns the most recent ledger entries across all days, newest first. Used
   * by the admin console to show the full historical usage / token report.
   */
  listRecentEntries(limit: number): Promise<CloudUsageLedgerEntry[]>;
  listBySubmitterAndDay(
    submitterId: string,
    quotaDayKey: string
  ): Promise<CloudUsageLedgerEntry[]>;
  listByJob(jobId: string): Promise<CloudUsageLedgerEntry[]>;
  summarizeActualCostByJobIds(jobIds: string[]): Promise<Record<string, CloudUsageCostSummary>>;
}
