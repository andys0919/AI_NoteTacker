import type {
  CloudUsageCostSummary,
  CloudUsageLedgerEntry,
  ProviderRequestAudit
} from './cloud-usage-ledger-repository.js';
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
  cacheWriteUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens: number;
};

export type AzureResponsesPricingCatalog = readonly AzureResponsesPricing[];

export type CloudUsagePricingResult =
  | { costUsd: number; pricingStatus: 'priced' }
  | { costUsd: null; pricingStatus: 'unpriced' };

export const AZURE_RESPONSES_PRICING_CATALOG: AzureResponsesPricing[] = [
  {
    model: 'gpt-5.6-luna',
    pricingVersion: 'v1',
    baseModel: 'gpt-5.6-luna',
    modelVersion: '2026-07-09',
    sku: 'GlobalStandard',
    currency: 'USD',
    effectiveDate: '2026-07-01',
    meterSource:
      'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&currencyCode=USD&$filter=productName%20eq%20%27Azure%20OpenAI%20GPT5%27%20and%20priceType%20eq%20%27Consumption%27%20and%20contains(skuName,%20%275.6%20luna%20ShortCo%27)%20and%20contains(skuName,%20%27Std%20Gl%27)',
    inputUsdPerMillionTokens: 1,
    cachedInputUsdPerMillionTokens: 0.1,
    cacheWriteUsdPerMillionTokens: 1.25,
    outputUsdPerMillionTokens: 6
  }
];

export type AzureRetailPricingSnapshot = {
  mai: {
    effectiveDate: string;
    meterSource: string;
    usdPerHour: number;
  };
  twd: {
    effectiveDate: string;
    meterSource: string;
    twdPerHour: number;
    usdToTwdRate: number;
    verifiedAt: string;
  };
};

let azureSpeechMaiPricing = {
  effectiveDate: '2024-11-01',
  meterSource:
    'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&currencyCode=USD&$filter=meterId%20eq%20%27e366297b-9194-5c2f-91f9-2b6472d890b3%27%20and%20armRegionName%20eq%20%27southeastasia%27',
  usdPerHour: 0.36
};

let azureTwdPricing = {
  effectiveDate: '2024-11-01',
  meterSource:
    'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&currencyCode=TWD&$filter=meterId%20eq%20%27e366297b-9194-5c2f-91f9-2b6472d890b3%27%20and%20armRegionName%20eq%20%27southeastasia%27',
  twdPerHour: 11.4903,
  usdToTwdRate: 31.9175,
  verifiedAt: '2026-07-31T00:00:00.000Z'
};

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
    (pricing.cacheWriteUsdPerMillionTokens === undefined ||
      isValidRate(pricing.cacheWriteUsdPerMillionTokens)) &&
    isValidRate(pricing.outputUsdPerMillionTokens)
  );
};

export const getAzureRetailPricingSnapshot = (): AzureRetailPricingSnapshot => {
  return {
    mai: { ...azureSpeechMaiPricing },
    twd: { ...azureTwdPricing }
  };
};

export const applyAzureRetailPricingSnapshot = (
  snapshot: AzureRetailPricingSnapshot
): void => {
  if (
    !isValidIsoDate(snapshot.mai.effectiveDate) ||
    !isNonEmptyString(snapshot.mai.meterSource) ||
    !isValidRate(snapshot.mai.usdPerHour) ||
    !isValidIsoDate(snapshot.twd.effectiveDate) ||
    !isNonEmptyString(snapshot.twd.meterSource) ||
    !isValidRate(snapshot.twd.twdPerHour) ||
    !isValidRate(snapshot.twd.usdToTwdRate) ||
    snapshot.twd.usdToTwdRate === 0 ||
    typeof snapshot.twd.verifiedAt !== 'string' ||
    Number.isNaN(Date.parse(snapshot.twd.verifiedAt)) ||
    snapshot.mai.effectiveDate < azureSpeechMaiPricing.effectiveDate ||
    snapshot.twd.effectiveDate < azureTwdPricing.effectiveDate
  ) {
    throw new Error('Azure retail pricing snapshot is invalid');
  }

  azureSpeechMaiPricing = { ...snapshot.mai };
  azureTwdPricing = { ...snapshot.twd };
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
  quotaDayKey: string,
  providerRequests: ProviderRequestAudit[] = []
): ActualConsumedUsdSummary => {
  const actualEntries = entries.filter(
    (entry) =>
      entry.submitterId === submitterId &&
      entry.quotaDayKey === quotaDayKey &&
      entry.entryType === 'actual'
  );
  const resolvedEntries = actualEntries.map(resolveCloudUsageEntryCost);
  const meteredRequests = providerRequests.filter(
    (request) =>
      request.submitterId === submitterId &&
      request.quotaDayKey === quotaDayKey &&
      request.billingClass === 'metered-api'
  );
  const hasUnpricedUsage =
    resolvedEntries.some((entry) => entry.hasUnpricedUsage) ||
    meteredRequests.some((request) => request.pricingStatus !== 'priced');
  const pricedCostUsd = roundUsd(
    resolvedEntries.reduce((total, entry) => total + entry.knownCostUsd, 0) +
      meteredRequests.reduce((total, request) => total + request.knownCostUsd, 0)
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
  cacheWriteTokens?: number;
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
  const cacheWriteTokens = input.cacheWriteTokens;
  if (
    ![input.inputTokens, cachedInputTokens, input.outputTokens]
      .every((value) => Number.isInteger(value) && value >= 0) ||
    cachedInputTokens > input.inputTokens ||
    (cacheWriteTokens !== undefined &&
      (!Number.isInteger(cacheWriteTokens) ||
        cacheWriteTokens < 0 ||
        cachedInputTokens + cacheWriteTokens > input.inputTokens))
  ) {
    return { costUsd: null, pricingStatus: 'unpriced' };
  }
  if (
    pricing.cacheWriteUsdPerMillionTokens !== undefined &&
    cacheWriteTokens === undefined
  ) {
    return { costUsd: null, pricingStatus: 'unpriced' };
  }

  const uncachedInputTokens =
    input.inputTokens - cachedInputTokens - (cacheWriteTokens ?? 0);

  return {
    costUsd: roundUsd(
      (uncachedInputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens +
        (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPerMillionTokens +
        ((cacheWriteTokens ?? 0) / 1_000_000) *
          (pricing.cacheWriteUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens) +
        (input.outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens
    ),
    pricingStatus: 'priced'
  };
};

export const calculateAzureResponsesKnownCost = (input: {
  model: string;
  pricingVersion: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
}): number | null => {
  const pricing = AZURE_RESPONSES_PRICING_CATALOG.find(
    (candidate) =>
      candidate.model === input.model &&
      candidate.pricingVersion === input.pricingVersion &&
      hasAuthoritativePricingProvenance(candidate)
  );
  const cachedInputTokens = input.cachedInputTokens ?? 0;

  if (
    !pricing ||
    ![input.inputTokens, cachedInputTokens, input.outputTokens].every(
      (value) => Number.isInteger(value) && value >= 0
    ) ||
    cachedInputTokens > input.inputTokens
  ) {
    return null;
  }

  return roundUsd(
    ((input.inputTokens - cachedInputTokens) / 1_000_000) *
      pricing.inputUsdPerMillionTokens +
      (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPerMillionTokens +
      (input.outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens
  );
};

export const calculateAzureTranscriptionActualCost = (usage: {
  audioMs: number;
  provider?: TranscriptionProvider;
  model?: string;
  pricingVersion?: string;
}): CloudUsagePricingResult =>
  usage.provider === 'azure-speech-mai-transcribe-1.5' &&
  usage.model === 'mai-transcribe-1.5' &&
  usage.pricingVersion === 'v1' &&
  Number.isFinite(usage.audioMs) &&
  usage.audioMs >= 0
    ? {
        costUsd: roundUsd(
          (usage.audioMs / 3_600_000) * azureSpeechMaiPricing.usdPerHour
        ),
        pricingStatus: 'priced'
      }
    : { costUsd: null, pricingStatus: 'unpriced' };

const readUsageInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

const readFirstUsageInteger = (
  detail: Record<string, unknown>,
  ...keys: string[]
): number | undefined => {
  for (const key of keys) {
    const value = readUsageInteger(detail[key]);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

export type ResolvedCloudUsageEntryCost = {
  knownCostUsd: number;
  hasUnpricedUsage: boolean;
};

export const resolveCloudUsageEntryCost = (
  entry: CloudUsageLedgerEntry
): ResolvedCloudUsageEntryCost => {
  const detail = entry.detail ?? {};
  if (
    entry.provider === 'azure-speech-mai-transcribe-1.5' &&
    entry.model === 'mai-transcribe-1.5'
  ) {
    const billedAudioMs = readUsageInteger(detail.billedAudioMs);
    const audioMs =
      billedAudioMs ??
      readUsageInteger(detail.audioMs) ??
      (entry.usageUnit === 'audio-ms' ? Number(entry.usageQuantity) : undefined);
    const providerRequestCount = readUsageInteger(detail.providerRequestCount);
    const unmeteredRequestCount = readUsageInteger(detail.unmeteredRequestCount);
    const pricing =
      audioMs === undefined
        ? { costUsd: null, pricingStatus: 'unpriced' as const }
        : calculateAzureTranscriptionActualCost({
            provider: entry.provider,
            model: entry.model,
            pricingVersion: entry.pricingVersion,
            audioMs
          });

    return {
      knownCostUsd: pricing.pricingStatus === 'priced' ? pricing.costUsd : 0,
      hasUnpricedUsage:
        pricing.pricingStatus === 'unpriced' ||
        billedAudioMs === undefined ||
        providerRequestCount === undefined ||
        unmeteredRequestCount !== 0
    };
  }

  if (entry.pricingStatus === 'priced') {
    return { knownCostUsd: roundUsd(entry.costUsd), hasUnpricedUsage: false };
  }

  if (entry.provider !== 'azure-openai' || entry.usageUnit !== 'tokens') {
    return { knownCostUsd: 0, hasUnpricedUsage: true };
  }

  const inputTokens = readFirstUsageInteger(detail, 'promptTokens', 'inputTokens');
  const cachedInputTokens = readFirstUsageInteger(
    detail,
    'cachedPromptTokens',
    'cachedInputTokens'
  );
  const cacheWriteTokens = readFirstUsageInteger(
    detail,
    'cacheWritePromptTokens',
    'cacheWriteTokens'
  );
  const outputTokens = readFirstUsageInteger(detail, 'completionTokens', 'outputTokens');
  const totalTokens = readUsageInteger(detail.totalTokens);
  const unmeteredRequestCount = readUsageInteger(detail.unmeteredRequestCount);
  if (
    inputTokens === undefined ||
    cachedInputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens !== inputTokens + outputTokens
  ) {
    return { knownCostUsd: 0, hasUnpricedUsage: true };
  }

  const knownCostUsd = calculateAzureResponsesKnownCost({
    model: entry.model,
    pricingVersion: entry.pricingVersion,
    inputTokens,
    cachedInputTokens,
    outputTokens
  });
  const exactPricing = calculateAzureResponsesCost({
    model: entry.model,
    pricingVersion: entry.pricingVersion,
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens
  });

  return {
    knownCostUsd:
      exactPricing.pricingStatus === 'priced' ? exactPricing.costUsd : (knownCostUsd ?? 0),
    hasUnpricedUsage:
      exactPricing.pricingStatus === 'unpriced' || unmeteredRequestCount !== 0
  };
};

export const summarizeActualCostsByJobIds = (
  entries: CloudUsageLedgerEntry[],
  jobIds: string[],
  providerRequests: ProviderRequestAudit[] = []
): Record<string, CloudUsageCostSummary> => {
  const summaries: Record<string, CloudUsageCostSummary> = {};
  const jobIdSet = new Set(jobIds);

  for (const entry of entries) {
    if (entry.entryType !== 'actual' || !jobIdSet.has(entry.jobId)) {
      continue;
    }

    const current = summaries[entry.jobId] ?? {
      actualTranscriptionCostUsd: 0,
      hasUnpricedTranscriptionUsage: false,
      actualPunctuationCostUsd: 0,
      hasUnpricedPunctuationUsage: false,
      actualSummaryCostUsd: 0,
      hasUnpricedSummaryUsage: false,
      actualCloudCostUsd: 0,
      hasUnpricedUsage: false
    };
    const resolved = resolveCloudUsageEntryCost(entry);

    if (entry.stage === 'transcription') {
      current.actualTranscriptionCostUsd = roundUsd(
        current.actualTranscriptionCostUsd + resolved.knownCostUsd
      );
      current.hasUnpricedTranscriptionUsage ||= resolved.hasUnpricedUsage;
    } else if (entry.stage === 'punctuation') {
      current.actualPunctuationCostUsd = roundUsd(
        current.actualPunctuationCostUsd + resolved.knownCostUsd
      );
      current.hasUnpricedPunctuationUsage ||= resolved.hasUnpricedUsage;
    } else {
      current.actualSummaryCostUsd = roundUsd(
        current.actualSummaryCostUsd + resolved.knownCostUsd
      );
      current.hasUnpricedSummaryUsage ||= resolved.hasUnpricedUsage;
    }

    current.hasUnpricedUsage =
      current.hasUnpricedTranscriptionUsage ||
      current.hasUnpricedPunctuationUsage ||
      current.hasUnpricedSummaryUsage;
    current.actualCloudCostUsd = current.hasUnpricedUsage
      ? null
      : roundUsd(
          current.actualTranscriptionCostUsd +
            current.actualPunctuationCostUsd +
            current.actualSummaryCostUsd
        );
    summaries[entry.jobId] = current;
  }

  for (const request of providerRequests) {
    if (request.billingClass !== 'metered-api' || !jobIdSet.has(request.jobId)) {
      continue;
    }

    const current = summaries[request.jobId] ?? {
      actualTranscriptionCostUsd: 0,
      hasUnpricedTranscriptionUsage: false,
      actualPunctuationCostUsd: 0,
      hasUnpricedPunctuationUsage: false,
      actualSummaryCostUsd: 0,
      hasUnpricedSummaryUsage: false,
      actualCloudCostUsd: 0,
      hasUnpricedUsage: false
    };
    const unpriced = request.pricingStatus !== 'priced';

    if (request.stage === 'transcription') {
      current.actualTranscriptionCostUsd = roundUsd(
        current.actualTranscriptionCostUsd + request.knownCostUsd
      );
      current.hasUnpricedTranscriptionUsage ||= unpriced;
    } else {
      current.actualSummaryCostUsd = roundUsd(
        current.actualSummaryCostUsd + request.knownCostUsd
      );
      current.hasUnpricedSummaryUsage ||= unpriced;
    }

    current.hasUnpricedUsage =
      current.hasUnpricedTranscriptionUsage ||
      current.hasUnpricedPunctuationUsage ||
      current.hasUnpricedSummaryUsage;
    current.actualCloudCostUsd = current.hasUnpricedUsage
      ? null
      : roundUsd(
          current.actualTranscriptionCostUsd +
            current.actualPunctuationCostUsd +
            current.actualSummaryCostUsd
        );
    summaries[request.jobId] = current;
  }

  return summaries;
};

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
