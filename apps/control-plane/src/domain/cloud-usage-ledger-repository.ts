import type { SummaryProvider } from './summary-provider.js';
import type { TranscriptionProvider } from './transcription-provider.js';

import { isDeepStrictEqual } from 'node:util';

export type CloudUsageStage = 'transcription' | 'punctuation' | 'summary';
export type CloudUsageEntryType = 'estimate' | 'actual';
export type CloudUsageUnit = 'usd' | 'audio-ms' | 'tokens';
export type CloudUsageProvider = TranscriptionProvider | SummaryProvider;
export type CloudUsagePricingStatus = 'priced' | 'unpriced';
export type ProviderRequestBillingClass = 'metered-api' | 'subscription' | 'self-hosted';
export type ProviderRequestStatus = 'started' | 'succeeded' | 'failed';
export type ProviderRequestPricingStatus =
  | 'pending'
  | 'priced'
  | 'unpriced'
  | 'not-applicable';

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

export type ProviderRequestAudit = {
  requestId: string;
  jobId: string;
  submitterId: string;
  quotaDayKey: string;
  stage: Extract<CloudUsageStage, 'transcription' | 'summary'>;
  provider: CloudUsageProvider;
  model: string;
  pricingVersion: string;
  leaseTokenHash: string;
  billingClass: ProviderRequestBillingClass;
  status: ProviderRequestStatus;
  providerRequestId?: string;
  httpStatus?: number;
  errorCode?: string;
  usageQuantity?: number;
  usageUnit?: Extract<CloudUsageUnit, 'audio-ms' | 'tokens'>;
  pricingStatus: ProviderRequestPricingStatus;
  knownCostUsd: number;
  costUsd: number | null;
  detail?: Record<string, unknown>;
  startedAt: string;
  finishedAt?: string;
};

export type ProviderRequestStartInput = Pick<
  ProviderRequestAudit,
  | 'requestId'
  | 'jobId'
  | 'submitterId'
  | 'quotaDayKey'
  | 'stage'
  | 'provider'
  | 'model'
  | 'pricingVersion'
  | 'leaseTokenHash'
  | 'billingClass'
  | 'startedAt'
  | 'detail'
>;

export type ProviderRequestFinishInput = Pick<
  ProviderRequestAudit,
  | 'requestId'
  | 'status'
  | 'providerRequestId'
  | 'httpStatus'
  | 'errorCode'
  | 'usageQuantity'
  | 'usageUnit'
  | 'pricingStatus'
  | 'knownCostUsd'
  | 'costUsd'
  | 'detail'
  | 'finishedAt'
> & {
  status: Extract<ProviderRequestStatus, 'succeeded' | 'failed'>;
  finishedAt: string;
};

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

export class ProviderRequestAuditConflictError extends Error {
  constructor(requestId: string) {
    super(`Provider request audit conflict: ${requestId}`);
    this.name = 'ProviderRequestAuditConflictError';
  }
}

const comparableProviderRequestStart = (
  request: ProviderRequestAudit | ProviderRequestStartInput
) => ({
  requestId: request.requestId,
  jobId: request.jobId,
  submitterId: request.submitterId,
  quotaDayKey: request.quotaDayKey,
  stage: request.stage,
  provider: request.provider,
  model: request.model,
  pricingVersion: request.pricingVersion,
  leaseTokenHash: request.leaseTokenHash,
  billingClass: request.billingClass,
  detail: request.detail ?? undefined
});

const comparableProviderRequestFinish = (
  request: ProviderRequestAudit | ProviderRequestFinishInput
) => ({
  requestId: request.requestId,
  status: request.status,
  providerRequestId: request.providerRequestId ?? undefined,
  httpStatus: request.httpStatus ?? undefined,
  errorCode: request.errorCode ?? undefined,
  usageQuantity: request.usageQuantity ?? undefined,
  usageUnit: request.usageUnit ?? undefined,
  pricingStatus: request.pricingStatus,
  knownCostUsd: request.knownCostUsd,
  costUsd: request.costUsd,
  detail: request.detail ?? undefined
});

export const isSameProviderRequestStart = (
  existing: ProviderRequestAudit,
  input: ProviderRequestStartInput
): boolean => isDeepStrictEqual(comparableProviderRequestStart(existing), comparableProviderRequestStart(input));

export const isSameProviderRequestFinish = (
  existing: ProviderRequestAudit,
  input: ProviderRequestFinishInput
): boolean =>
  existing.status !== 'started' &&
  isDeepStrictEqual(comparableProviderRequestFinish(existing), comparableProviderRequestFinish(input));

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
  listProviderRequestsByQuotaDayKey(quotaDayKey: string): Promise<ProviderRequestAudit[]>;
  startProviderRequest(input: ProviderRequestStartInput): Promise<ProviderRequestAudit>;
  finishProviderRequest(input: ProviderRequestFinishInput): Promise<ProviderRequestAudit>;
  getProviderRequest(requestId: string): Promise<ProviderRequestAudit | undefined>;
  listProviderRequestsByJob(jobId: string): Promise<ProviderRequestAudit[]>;
  listProviderRequestsBySubmitterAndDay(
    submitterId: string,
    quotaDayKey: string
  ): Promise<ProviderRequestAudit[]>;
  listRecentProviderRequests(limit: number): Promise<ProviderRequestAudit[]>;
  summarizeActualCostByJobIds(jobIds: string[]): Promise<Record<string, CloudUsageCostSummary>>;
}
