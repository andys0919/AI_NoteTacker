import type { CloudUsageLedgerEntry } from './cloud-usage-ledger-repository.js';
import type { RecordingJob } from './recording-job.js';
import type { TranscriptionProviderSetting } from './transcription-provider-settings-repository.js';
import { isCloudSummaryProvider } from './summary-provider.js';
import type { TranscriptionProvider } from './transcription-provider.js';
import { isCloudTranscriptionProvider } from './transcription-provider.js';

const AZURE_DEFAULT_TRANSCRIPTION_USD_PER_MINUTE = 0.006;
const AZURE_GPT_4O_MINI_TRANSCRIBE_USD_PER_MINUTE = 0.003;
const AZURE_SUMMARY_PROMPT_USD_PER_1K_TOKENS = 0.001;
const AZURE_SUMMARY_COMPLETION_USD_PER_1K_TOKENS = 0.002;
const DEFAULT_UPLOADED_AUDIO_TRANSCRIPTION_ESTIMATE_MINUTES = 30;
const DEFAULT_CLOUD_SUMMARY_ESTIMATE_USD = 0.02;

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
        : roundUsd(
            (DEFAULT_UPLOADED_AUDIO_TRANSCRIPTION_ESTIMATE_MINUTES *
              resolveAzureTranscriptionUsdPerMinute({
                provider: input.transcriptionProvider,
                model: input.transcriptionModel
              }))
          )
      : 0;
  const summaryEstimate =
    input.summaryProvider && isCloudSummaryProvider(input.summaryProvider)
      ? DEFAULT_CLOUD_SUMMARY_ESTIMATE_USD
      : 0;

  return roundUsd(transcriptionEstimate + summaryEstimate);
};

export const sumActualConsumedUsd = (
  entries: CloudUsageLedgerEntry[],
  submitterId: string,
  quotaDayKey: string
): number =>
  roundUsd(
    entries
      .filter(
        (entry) =>
          entry.submitterId === submitterId &&
          entry.quotaDayKey === quotaDayKey &&
          entry.entryType === 'actual'
      )
      .reduce((total, entry) => total + entry.costUsd, 0)
  );

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

export const calculateAzureSummaryCostUsd = (usage: {
  promptTokens?: number;
  completionTokens?: number;
}): number =>
  roundUsd(
    ((usage.promptTokens ?? 0) / 1000) * AZURE_SUMMARY_PROMPT_USD_PER_1K_TOKENS +
      ((usage.completionTokens ?? 0) / 1000) * AZURE_SUMMARY_COMPLETION_USD_PER_1K_TOKENS
  );

const resolveAzureTranscriptionUsdPerMinute = (input: {
  provider?: TranscriptionProvider;
  model?: string;
}): number => {
  if (
    input.provider === 'azure-openai-gpt-4o-mini-transcribe' ||
    input.model === 'gpt-4o-mini-transcribe'
  ) {
    return AZURE_GPT_4O_MINI_TRANSCRIBE_USD_PER_MINUTE;
  }

  return AZURE_DEFAULT_TRANSCRIPTION_USD_PER_MINUTE;
};

export const calculateAzureTranscriptionCostUsd = (
  audioMs: number,
  input: {
    provider?: TranscriptionProvider;
    model?: string;
  } = {}
): number => roundUsd((audioMs / 60_000) * resolveAzureTranscriptionUsdPerMinute(input));
