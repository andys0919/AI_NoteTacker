import type { CloudUsageLedgerEntry } from './cloud-usage-ledger-repository.js';
import type { RecordingJob } from './recording-job.js';
import type { TranscriptionProviderSetting } from './transcription-provider-settings-repository.js';
import { isCloudSummaryProvider } from './summary-provider.js';
import type { TranscriptionProvider } from './transcription-provider.js';
import { isCloudTranscriptionProvider } from './transcription-provider.js';

const AZURE_DEFAULT_TRANSCRIPTION_RESERVATION_ESTIMATE_USD_PER_MINUTE = 0.006;
const AZURE_GPT_4O_MINI_TRANSCRIBE_RESERVATION_ESTIMATE_USD_PER_MINUTE = 0.003;
const DEFAULT_UPLOADED_AUDIO_TRANSCRIPTION_ESTIMATE_MINUTES = 30;
const DEFAULT_CLOUD_SUMMARY_ESTIMATE_USD = 0.02;

type AzureResponsesPricingProvenance = {
  baseModel: string;
  modelVersion: string;
  currency: 'USD';
  effectiveDate: string;
  meterSource: string;
} & (
  | { sku: string; serviceTier?: never }
  | { sku?: never; serviceTier: string }
);

export type AzureResponsesPricing = AzureResponsesPricingProvenance & {
  model: string;
  pricingVersion: string;
  inputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type AzureResponsesPricingCatalog = readonly AzureResponsesPricing[];

export type CloudUsagePricingResult =
  | { costUsd: number; pricingStatus: 'priced' }
  | { costUsd: null; pricingStatus: 'unpriced' };

export const AZURE_RESPONSES_PRICING_CATALOG: AzureResponsesPricingCatalog = [];

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const isValidIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const isValidRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const hasAuthoritativePricingProvenance = (
  pricing: AzureResponsesPricing
): boolean => {
  const hasSku = isNonEmptyString(pricing.sku);
  const hasServiceTier = isNonEmptyString(pricing.serviceTier);

  return (
    isNonEmptyString(pricing.model) &&
    isNonEmptyString(pricing.pricingVersion) &&
    isNonEmptyString(pricing.baseModel) &&
    isNonEmptyString(pricing.modelVersion) &&
    pricing.currency === 'USD' &&
    isValidIsoDate(pricing.effectiveDate) &&
    isNonEmptyString(pricing.meterSource) &&
    hasSku !== hasServiceTier &&
    isValidRate(pricing.inputUsdPerMillionTokens) &&
    isValidRate(pricing.cachedInputUsdPerMillionTokens) &&
    isValidRate(pricing.outputUsdPerMillionTokens)
  );
};

export const roundUsd = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export const buildQuotaDayKey = (
  date: Date,
  timeZone: string = process.env.CLOUD_QUOTA_TIMEZONE || process.env.TZ || 'UTC'
): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);

export const estimateCloudReservationUsd = (
  input: {
    inputSource: RecordingJob['inputSource'];
    transcriptionProvider?: RecordingJob['transcriptionProvider'];
    transcriptionModel?: RecordingJob['transcriptionModel'];
    summaryProvider?: RecordingJob['summaryProvider'];
  },
  policy: Pick<
    TranscriptionProviderSetting,
    'liveMeetingReservationCapUsd'
  >
): number => {
  const transcriptionEstimate = !input.transcriptionProvider
    ? 0
    : isCloudTranscriptionProvider(input.transcriptionProvider)
      ? input.inputSource === 'meeting-link'
        ? policy.liveMeetingReservationCapUsd
        : estimateAzureTranscriptionReservationCostUsd(
            DEFAULT_UPLOADED_AUDIO_TRANSCRIPTION_ESTIMATE_MINUTES * 60_000,
            {
              provider: input.transcriptionProvider,
              model: input.transcriptionModel
            }
          )
      : 0;
  const summaryEstimate =
    input.summaryProvider && isCloudSummaryProvider(input.summaryProvider)
      ? DEFAULT_CLOUD_SUMMARY_ESTIMATE_USD
      : 0;

  return roundUsd(transcriptionEstimate + summaryEstimate);
};

export type ActualConsumedUsdSummary = {
  pricedCostUsd: number;
  totalCostUsd: number | null;
  hasUnpricedUsage: boolean;
};

export const sumActualConsumedUsd = (
  entries: CloudUsageLedgerEntry[],
  submitterId: string,
  quotaDayKey: string
): ActualConsumedUsdSummary => {
  const actualEntries = entries.filter(
    (entry) =>
      entry.submitterId === submitterId &&
      entry.quotaDayKey === quotaDayKey &&
      entry.entryType === 'actual'
  );
  const hasUnpricedUsage = actualEntries.some(
    (entry) => entry.pricingStatus === 'unpriced'
  );
  const pricedCostUsd = roundUsd(
    actualEntries.reduce(
      (total, entry) =>
        total + (entry.pricingStatus === 'priced' ? entry.costUsd : 0),
      0
    )
  );

  return {
    pricedCostUsd,
    totalCostUsd: hasUnpricedUsage ? null : pricedCostUsd,
    hasUnpricedUsage
  };
};

export const sumReservedUsd = (
  jobs: RecordingJob[],
  submitterId: string,
  quotaDayKey: string
): number =>
  roundUsd(
    jobs
      .filter(
        (job) =>
          job.submitterId === submitterId &&
          job.quotaDayKey === quotaDayKey &&
          job.state !== 'completed' &&
          job.state !== 'failed'
      )
      .reduce((total, job) => total + (job.reservedCloudQuotaUsd ?? 0), 0)
  );

export const calculateRemainingCloudQuotaUsd = (input: {
  dailyQuotaUsd: number;
  consumedUsd: number;
  reservedUsd: number;
}): number => roundUsd(input.dailyQuotaUsd - input.consumedUsd - input.reservedUsd);

export const calculateAzureResponsesCost = (input: {
  model: string;
  pricingVersion: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  reasoningOutputTokens?: number;
}, catalog: AzureResponsesPricingCatalog = AZURE_RESPONSES_PRICING_CATALOG): CloudUsagePricingResult => {
  const pricing = catalog.find(
    (candidate) =>
      candidate.model === input.model &&
      candidate.pricingVersion === input.pricingVersion &&
      hasAuthoritativePricingProvenance(candidate)
  );

  if (!pricing) {
    return { costUsd: null, pricingStatus: 'unpriced' };
  }

  const cachedInputTokens = input.cachedInputTokens ?? 0;
  const uncachedInputTokens = input.inputTokens - cachedInputTokens;

  return {
    costUsd: roundUsd(
      (uncachedInputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens +
        (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPerMillionTokens +
        (input.outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens
    ),
    pricingStatus: 'priced'
  };
};

export const calculateAzureTranscriptionActualCost = (_usage: {
  audioMs: number;
}): CloudUsagePricingResult => ({ costUsd: null, pricingStatus: 'unpriced' });

const resolveAzureTranscriptionReservationUsdPerMinute = (input: {
  provider?: TranscriptionProvider;
  model?: string;
}): number => {
  if (input.model === 'gpt-4o-mini-transcribe') {
    return AZURE_GPT_4O_MINI_TRANSCRIBE_RESERVATION_ESTIMATE_USD_PER_MINUTE;
  }

  return AZURE_DEFAULT_TRANSCRIPTION_RESERVATION_ESTIMATE_USD_PER_MINUTE;
};

export const estimateAzureTranscriptionReservationCostUsd = (
  audioMs: number,
  input: {
    provider?: TranscriptionProvider;
    model?: string;
  } = {}
): number =>
  roundUsd((audioMs / 60_000) * resolveAzureTranscriptionReservationUsdPerMinute(input));
