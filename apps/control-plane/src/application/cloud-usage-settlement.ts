import {
  calculateAzureResponsesCost,
  calculateAzureTranscriptionActualCost,
  isValidIsoDate
} from '../domain/cloud-usage.js';
import type {
  CloudUsageLedgerRepository,
  ProviderRequestAudit
} from '../domain/cloud-usage-ledger-repository.js';
import type { RecordingJob } from '../domain/recording-job.js';
import { isCloudSummaryProvider, type SummaryProvider } from '../domain/summary-provider.js';
import { isCloudTranscriptionProvider } from '../domain/transcription-provider.js';

type SettlementUsage = {
  audioMs?: number;
  billedAudioMs?: number;
  providerRequestCount?: number;
  unmeteredRequestCount?: number;
  punctuation?: {
    provider: 'azure-openai';
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens?: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    requestCount: number;
    acceptedChunkCount: number;
    fallbackChunkCount: number;
    unmeteredRequestCount: number;
  };
  diarization?: {
    provider: 'azure-openai';
    model: string;
    audioMs: number;
    requestCount: number;
    unmeteredRequestCount: number;
    failedChunkCount: number;
  };
  promptTokens?: number;
  cachedPromptTokens?: number;
  cacheWritePromptTokens?: number;
  completionTokens?: number;
  reasoningCompletionTokens?: number;
  totalTokens?: number;
};

export type CloudUsageSettlementEvent = {
  type: string;
  leaseToken?: string;
  actualProvider?: SummaryProvider;
  transcriptArtifact?: { language: string };
  summaryArtifact?: { model: string };
  usage?: SettlementUsage;
};

export class CloudUsageSettlementMetadataError extends Error {
  constructor(jobId: string) {
    super(`Cloud usage for job ${jobId} cannot be settled without quota and pricing identity.`);
    this.name = 'CloudUsageSettlementMetadataError';
  }
}

export const appendActualUsageFromEvent = async (input: {
  repository: CloudUsageLedgerRepository;
  job: RecordingJob;
  event: CloudUsageSettlementEvent;
  providerRequests?: ProviderRequestAudit[];
}): Promise<void> => {
  const { repository, job, event, providerRequests = [] } = input;
  const isTranscriptEvent =
    event.type === 'transcript-artifact-stored' || event.type === 'transcription-failed';
  const isSummaryEvent =
    event.type === 'summary-artifact-stored' || event.type === 'summary-failed';
  const actualSummaryProvider = isSummaryEvent
    ? (event.actualProvider ?? job.summaryProvider)
    : undefined;
  const hasTranscriptionUsage =
    isTranscriptEvent &&
    (event.usage?.audioMs !== undefined ||
      event.usage?.billedAudioMs !== undefined ||
      event.usage?.providerRequestCount !== undefined);
  const requiresSettlement =
    ((event.type === 'transcript-artifact-stored' ||
      (event.type === 'transcription-failed' && hasTranscriptionUsage)) &&
      job.transcriptionProvider !== undefined &&
      isCloudTranscriptionProvider(job.transcriptionProvider)) ||
    (isTranscriptEvent &&
      (event.usage?.punctuation !== undefined || event.usage?.diarization !== undefined)) ||
    (isSummaryEvent &&
      event.usage !== undefined &&
      actualSummaryProvider !== undefined &&
      isCloudSummaryProvider(actualSummaryProvider));

  if (
    !isValidIsoDate(job.quotaDayKey) ||
    typeof job.pricingVersion !== 'string' ||
    job.pricingVersion.trim().length === 0
  ) {
    if (requiresSettlement) {
      throw new CloudUsageSettlementMetadataError(job.id);
    }
    return;
  }

  if (
    (event.type === 'transcript-artifact-stored' ||
      (event.type === 'transcription-failed' && hasTranscriptionUsage)) &&
    job.transcriptionProvider &&
    isCloudTranscriptionProvider(job.transcriptionProvider) &&
    !providerRequests.some(
      (request) =>
        request.billingClass === 'metered-api' &&
        request.stage === 'transcription' &&
        request.provider === job.transcriptionProvider
    )
  ) {
    const audioMs = event.usage?.audioMs ?? job.progressTotalMs ?? job.progressProcessedMs ?? 0;
    const billedAudioMs = event.usage?.billedAudioMs;
    const providerRequestCount = event.usage?.providerRequestCount;
    const unmeteredRequestCount = event.usage?.unmeteredRequestCount;
    const model =
      job.transcriptionModel ??
      (event.type === 'transcript-artifact-stored'
        ? (event.transcriptArtifact?.language ?? 'unknown')
        : 'unknown');
    const pricing =
      billedAudioMs !== undefined &&
      providerRequestCount !== undefined &&
      unmeteredRequestCount === 0
        ? calculateAzureTranscriptionActualCost({
            provider: job.transcriptionProvider,
            model,
            pricingVersion: job.pricingVersion,
            audioMs: billedAudioMs
          })
        : ({ costUsd: null, pricingStatus: 'unpriced' } as const);

    await repository.append({
      entryKey: `actual:${job.id}:transcription:${event.leaseToken!}`,
      jobId: job.id,
      submitterId: job.submitterId,
      quotaDayKey: job.quotaDayKey,
      entryType: 'actual',
      stage: 'transcription',
      provider: job.transcriptionProvider,
      model,
      pricingVersion: job.pricingVersion,
      usageQuantity: billedAudioMs ?? audioMs,
      usageUnit: 'audio-ms',
      ...pricing,
      detail: {
        audioMs,
        ...(billedAudioMs === undefined ? {} : { billedAudioMs }),
        ...(providerRequestCount === undefined ? {} : { providerRequestCount }),
        ...(unmeteredRequestCount === undefined ? {} : { unmeteredRequestCount })
      }
    });
  }

  if (isTranscriptEvent && event.usage?.punctuation) {
    const usage = event.usage.punctuation;
    const pricing =
      usage.unmeteredRequestCount > 0
        ? ({ costUsd: null, pricingStatus: 'unpriced' } as const)
        : calculateAzureResponsesCost({
            model: usage.model,
            pricingVersion: job.pricingVersion,
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            outputTokens: usage.outputTokens,
            reasoningOutputTokens: usage.reasoningOutputTokens
          });

    await repository.append({
      entryKey: `actual:${job.id}:punctuation:${event.leaseToken!}`,
      jobId: job.id,
      submitterId: job.submitterId,
      quotaDayKey: job.quotaDayKey,
      entryType: 'actual',
      stage: 'punctuation',
      provider: usage.provider,
      model: usage.model,
      pricingVersion: job.pricingVersion,
      usageQuantity: usage.totalTokens,
      usageUnit: 'tokens',
      ...pricing,
      detail: usage
    });
  }

  if (isTranscriptEvent && event.usage?.diarization) {
    const usage = event.usage.diarization;
    await repository.append({
      entryKey: `actual:${job.id}:diarization:${event.leaseToken!}`,
      jobId: job.id,
      submitterId: job.submitterId,
      quotaDayKey: job.quotaDayKey,
      entryType: 'actual',
      stage: 'transcription',
      provider: 'azure-openai-gpt-4o-transcribe',
      model: usage.model,
      pricingVersion: job.pricingVersion,
      usageQuantity: usage.audioMs,
      usageUnit: 'audio-ms',
      costUsd: null,
      pricingStatus: 'unpriced',
      detail: usage
    });
  }

  if (
    isSummaryEvent &&
    event.usage &&
    event.usage.promptTokens !== undefined &&
    event.usage.cachedPromptTokens !== undefined &&
    event.usage.completionTokens !== undefined &&
    event.usage.reasoningCompletionTokens !== undefined &&
    event.usage.totalTokens !== undefined &&
    actualSummaryProvider &&
    isCloudSummaryProvider(actualSummaryProvider) &&
    !providerRequests.some(
      (request) =>
        request.billingClass === 'metered-api' &&
        request.stage === 'summary' &&
        request.provider === actualSummaryProvider
    )
  ) {
    const {
      promptTokens,
      cachedPromptTokens,
      cacheWritePromptTokens,
      completionTokens,
      reasoningCompletionTokens,
      totalTokens,
      providerRequestCount,
      unmeteredRequestCount
    } = event.usage;
    const model =
      event.type === 'summary-artifact-stored'
        ? (event.summaryArtifact?.model ?? 'unknown')
        : (job.summaryModel ?? 'unknown');
    const pricing =
      (unmeteredRequestCount ?? 0) > 0
        ? ({ costUsd: null, pricingStatus: 'unpriced' } as const)
        : calculateAzureResponsesCost({
            model,
            pricingVersion: job.pricingVersion,
            inputTokens: promptTokens,
            cachedInputTokens: cachedPromptTokens,
            cacheWriteTokens: cacheWritePromptTokens,
            outputTokens: completionTokens,
            reasoningOutputTokens: reasoningCompletionTokens
          });

    await repository.append({
      entryKey: `actual:${job.id}:summary:${event.leaseToken!}`,
      jobId: job.id,
      submitterId: job.submitterId,
      quotaDayKey: job.quotaDayKey,
      entryType: 'actual',
      stage: 'summary',
      provider: actualSummaryProvider,
      model,
      pricingVersion: job.pricingVersion,
      usageQuantity: totalTokens,
      usageUnit: 'tokens',
      ...pricing,
      detail: {
        promptTokens,
        cachedPromptTokens,
        ...(cacheWritePromptTokens === undefined ? {} : { cacheWritePromptTokens }),
        completionTokens,
        reasoningCompletionTokens,
        totalTokens,
        ...(providerRequestCount === undefined ? {} : { providerRequestCount }),
        ...(unmeteredRequestCount === undefined ? {} : { unmeteredRequestCount })
      }
    });
  }
};
