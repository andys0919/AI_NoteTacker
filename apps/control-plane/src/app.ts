import express from 'express';
import multer from 'multer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import type { AdminAuditLogRepository } from './domain/admin-audit-log-repository.js';
import type { AuthenticatedUserRepository } from './domain/authenticated-user-repository.js';
import {
  buildQuotaDayKey,
  calculateAzureSummaryCostUsd,
  calculateAzureTranscriptionCostUsd,
  calculateRemainingCloudQuotaUsd,
  estimateCloudReservationUsd,
  roundUsd,
  sumActualConsumedUsd,
  sumReservedUsd
} from './domain/cloud-usage.js';
import type { CloudUsageLedgerRepository } from './domain/cloud-usage-ledger-repository.js';
import type { JobNotificationSender, TerminalJobNotification } from './domain/job-notification-sender.js';
import { evaluateMeetingLinkPolicy } from './domain/meeting-link-policy.js';
import {
  getOperatorWorkflowTemplate,
  operatorWorkflowTemplates,
  submissionTemplateIds
} from './domain/operator-workflow-template.js';
import type { OperatorCloudQuotaOverrideRepository } from './domain/operator-cloud-quota-override-repository.js';
import type { RecordingJobRepository } from './domain/recording-job-repository.js';
import {
  isCloudSummaryProvider,
  summaryProviders
} from './domain/summary-provider.js';
import type { TranscriptionProviderSettingsRepository } from './domain/transcription-provider-settings-repository.js';
import {
  isCloudTranscriptionProvider,
  transcriptionProviders
} from './domain/transcription-provider.js';
import {
  attachRecordingArtifact,
  attachQueuedRecordingArtifact,
  attachSummaryArtifact,
  attachTranscriptArtifact,
  assignRecordingJobToWorker,
  createRecordingJob,
  DEFAULT_JOIN_NAME,
  markTerminalJobNotificationSent,
  markRecordingJobFailed,
  type RecordingJob,
  releaseTranscriptionJobForRetry,
  transitionRecordingJobState,
  updateRecordingJobProgress
} from './domain/recording-job.js';
import { InMemoryTranscriptionProviderSettingsRepository } from './infrastructure/in-memory-transcription-provider-settings-repository.js';
import { InMemoryAdminAuditLogRepository } from './infrastructure/in-memory-admin-audit-log-repository.js';
import { InMemoryCloudUsageLedgerRepository } from './infrastructure/in-memory-cloud-usage-ledger-repository.js';
import { InMemoryOperatorCloudQuotaOverrideRepository } from './infrastructure/in-memory-operator-cloud-quota-override-repository.js';
import { InMemoryRecordingJobRepository } from './infrastructure/in-memory-recording-job-repository.js';
import type {
  MeetingBotController,
  MeetingBotRuntimeMonitor
} from './infrastructure/meeting-bot-runtime.js';
import type { OperatorAuth } from './infrastructure/operator-auth.js';
import type { AuthenticatedOperator } from './infrastructure/operator-auth.js';
import type { SummaryProviderCatalog } from './infrastructure/summary-provider-catalog.js';
import {
  createSummaryProviderCatalog,
  createSummaryProviderCatalogFromEnvironment
} from './infrastructure/summary-provider-catalog.js';
import type { TranscriptionProviderCatalog } from './infrastructure/transcription-provider-catalog.js';
import { createTranscriptionProviderCatalogFromEnvironment } from './infrastructure/transcription-provider-catalog.js';
import type { UploadedAudioStorage } from './infrastructure/uploaded-audio-storage.js';

const createRecordingJobRequestSchema = z.object({
  meetingUrl: z.url()
});

const claimRecordingJobRequestSchema = z.object({
  workerId: z.string().min(1)
});

const claimSummarySlotRequestSchema = z.object({
  workerId: z.string().min(1),
  jobId: z.string().min(1)
});

const operatorMeetingJobRequestSchema = z.object({
  submitterId: z.string().trim().min(1).max(120).optional(),
  meetingUrl: z.url(),
  requestedJoinName: z.string().trim().max(120).optional(),
  submissionTemplateId: z.enum(submissionTemplateIds).optional()
});

const operatorJobsQuerySchema = z.object({
  submitterId: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().max(200).optional()
});

const adminCloudUsageReportQuerySchema = z.object({
  quotaDayKey: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
});

const operatorJobExportQuerySchema = z.object({
  submitterId: z.string().trim().min(1).max(120).optional(),
  format: z.enum(['markdown', 'txt', 'srt', 'json'])
});

const operatorStopRequestSchema = z.object({
  submitterId: z.string().trim().min(1).max(120).optional()
});

const updateTranscriptionProviderSchema = z.object({
  provider: z.enum(transcriptionProviders)
});

const updateSummaryModelSchema = z.object({
  summaryModel: z.string().trim().min(1).max(120)
});

const concurrencyPoolsSchema = z.object({
  localTranscription: z.number().int().min(1).max(64),
  cloudTranscription: z.number().int().min(1).max(64),
  localSummary: z.number().int().min(1).max(64),
  cloudSummary: z.number().int().min(1).max(64)
});

const updateAiPolicySchema = z.object({
  transcriptionProvider: z.enum(transcriptionProviders),
  transcriptionModel: z.string().trim().min(1).max(120),
  summaryProvider: z.enum(summaryProviders),
  summaryModel: z.string().trim().min(1).max(120),
  pricingVersion: z.string().trim().min(1).max(60),
  defaultDailyCloudQuotaUsd: z.number().nonnegative().max(100000),
  liveMeetingReservationCapUsd: z.number().nonnegative().max(100000),
  concurrencyPools: concurrencyPoolsSchema
});

const updateOperatorQuotaOverrideSchema = z.object({
  submitterId: z.string().trim().min(1).max(120),
  dailyQuotaUsd: z.number().nonnegative().max(100000)
});

const recordingArtifactSchema = z.object({
  storageKey: z.string().min(1),
  downloadUrl: z.url(),
  contentType: z.string().min(1)
});

const transcriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1)
});

const transcriptArtifactSchema = recordingArtifactSchema.extend({
  language: z.string().min(2),
  segments: z.array(transcriptSegmentSchema)
});

const transcriptUsageSchema = z.object({
  audioMs: z.number().int().nonnegative()
});

const summaryArtifactSchema = z.object({
  model: z.string().min(1),
  reasoningEffort: z.string().min(1),
  text: z.string().min(1),
  structured: z
    .object({
      summary: z.string(),
      keyPoints: z.array(z.string()),
      actionItems: z.array(z.string()),
      decisions: z.array(z.string()),
      risks: z.array(z.string()),
      openQuestions: z.array(z.string())
    })
    .optional()
});

const summaryUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional()
});

const meetingBotCompletionSchema = z.object({
  recordingId: z.string().min(1),
  meetingLink: z.url(),
  status: z.literal('completed'),
  timestamp: z.string().min(1),
  blobUrl: z.url().optional(),
  metadata: z.object({
    userId: z.string().min(1),
    teamId: z.string().min(1),
    botId: z.string().min(1),
    contentType: z.string().min(1),
    uploaderType: z.string().min(1),
    storage: z
      .object({
        provider: z.string().min(1),
        bucket: z.string().min(1).optional(),
        key: z.string().min(1).optional(),
        url: z.url().optional()
      })
      .optional()
  })
});

const meetingBotStatusSchema = z.object({
  eventId: z.string().min(1).optional(),
  botId: z.string().min(1),
  provider: z.string().min(1),
  status: z.array(z.string().min(1)).min(1)
});

const meetingBotLogSchema = z.object({
  eventId: z.string().min(1).optional(),
  botId: z.string().min(1),
  provider: z.string().min(1),
  level: z.string().min(1),
  message: z.string().min(1),
  category: z.string().min(1).optional(),
  subCategory: z.string().min(1).optional()
});

const recordingJobEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state-updated'),
    state: z.enum(['joining', 'recording', 'transcribing', 'completed'])
  }),
  z.object({
    type: z.literal('recording-artifact-stored'),
    recordingArtifact: recordingArtifactSchema
  }),
  z.object({
    type: z.literal('transcript-artifact-stored'),
    transcriptArtifact: transcriptArtifactSchema,
    usage: transcriptUsageSchema.optional()
  }),
  z.object({
    type: z.literal('summary-artifact-stored'),
    summaryArtifact: summaryArtifactSchema,
    usage: summaryUsageSchema.optional()
  }),
  z.object({
    type: z.literal('progress-updated'),
    processingStage: z.string().min(1),
    processingMessage: z.string().min(1).optional(),
    progressPercent: z.number().int().min(0).max(100).optional(),
    progressProcessedMs: z.number().int().nonnegative().optional(),
    progressTotalMs: z.number().int().nonnegative().optional()
  }),
  z.object({
    type: z.literal('failed'),
    failure: z.object({
      code: z.string().min(1),
      message: z.string().min(1)
    })
  }),
  z.object({
    type: z.literal('transcription-failed'),
    failure: z.object({
      code: z.string().min(1),
      message: z.string().min(1)
    })
  })
]);

type AppOptions = {
  authenticatedUserRepository?: AuthenticatedUserRepository;
  transcriptionProviderSettingsRepository?: TranscriptionProviderSettingsRepository;
  transcriptionProviderCatalog?: TranscriptionProviderCatalog;
  summaryProviderCatalog?: SummaryProviderCatalog;
  operatorCloudQuotaOverrideRepository?: OperatorCloudQuotaOverrideRepository;
  cloudUsageLedgerRepository?: CloudUsageLedgerRepository;
  adminAuditLogRepository?: AdminAuditLogRepository;
  maxTranscriptionAttempts?: number;
  operatorAuth?: OperatorAuth;
  uploadedAudioStorage?: UploadedAudioStorage;
  meetingBotController?: MeetingBotController;
  meetingBotRuntimeMonitor?: MeetingBotRuntimeMonitor;
  jobNotificationSender?: JobNotificationSender;
  maxConcurrentTranscriptionJobs?: number;
  adminEmails?: string[];
  staleMeetingJobAfterMs?: number;
  staleMeetingFinalizationAfterMs?: number;
  staleTranscriptionJobAfterMs?: number;
  publicDir?: string;
};

const toApiRecordingJob = (job: {
  id: string;
  meetingUrl: string;
  platform: string;
  inputSource: string;
  submitterId: string;
  requestedJoinName: string;
  submissionTemplateId?: string;
  summaryProfile?: string;
  preferredExportFormat?: string;
  uploadedFileName?: string;
  state: string;
  processingStage?: string;
  processingMessage?: string;
  progressPercent?: number;
  progressProcessedMs?: number;
  progressTotalMs?: number;
  assignedWorkerId?: string;
  assignedTranscriptionWorkerId?: string;
  transcriptionProvider?: string;
  transcriptionModel?: string;
  summaryProvider?: string;
  summaryModel?: string;
  pricingVersion?: string;
  estimatedCloudReservationUsd?: number;
  reservedCloudQuotaUsd?: number;
  quotaDayKey?: string;
  actualTranscriptionCostUsd?: number;
  actualSummaryCostUsd?: number;
  actualCloudCostUsd?: number;
  transcriptionAttemptCount?: number;
  createdAt: string;
  updatedAt: string;
  failureCode?: string;
  failureMessage?: string;
  recordingArtifact?: {
    storageKey: string;
    downloadUrl: string;
    contentType: string;
  };
  transcriptArtifact?: {
    storageKey: string;
    downloadUrl: string;
    contentType: string;
    language: string;
    segments: {
      startMs: number;
      endMs: number;
      text: string;
    }[];
  };
  summaryArtifact?: {
    model: string;
    reasoningEffort: string;
    text: string;
    structured?: {
      summary: string;
      keyPoints: string[];
      actionItems: string[];
      decisions: string[];
      risks: string[];
      openQuestions: string[];
    };
  };
  jobHistory?: Array<{
    at: string;
    stage: string;
    message: string;
    state: string;
    kind: string;
  }>;
  terminalNotificationSentAt?: string;
  terminalNotificationTarget?: string;
  terminalNotificationState?: string;
  displayState?: string;
}) => ({
  id: job.id,
  meetingUrl: job.meetingUrl,
  platform: job.platform,
  inputSource: job.inputSource,
  submitterId: job.submitterId,
  requestedJoinName: job.requestedJoinName,
  submissionTemplateId: job.submissionTemplateId,
  summaryProfile: job.summaryProfile,
  preferredExportFormat: job.preferredExportFormat,
  uploadedFileName: job.uploadedFileName,
  state: job.state,
  displayState: job.displayState,
  processingStage: job.processingStage,
  processingMessage: job.processingMessage,
  progressPercent: job.progressPercent,
  progressProcessedMs: job.progressProcessedMs,
  progressTotalMs: job.progressTotalMs,
  assignedWorkerId: job.assignedWorkerId,
  assignedTranscriptionWorkerId: job.assignedTranscriptionWorkerId,
  transcriptionProvider: job.transcriptionProvider,
  transcriptionModel: job.transcriptionModel,
  summaryProvider: job.summaryProvider,
  summaryModel: job.summaryModel,
  pricingVersion: job.pricingVersion,
  estimatedCloudReservationUsd: job.estimatedCloudReservationUsd,
  reservedCloudQuotaUsd: job.reservedCloudQuotaUsd,
  quotaDayKey: job.quotaDayKey,
  actualTranscriptionCostUsd: job.actualTranscriptionCostUsd,
  actualSummaryCostUsd: job.actualSummaryCostUsd,
  actualCloudCostUsd: job.actualCloudCostUsd,
  transcriptionAttemptCount: job.transcriptionAttemptCount,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  failureCode: job.failureCode,
  failureMessage: job.failureMessage,
  recordingArtifact: job.recordingArtifact,
  transcriptArtifact: job.transcriptArtifact,
  summaryArtifact: job.summaryArtifact,
  jobHistory: job.jobHistory,
  terminalNotificationSentAt: job.terminalNotificationSentAt,
  terminalNotificationTarget: job.terminalNotificationTarget,
  terminalNotificationState: job.terminalNotificationState
});

const deriveStorageKeyFromCompletionPayload = (
  payload: z.infer<typeof meetingBotCompletionSchema>
): string | undefined => {
  if (payload.metadata.storage?.key) {
    return payload.metadata.storage.key;
  }

  const fallbackUrl = payload.blobUrl ?? payload.metadata.storage?.url;

  if (!fallbackUrl) {
    return undefined;
  }

  const pathname = new URL(fallbackUrl).pathname.replace(/^\/+/, '');
  return pathname.length > 0 ? decodeURIComponent(pathname) : undefined;
};

const toKebabCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const shouldApplyMeetingBotFailure = (state: string): boolean =>
  ['queued', 'joining', 'recording'].includes(state);

const shouldApplyMeetingBotFailureDetails = (state: string): boolean =>
  ['queued', 'joining', 'recording', 'failed'].includes(state);

const isFinalizingMeetingRecording = (job: {
  inputSource: string;
  processingStage?: string;
  processingMessage?: string;
}): boolean =>
  job.inputSource === 'meeting-link' && job.processingStage === 'finalizing-recording';

const isTerminalJobState = (state: string): boolean => ['completed', 'failed'].includes(state);

const genericMeetingBotFailure = {
  code: 'meeting-bot-failed',
  message: 'The meeting bot reported a failed join or recording attempt.'
};

const staleMeetingBotFailure = {
  code: 'meeting-bot-stale',
  message: 'The previous meeting bot job was stale while the runtime was idle and was cleared automatically.'
};

const staleMeetingBotFinalizationFailure = {
  code: 'meeting-bot-finalization-timeout',
  message: 'The meeting bot exit request did not finish recording finalization before timing out.'
};

const staleTranscriptionFailure = {
  code: 'transcription-worker-stale',
  message: 'The previous transcription worker stopped heartbeating and the job was released for retry.'
};

const deriveMeetingBotLogFailure = (payload: z.infer<typeof meetingBotLogSchema>) => ({
  code: ['meeting-bot', payload.category, payload.subCategory]
    .filter((value): value is string => Boolean(value))
    .map(toKebabCase)
    .join('-'),
  message: payload.message
});

const resolveRequestedJoinName = (value?: string, fallbackJoinName = DEFAULT_JOIN_NAME): string => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallbackJoinName;
};

const buildUploadedAudioMeetingUrl = (fileName: string): string =>
  `uploaded://${encodeURIComponent(fileName)}`;

const scorePotentialFileNameDecoding = (value: string): number => {
  const replacementCount = (value.match(/\uFFFD/g) || []).length;
  const cjkCount = (value.match(/[\u3400-\u9FFF]/g) || []).length;
  const mojibakeCount = (value.match(/[ÃÂÐÑØæçéèêëîïôöûü]/g) || []).length;

  return cjkCount * 3 - replacementCount * 5 - mojibakeCount;
};

const normalizeUploadedFileName = (value: string): string => {
  let bestCandidate = value;
  let bestScore = scorePotentialFileNameDecoding(value);
  let current = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const decoded = Buffer.from(current, 'latin1').toString('utf8');
    const decodedScore = scorePotentialFileNameDecoding(decoded);

    if (decodedScore > bestScore) {
      bestCandidate = decoded;
      bestScore = decodedScore;
    }

    current = decoded;
  }

  return bestCandidate;
};

const sanitizeExportBaseName = (value: string): string =>
  value
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'archive-export';

const buildExportBaseName = (job: RecordingJob): string =>
  sanitizeExportBaseName(job.uploadedFileName || job.requestedJoinName || `job-${job.id}`);

const formatSrtTimestamp = (milliseconds: number): string => {
  const totalMilliseconds = Math.max(0, milliseconds);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const remainingMs = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(remainingMs).padStart(3, '0')}`;
};

const renderMarkdownExport = (job: RecordingJob): string => {
  const parts = [
    '# AI NoteTacker Export',
    '',
    `- Job ID: ${job.id}`,
    `- State: ${job.state}`,
    `- Source: ${job.uploadedFileName || job.meetingUrl}`,
    `- Join Name: ${job.requestedJoinName}`,
    `- Updated: ${new Date(job.updatedAt).toISOString()}`
  ];

  if (job.summaryArtifact?.text) {
    parts.push('', '## Summary', '', job.summaryArtifact.text);
  }

  if (job.transcriptArtifact?.segments.length) {
    parts.push(
      '',
      '## Transcript',
      '',
      ...job.transcriptArtifact.segments.map(
        (segment) =>
          `- [${formatSrtTimestamp(segment.startMs).replace(',', '.')}] ${segment.text}`
      )
    );
  }

  return parts.join('\n');
};

const renderTextExport = (job: RecordingJob): string => {
  const parts = [
    'AI NoteTacker Export',
    '',
    `Job ID: ${job.id}`,
    `State: ${job.state}`,
    `Source: ${job.uploadedFileName || job.meetingUrl}`,
    `Join Name: ${job.requestedJoinName}`
  ];

  if (job.summaryArtifact?.text) {
    parts.push('', 'Summary', job.summaryArtifact.text);
  }

  if (job.transcriptArtifact?.segments.length) {
    parts.push(
      '',
      'Transcript',
      ...job.transcriptArtifact.segments.map(
        (segment) => `[${formatSrtTimestamp(segment.startMs)}] ${segment.text}`
      )
    );
  }

  return parts.join('\n');
};

const renderSrtExport = (job: RecordingJob): string =>
  (job.transcriptArtifact?.segments ?? [])
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTimestamp(segment.startMs)} --> ${formatSrtTimestamp(segment.endMs)}\n${segment.text}`
    )
    .join('\n\n');

const buildTerminalJobNotification = (
  job: RecordingJob,
  to: string
): TerminalJobNotification => {
  const sourceLabel = job.uploadedFileName || job.meetingUrl;
  const subject =
    job.state === 'completed'
      ? `[AI NoteTacker] Job completed: ${sourceLabel}`
      : `[AI NoteTacker] Job failed: ${sourceLabel}`;

  const sections = [
    `Job ${job.id}`,
    `State: ${job.state}`,
    `Join Name: ${job.requestedJoinName}`,
    `Source: ${sourceLabel}`
  ];

  if (job.state === 'failed') {
    sections.push(`Failure: ${job.failureCode ?? 'job-failed'}: ${job.failureMessage ?? 'Job failed.'}`);
  }

  if (job.summaryArtifact?.text) {
    sections.push(`Summary:\n${job.summaryArtifact.text}`);
  }

  if (job.transcriptArtifact?.segments.length) {
    sections.push(
      `Transcript excerpt:\n${job.transcriptArtifact.segments
        .slice(0, 3)
        .map((segment) => `- ${segment.text}`)
        .join('\n')}`
    );
  }

  return {
    to,
    state: job.state,
    jobId: job.id,
    subject,
    text: sections.join('\n\n')
  };
};

const normalizeSearchValue = (value: string): string => value.trim().toLowerCase();

const parseAdminEmails = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

const jobMatchesSearchQuery = (
  job: {
    meetingUrl: string;
    requestedJoinName: string;
    uploadedFileName?: string;
    failureMessage?: string;
    transcriptArtifact?: { segments: Array<{ text: string }> };
    summaryArtifact?: { text: string };
  },
  query?: string
): boolean => {
  const normalizedQuery = normalizeSearchValue(query ?? '');

  if (normalizedQuery.length === 0) {
    return true;
  }

  const searchableText = [
    job.meetingUrl,
    job.requestedJoinName,
    job.uploadedFileName,
    job.failureMessage,
    job.summaryArtifact?.text,
    job.transcriptArtifact?.segments.map((segment) => segment.text).join(' ')
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .toLowerCase();

  return searchableText.includes(normalizedQuery);
};

const deriveDisplayState = (job: { state: string; inputSource: string }, meetingBotBusy: boolean): string =>
  job.inputSource === 'meeting-link' && job.state === 'joining' && meetingBotBusy
    ? 'recording'
    : job.state;

const isStaleMeetingJob = (
  job: { inputSource: string; state: string; updatedAt: string; processingStage?: string },
  staleAfterMs: number,
  nowMs: number
): boolean => {
  if (job.inputSource !== 'meeting-link') {
    return false;
  }

  if (job.state !== 'joining' && job.state !== 'recording') {
    return false;
  }

  const updatedAtMs = Date.parse(job.updatedAt);

  if (Number.isNaN(updatedAtMs)) {
    return false;
  }

  return nowMs - updatedAtMs >= staleAfterMs;
};

const isStaleMeetingFinalization = (
  job: { inputSource: string; processingStage?: string; updatedAt: string },
  staleAfterMs: number,
  nowMs: number
): boolean => {
  if (job.inputSource !== 'meeting-link' || job.processingStage !== 'finalizing-recording') {
    return false;
  }

  const updatedAtMs = Date.parse(job.updatedAt);

  if (Number.isNaN(updatedAtMs)) {
    return false;
  }

  return nowMs - updatedAtMs >= staleAfterMs;
};

const isStaleTranscriptionJob = (
  job: {
    state: string;
    updatedAt: string;
    recordingArtifact?: object;
    transcriptArtifact?: object;
    assignedTranscriptionWorkerId?: string;
  },
  staleAfterMs: number,
  nowMs: number
): boolean => {
  if (job.state !== 'transcribing') {
    return false;
  }

  if (!job.recordingArtifact || job.transcriptArtifact || !job.assignedTranscriptionWorkerId) {
    return false;
  }

  const updatedAtMs = Date.parse(job.updatedAt);

  if (Number.isNaN(updatedAtMs)) {
    return false;
  }

  return nowMs - updatedAtMs >= staleAfterMs;
};

export const createApp = (
  repository: RecordingJobRepository = new InMemoryRecordingJobRepository(),
  options: AppOptions = {}
) => {
  const app = express();
  const authenticatedUserRepository = options.authenticatedUserRepository;
  const transcriptionProviderCatalog =
    options.transcriptionProviderCatalog ?? createTranscriptionProviderCatalogFromEnvironment();
  const summaryProviderCatalog =
    options.summaryProviderCatalog ?? createSummaryProviderCatalogFromEnvironment();
  const defaultLocalTranscriptionModel = process.env.WHISPER_MODEL ?? 'large-v3';
  const defaultCloudTranscriptionModel =
    process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-mini-transcribe';
  const defaultTranscriptionModel =
    transcriptionProviderCatalog.defaultProvider === 'azure-openai-gpt-4o-mini-transcribe'
      ? defaultCloudTranscriptionModel
      : defaultLocalTranscriptionModel;
  const defaultSummaryModel = process.env.SUMMARY_MODEL ?? 'gpt-5-mini';
  const defaultDailyCloudQuotaUsd = Number(process.env.DEFAULT_DAILY_CLOUD_QUOTA_USD ?? '5');
  const defaultLiveMeetingReservationCapUsd = Number(
    process.env.LIVE_MEETING_RESERVATION_CAP_USD ?? '1.5'
  );
  const defaultPricingVersion = process.env.AI_PRICING_VERSION ?? 'v1';
  const transcriptionProviderSettingsRepository =
    options.transcriptionProviderSettingsRepository ??
    new InMemoryTranscriptionProviderSettingsRepository({
      defaultTranscriptionProvider: transcriptionProviderCatalog.defaultProvider,
      defaultTranscriptionModel,
      defaultLocalTranscriptionModel,
      defaultCloudTranscriptionModel,
      defaultSummaryProvider: summaryProviderCatalog.defaultProvider,
      defaultSummaryModel,
      defaultDailyCloudQuotaUsd,
      defaultLiveMeetingReservationCapUsd,
      defaultPricingVersion,
      defaultConcurrencyPools: {
        localTranscription: Math.max(
          1,
          options.maxConcurrentTranscriptionJobs ??
            Number(process.env.MAX_CONCURRENT_TRANSCRIPTION_JOBS ?? '1')
        ),
        cloudTranscription: Math.max(
          1,
          options.maxConcurrentTranscriptionJobs ??
            Number(process.env.MAX_CONCURRENT_TRANSCRIPTION_JOBS ?? '1')
        ),
        localSummary: 1,
        cloudSummary: 1
      }
    });
  const operatorCloudQuotaOverrideRepository =
    options.operatorCloudQuotaOverrideRepository ??
    new InMemoryOperatorCloudQuotaOverrideRepository();
  const cloudUsageLedgerRepository =
    options.cloudUsageLedgerRepository ?? new InMemoryCloudUsageLedgerRepository();
  const adminAuditLogRepository =
    options.adminAuditLogRepository ?? new InMemoryAdminAuditLogRepository();
  const maxTranscriptionAttempts = options.maxTranscriptionAttempts ?? 3;
  const operatorAuth = options.operatorAuth;
  const uploadedAudioStorage = options.uploadedAudioStorage;
  const meetingBotController = options.meetingBotController;
  const meetingBotRuntimeMonitor = options.meetingBotRuntimeMonitor;
  const jobNotificationSender = options.jobNotificationSender;
  const staleMeetingJobAfterMs = options.staleMeetingJobAfterMs ?? 10 * 60 * 1000;
  const staleMeetingFinalizationAfterMs =
    options.staleMeetingFinalizationAfterMs ?? 2 * 60 * 1000;
  const staleTranscriptionJobAfterMs = options.staleTranscriptionJobAfterMs ?? 15 * 60 * 1000;
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const publicDir = options.publicDir ?? resolve(currentDir, '../public');
  const adminEmails = new Set(
    (options.adminEmails ?? parseAdminEmails(process.env.ADMIN_EMAILS)).map((email) =>
      email.toLowerCase()
    )
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 250 * 1024 * 1024
    }
  });

  const notFoundResponse = (id: string) => ({
    error: {
      code: 'recording-job-not-found',
      message: `Recording job ${id} does not exist.`
    }
  });

  const authRequiredResponse = {
    error: {
      code: 'operator-auth-required',
      message: 'A valid authenticated operator session is required.'
    }
  };

  const adminRequiredResponse = {
    error: {
      code: 'operator-admin-required',
      message: 'An authenticated administrator is required.'
    }
  };

  const quotaExceededResponse = (remainingUsd: number, requiredUsd: number) => ({
    error: {
      code: 'cloud-quota-exceeded',
      message: `The daily cloud quota would be exceeded. Remaining: $${remainingUsd.toFixed(3)}, required: $${requiredUsd.toFixed(3)}.`
    }
  });

  const appendAdminAuditEntry = async (
    actor: AuthenticatedOperator,
    input: {
      action: string;
      target: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    }
  ): Promise<void> => {
    await adminAuditLogRepository.append({
      actorId: actor.id,
      actorEmail: actor.email,
      action: input.action,
      target: input.target,
      before: input.before,
      after: input.after
    });
  };

  const getQuotaStatusForSubmitter = async (submitterId: string, at: Date = new Date()) => {
    const currentPolicy = await transcriptionProviderSettingsRepository.getCurrent();
    const quotaDayKey = buildQuotaDayKey(at);
    const override = await operatorCloudQuotaOverrideRepository.getBySubmitterId(submitterId);
    const dailyQuotaUsd = override?.dailyQuotaUsd ?? currentPolicy.defaultDailyCloudQuotaUsd;
    const ledgerEntries = await cloudUsageLedgerRepository.listBySubmitterAndDay(
      submitterId,
      quotaDayKey
    );
    const consumedUsd = sumActualConsumedUsd(ledgerEntries, submitterId, quotaDayKey);
    const reservedUsd = sumReservedUsd(
      await repository.listBySubmitter(submitterId),
      submitterId,
      quotaDayKey
    );
    const remainingUsd = calculateRemainingCloudQuotaUsd({
      dailyQuotaUsd,
      consumedUsd,
      reservedUsd
    });

    return {
      dailyQuotaUsd,
      consumedUsd,
      reservedUsd,
      remainingUsd,
      quotaDayKey
    };
  };

  const buildPolicySnapshotForJob = async (input: {
    submitterId: string;
    inputSource: RecordingJob['inputSource'];
  }) => {
    const currentPolicy = await transcriptionProviderSettingsRepository.getCurrent();
    const quotaStatus = await getQuotaStatusForSubmitter(input.submitterId);
    const estimatedCloudReservationUsd = estimateCloudReservationUsd(
      {
        inputSource: input.inputSource,
        transcriptionProvider: currentPolicy.transcriptionProvider,
        transcriptionModel: currentPolicy.transcriptionModel,
        summaryProvider: currentPolicy.summaryProvider
      },
      currentPolicy
    );

    if (estimatedCloudReservationUsd > quotaStatus.remainingUsd) {
      return {
        accepted: false as const,
        estimatedCloudReservationUsd,
        quotaStatus
      };
    }

    return {
      accepted: true as const,
      policy: currentPolicy,
      estimatedCloudReservationUsd,
      quotaStatus
    };
  };

  const appendActualUsageFromEvent = async (
    job: RecordingJob,
    event:
      | z.infer<typeof recordingJobEventSchema>
      | Extract<z.infer<typeof recordingJobEventSchema>, { type: 'transcript-artifact-stored' }>
      | Extract<z.infer<typeof recordingJobEventSchema>, { type: 'summary-artifact-stored' }>
  ): Promise<void> => {
    if (!job.quotaDayKey || !job.pricingVersion) {
      return;
    }

    if (
      event.type === 'transcript-artifact-stored' &&
      job.transcriptionProvider &&
      isCloudTranscriptionProvider(job.transcriptionProvider)
    ) {
      const audioMs =
        event.usage?.audioMs ?? job.progressTotalMs ?? job.progressProcessedMs ?? 0;

      await cloudUsageLedgerRepository.append({
        jobId: job.id,
        submitterId: job.submitterId,
        quotaDayKey: job.quotaDayKey,
        entryType: 'actual',
        stage: 'transcription',
        provider: job.transcriptionProvider,
        model: job.transcriptionModel ?? event.transcriptArtifact.language,
        pricingVersion: job.pricingVersion,
        usageQuantity: audioMs,
        usageUnit: 'audio-ms',
        costUsd: calculateAzureTranscriptionCostUsd(audioMs, {
          provider: job.transcriptionProvider,
          model: job.transcriptionModel
        }),
        detail: event.usage ? { audioMs: event.usage.audioMs } : undefined
      });
    }

    if (
      event.type === 'summary-artifact-stored' &&
      job.summaryProvider &&
      isCloudSummaryProvider(job.summaryProvider)
    ) {
      const promptTokens = event.usage?.promptTokens ?? 0;
      const completionTokens = event.usage?.completionTokens ?? 0;
      const totalTokens = event.usage?.totalTokens ?? promptTokens + completionTokens;

      await cloudUsageLedgerRepository.append({
        jobId: job.id,
        submitterId: job.submitterId,
        quotaDayKey: job.quotaDayKey,
        entryType: 'actual',
        stage: 'summary',
        provider: job.summaryProvider,
        model: job.summaryModel ?? event.summaryArtifact.model,
        pricingVersion: job.pricingVersion,
        usageQuantity: totalTokens,
        usageUnit: 'tokens',
        costUsd: calculateAzureSummaryCostUsd({
          promptTokens,
          completionTokens
        }),
        detail: {
          promptTokens,
          completionTokens,
          totalTokens
        }
      });
    }
  };

  const cleanupStaleMeetingJobsIfIdle = async (): Promise<boolean> => {
    if (!meetingBotRuntimeMonitor) {
      return false;
    }

    try {
      const meetingBotBusy = await meetingBotRuntimeMonitor.isBusy();

      if (meetingBotBusy) {
        return true;
      }

      const activeJobs = await repository.listActiveProcessingJobs();
      const nowMs = Date.now();
      const staleFinalizingJobs = activeJobs.filter((job) =>
        isStaleMeetingFinalization(job, staleMeetingFinalizationAfterMs, nowMs)
      );
      const staleJobs = activeJobs.filter(
        (job) =>
          !isStaleMeetingFinalization(job, staleMeetingFinalizationAfterMs, nowMs) &&
          isStaleMeetingJob(job, staleMeetingJobAfterMs, nowMs)
      );

      await Promise.all(
        staleFinalizingJobs.map((job) =>
          saveJob(markRecordingJobFailed(job, staleMeetingBotFinalizationFailure))
        )
      );

      await Promise.all(
        staleJobs.map((job) => saveJob(markRecordingJobFailed(job, staleMeetingBotFailure)))
      );

      return false;
    } catch {
      return false;
    }
  };

  const resolveAuthenticatedOperatorFromRequest = async (
    request: express.Request,
    response: express.Response
  ): Promise<AuthenticatedOperator | undefined> => {
    if (!operatorAuth) {
      response.status(401).json(authRequiredResponse);
      return undefined;
    }

    const authenticatedOperator = await operatorAuth.verifyAuthorizationHeader(
      request.headers.authorization
    );

    if (!authenticatedOperator) {
      response.status(401).json(authRequiredResponse);
      return undefined;
    }

    await authenticatedUserRepository?.upsert(authenticatedOperator);
    return authenticatedOperator;
  };

  const resolveSubmitterIdFromRequest = async (
    request: express.Request,
    response: express.Response,
    submitterIdValue?: string
  ): Promise<string | undefined> => {
    if (!operatorAuth) {
      const submitterId = (submitterIdValue ?? '').trim();

      if (submitterId.length === 0) {
        response.status(400).json({
          error: {
            code: 'invalid-request',
            message: 'submitterId is required.'
          }
        });
        return undefined;
      }

      return submitterId;
    }

    return (await resolveAuthenticatedOperatorFromRequest(request, response))?.id;
  };

  const requireAdminOperator = async (
    request: express.Request,
    response: express.Response
  ): Promise<AuthenticatedOperator | undefined> => {
    const authenticatedOperator = await resolveAuthenticatedOperatorFromRequest(request, response);

    if (!authenticatedOperator) {
      return undefined;
    }

    if (!adminEmails.has(authenticatedOperator.email.toLowerCase())) {
      response.status(403).json(adminRequiredResponse);
      return undefined;
    }

    return authenticatedOperator;
  };

  const maybeSendTerminalJobNotification = async (job: RecordingJob): Promise<RecordingJob> => {
    if (!jobNotificationSender) {
      return job;
    }

    if (job.state !== 'completed' && job.state !== 'failed') {
      return job;
    }

    if (job.terminalNotificationSentAt && job.terminalNotificationState === job.state) {
      return job;
    }

    const authenticatedUser = await authenticatedUserRepository?.getById(job.submitterId);

    if (!authenticatedUser?.email) {
      return job;
    }

    const notification = buildTerminalJobNotification(job, authenticatedUser.email);

    try {
      await jobNotificationSender.sendTerminalJobNotification(notification);
    } catch (error) {
      console.error(`failed to send terminal job notification for ${job.id}`, error);
      return job;
    }

    return await repository.save(
      markTerminalJobNotificationSent(job, {
        to: authenticatedUser.email,
        state: job.state
      })
    );
  };

  const saveJob = async (job: RecordingJob): Promise<RecordingJob> => {
    const savedJob = await repository.save(job);
    return await maybeSendTerminalJobNotification(savedJob);
  };

  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.get('/api/auth/config', (_request, response) => {
    const enabled = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);

    response.status(200).json({
      enabled,
      supabaseUrl: enabled ? process.env.SUPABASE_URL : undefined,
      supabasePublishableKey: enabled ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined
    });
  });

  app.get('/api/admin/ai-policy', async (request, response) => {
    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    const currentPolicy = await transcriptionProviderSettingsRepository.getCurrent();

    return response.status(200).json({
      transcriptionProvider: currentPolicy.transcriptionProvider,
      transcriptionModel: currentPolicy.transcriptionModel,
      summaryProvider: currentPolicy.summaryProvider,
      summaryModel: currentPolicy.summaryModel,
      pricingVersion: currentPolicy.pricingVersion,
      defaultDailyCloudQuotaUsd: currentPolicy.defaultDailyCloudQuotaUsd,
      liveMeetingReservationCapUsd: currentPolicy.liveMeetingReservationCapUsd,
      concurrencyPools: currentPolicy.concurrencyPools,
      transcriptionOptions: transcriptionProviderCatalog.options.map((option) => ({
        value: option.value,
        label: option.label,
        ready: option.ready,
        ...(option.reason ? { reason: option.reason } : {})
      })),
      summaryOptions: summaryProviderCatalog.options.map((option) => ({
        value: option.value,
        label: option.label,
        ready: option.ready,
        ...(option.reason ? { reason: option.reason } : {})
      })),
      updatedAt: currentPolicy.updatedAt,
      updatedBy: currentPolicy.updatedBy
    });
  });

  app.put('/api/admin/ai-policy', async (request, response) => {
    const parsedRequest = updateAiPolicySchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    if (!transcriptionProviderCatalog.isReady(parsedRequest.data.transcriptionProvider)) {
      return response.status(409).json({
        error: {
          code: 'transcription-provider-not-ready',
          message:
            transcriptionProviderCatalog.readinessReason(parsedRequest.data.transcriptionProvider) ??
            'The requested transcription provider is not ready.'
        }
      });
    }

    if (!summaryProviderCatalog.isReady(parsedRequest.data.summaryProvider)) {
      return response.status(409).json({
        error: {
          code: 'summary-provider-not-ready',
          message:
            summaryProviderCatalog.readinessReason(parsedRequest.data.summaryProvider) ??
            'The requested summary provider is not ready.'
        }
      });
    }

    const before = await transcriptionProviderSettingsRepository.getCurrent();
    const updated = await transcriptionProviderSettingsRepository.updatePolicy({
      transcriptionProvider: parsedRequest.data.transcriptionProvider,
      transcriptionModel: parsedRequest.data.transcriptionModel,
      summaryProvider: parsedRequest.data.summaryProvider,
      summaryModel: parsedRequest.data.summaryModel,
      pricingVersion: parsedRequest.data.pricingVersion,
      defaultDailyCloudQuotaUsd: parsedRequest.data.defaultDailyCloudQuotaUsd,
      liveMeetingReservationCapUsd: parsedRequest.data.liveMeetingReservationCapUsd,
      concurrencyPools: parsedRequest.data.concurrencyPools,
      updatedBy: authenticatedOperator.id
    });

    await appendAdminAuditEntry(authenticatedOperator, {
      action: 'ai-policy.updated',
      target: 'ai-policy',
      before: {
        transcriptionProvider: before.transcriptionProvider,
        transcriptionModel: before.transcriptionModel,
        summaryProvider: before.summaryProvider,
        summaryModel: before.summaryModel,
        pricingVersion: before.pricingVersion,
        defaultDailyCloudQuotaUsd: before.defaultDailyCloudQuotaUsd,
        liveMeetingReservationCapUsd: before.liveMeetingReservationCapUsd,
        concurrencyPools: before.concurrencyPools
      },
      after: {
        transcriptionProvider: updated.transcriptionProvider,
        transcriptionModel: updated.transcriptionModel,
        summaryProvider: updated.summaryProvider,
        summaryModel: updated.summaryModel,
        pricingVersion: updated.pricingVersion,
        defaultDailyCloudQuotaUsd: updated.defaultDailyCloudQuotaUsd,
        liveMeetingReservationCapUsd: updated.liveMeetingReservationCapUsd,
        concurrencyPools: updated.concurrencyPools
      }
    });

    return response.status(200).json({
      transcriptionProvider: updated.transcriptionProvider,
      transcriptionModel: updated.transcriptionModel,
      summaryProvider: updated.summaryProvider,
      summaryModel: updated.summaryModel,
      pricingVersion: updated.pricingVersion,
      defaultDailyCloudQuotaUsd: updated.defaultDailyCloudQuotaUsd,
      liveMeetingReservationCapUsd: updated.liveMeetingReservationCapUsd,
      concurrencyPools: updated.concurrencyPools,
      updatedAt: updated.updatedAt,
      updatedBy: updated.updatedBy
    });
  });

  app.get('/api/admin/cloud-quota/overrides', async (request, response) => {
    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    return response.status(200).json({
      overrides: await operatorCloudQuotaOverrideRepository.listAll()
    });
  });

  app.put('/api/admin/cloud-quota/overrides', async (request, response) => {
    const parsedRequest = updateOperatorQuotaOverrideSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    const before = await operatorCloudQuotaOverrideRepository.getBySubmitterId(
      parsedRequest.data.submitterId
    );
    const saved = await operatorCloudQuotaOverrideRepository.upsert({
      submitterId: parsedRequest.data.submitterId,
      dailyQuotaUsd: parsedRequest.data.dailyQuotaUsd,
      updatedBy: authenticatedOperator.id
    });

    await appendAdminAuditEntry(authenticatedOperator, {
      action: 'cloud-quota-override.updated',
      target: parsedRequest.data.submitterId,
      before: before
        ? {
            dailyQuotaUsd: before.dailyQuotaUsd
          }
        : undefined,
      after: {
        dailyQuotaUsd: saved.dailyQuotaUsd
      }
    });

    return response.status(200).json(saved);
  });

  app.get('/api/admin/audit-log', async (request, response) => {
    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    return response.status(200).json({
      entries: await adminAuditLogRepository.listRecent(50)
    });
  });

  app.get('/api/admin/cloud-usage/report', async (request, response) => {
    const parsedQuery = adminCloudUsageReportQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedQuery.error.issues[0]?.message ?? 'The request query is invalid.'
        }
      });
    }

    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    const currentPolicy = await transcriptionProviderSettingsRepository.getCurrent();
    const quotaDayKey = parsedQuery.data.quotaDayKey ?? buildQuotaDayKey(new Date());
    const [entries, jobs] = await Promise.all([
      cloudUsageLedgerRepository.listByQuotaDayKey(quotaDayKey),
      repository.listByQuotaDayKey(quotaDayKey)
    ]);
    const submitterIds = [...new Set([...entries, ...jobs].map((item) => item.submitterId))].sort();

    const rows = await Promise.all(
      submitterIds.map(async (submitterId) => {
        const override = await operatorCloudQuotaOverrideRepository.getBySubmitterId(submitterId);
        const user = await authenticatedUserRepository?.getById(submitterId);
        const dailyQuotaUsd = override?.dailyQuotaUsd ?? currentPolicy.defaultDailyCloudQuotaUsd;
        const reservedUsd = sumReservedUsd(jobs, submitterId, quotaDayKey);
        const consumedUsd = sumActualConsumedUsd(entries, submitterId, quotaDayKey);

        return {
          submitterId,
          email: user?.email,
          dailyQuotaUsd,
          reservedUsd,
          consumedUsd,
          remainingUsd: calculateRemainingCloudQuotaUsd({
            dailyQuotaUsd,
            reservedUsd,
            consumedUsd
          }),
          entries: entries
            .filter((entry) => entry.submitterId === submitterId)
            .map((entry) => ({
              stage: entry.stage,
              provider: entry.provider,
              model: entry.model,
              entryType: entry.entryType,
              costUsd: entry.costUsd,
              usageQuantity: entry.usageQuantity,
              usageUnit: entry.usageUnit,
              createdAt: entry.createdAt
            }))
        };
      })
    );

    return response.status(200).json({
      quotaDayKey,
      totals: {
        operatorCount: rows.length,
        reservedUsd: roundUsd(rows.reduce((total, row) => total + row.reservedUsd, 0)),
        consumedUsd: roundUsd(rows.reduce((total, row) => total + row.consumedUsd, 0))
      },
      rows
    });
  });

  app.get('/api/admin/transcription-provider', async (request, response) => {
    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    const currentProvider = await transcriptionProviderSettingsRepository.getCurrent();

    return response.status(200).json({
      currentProvider: currentProvider.transcriptionProvider,
      currentSummaryModel: currentProvider.summaryModel,
      updatedAt: currentProvider.updatedAt,
      updatedBy: currentProvider.updatedBy,
      options: transcriptionProviderCatalog.options.map((option) => ({
        value: option.value,
        label: option.label,
        ready: option.ready,
        ...(option.reason ? { reason: option.reason } : {})
      }))
    });
  });

  app.get('/api/admin/summary-model', async (request, response) => {
    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    const currentSettings = await transcriptionProviderSettingsRepository.getCurrent();

    return response.status(200).json({
      summaryModel: currentSettings.summaryModel,
      summaryProvider: currentSettings.summaryProvider,
      updatedAt: currentSettings.updatedAt,
      updatedBy: currentSettings.updatedBy
    });
  });

  app.put('/api/admin/transcription-provider', async (request, response) => {
    const parsedRequest = updateTranscriptionProviderSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    if (!transcriptionProviderCatalog.isReady(parsedRequest.data.provider)) {
      return response.status(409).json({
        error: {
          code: 'transcription-provider-not-ready',
          message:
            transcriptionProviderCatalog.readinessReason(parsedRequest.data.provider) ??
            'The requested transcription provider is not ready.'
        }
      });
    }

    const before = await transcriptionProviderSettingsRepository.getCurrent();
    const currentProvider = await transcriptionProviderSettingsRepository.setCurrent({
      provider: parsedRequest.data.provider,
      updatedBy: authenticatedOperator.id
    });

    await appendAdminAuditEntry(authenticatedOperator, {
      action: 'transcription-provider.updated',
      target: 'ai-policy.transcriptionProvider',
      before: {
        transcriptionProvider: before.transcriptionProvider
      },
      after: {
        transcriptionProvider: currentProvider.transcriptionProvider
      }
    });

    return response.status(200).json({
      currentProvider: currentProvider.transcriptionProvider,
      currentSummaryModel: currentProvider.summaryModel,
      updatedAt: currentProvider.updatedAt,
      updatedBy: currentProvider.updatedBy
    });
  });

  app.put('/api/admin/summary-model', async (request, response) => {
    const parsedRequest = updateSummaryModelSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    const before = await transcriptionProviderSettingsRepository.getCurrent();
    const currentSettings = await transcriptionProviderSettingsRepository.setSummaryModel({
      summaryModel: parsedRequest.data.summaryModel,
      updatedBy: authenticatedOperator.id
    });

    await appendAdminAuditEntry(authenticatedOperator, {
      action: 'summary-model.updated',
      target: 'ai-policy.summaryModel',
      before: {
        summaryModel: before.summaryModel
      },
      after: {
        summaryModel: currentSettings.summaryModel
      }
    });

    return response.status(200).json({
      summaryModel: currentSettings.summaryModel,
      updatedAt: currentSettings.updatedAt,
      updatedBy: currentSettings.updatedBy
    });
  });

  app.get('/api/operator/quota', async (request, response) => {
    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      typeof request.query.submitterId === 'string' ? request.query.submitterId : undefined
    );

    if (!submitterId) {
      return;
    }

    const quotaStatus = await getQuotaStatusForSubmitter(submitterId);

    return response.status(200).json(quotaStatus);
  });

  app.get('/api/operator/config', (_request, response) => {
    response.status(200).json({
      defaultJoinName: DEFAULT_JOIN_NAME,
      maxActiveProcessingPerSubmitter: 1,
      submissionTemplates: operatorWorkflowTemplates,
      cloudQuotaEnabled: true,
      notifications: {
        emailConfigured: Boolean(jobNotificationSender)
      }
    });
  });

  app.get('/api/operator/jobs', async (request, response) => {
    const parsedQuery = operatorJobsQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedQuery.error.issues[0]?.message ?? 'The request query is invalid.'
        }
      });
    }

    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      parsedQuery.data.submitterId
    );

    if (!submitterId) {
      return;
    }

    const jobs = (await repository.listBySubmitter(submitterId)).filter((job) =>
      jobMatchesSearchQuery(job, parsedQuery.data.q)
    );
    const meetingBotBusy = await cleanupStaleMeetingJobsIfIdle();
    const refreshedJobs = (await repository.listBySubmitter(submitterId)).filter((job) =>
      jobMatchesSearchQuery(job, parsedQuery.data.q)
    );
    const jobsWithActualCost = await Promise.all(
      refreshedJobs.map(async (job) => {
        const ledgerEntries = await cloudUsageLedgerRepository.listByJob(job.id);
        const actualTranscriptionCostUsd = roundUsd(
          ledgerEntries
            .filter((entry) => entry.entryType === 'actual' && entry.stage === 'transcription')
            .reduce((total, entry) => total + entry.costUsd, 0)
        );
        const actualSummaryCostUsd = roundUsd(
          ledgerEntries
            .filter((entry) => entry.entryType === 'actual' && entry.stage === 'summary')
            .reduce((total, entry) => total + entry.costUsd, 0)
        );
        const actualCloudCostUsd = roundUsd(
          actualTranscriptionCostUsd + actualSummaryCostUsd
        );

        return {
          ...job,
          actualTranscriptionCostUsd,
          actualSummaryCostUsd,
          actualCloudCostUsd
        };
      })
    );

    return response.status(200).json({
      jobs: jobsWithActualCost.map((job) =>
        toApiRecordingJob({
          ...job,
          displayState: deriveDisplayState(job, meetingBotBusy)
        })
      )
    });
  });

  app.get('/api/operator/jobs/:id/export', async (request, response) => {
    const parsedQuery = operatorJobExportQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedQuery.error.issues[0]?.message ?? 'The request query is invalid.'
        }
      });
    }

    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      parsedQuery.data.submitterId
    );

    if (!submitterId) {
      return;
    }

    const job = await repository.getById(request.params.id);

    if (!job || job.submitterId !== submitterId) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    if (!job.transcriptArtifact && !job.summaryArtifact) {
      return response.status(409).json({
        error: {
          code: 'archive-export-unavailable',
          message: 'This job does not have exportable transcript or summary data yet.'
        }
      });
    }

    const baseName = buildExportBaseName(job);

    if (parsedQuery.data.format === 'markdown') {
      response.setHeader('Content-Disposition', `attachment; filename="${baseName}.md"`);
      response.type('text/markdown; charset=utf-8');
      return response.status(200).send(renderMarkdownExport(job));
    }

    if (parsedQuery.data.format === 'txt') {
      response.setHeader('Content-Disposition', `attachment; filename="${baseName}.txt"`);
      response.type('text/plain; charset=utf-8');
      return response.status(200).send(renderTextExport(job));
    }

    if (parsedQuery.data.format === 'srt') {
      if (!job.transcriptArtifact?.segments.length) {
        return response.status(409).json({
          error: {
            code: 'archive-export-unavailable',
            message: 'SRT export requires transcript segments.'
          }
        });
      }

      response.setHeader('Content-Disposition', `attachment; filename="${baseName}.srt"`);
      response.type('application/x-subrip; charset=utf-8');
      return response.status(200).send(renderSrtExport(job));
    }

    response.setHeader('Content-Disposition', `attachment; filename="${baseName}.json"`);
    response.type('application/json; charset=utf-8');
    return response.status(200).send({
      job: toApiRecordingJob(job),
      summary: job.summaryArtifact ?? null,
      transcript: job.transcriptArtifact ?? null
    });
  });

  app.post('/api/operator/jobs/:id/cancel', async (request, response) => {
    const parsedRequest = operatorStopRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      parsedRequest.data.submitterId
    );

    if (!submitterId) {
      return;
    }

    const job = await repository.getById(request.params.id);

    if (!job || job.submitterId !== submitterId) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    if (job.inputSource === 'meeting-link' && (job.state === 'joining' || job.state === 'recording')) {
      return response.status(409).json({
        error: {
          code: 'operator-job-cancel-unsupported',
          message: 'Use Exit Meeting for live meeting jobs.'
        }
      });
    }

    if (job.state !== 'queued' && job.state !== 'transcribing') {
      return response.status(409).json({
        error: {
          code: 'operator-job-not-interruptible',
          message: 'Only queued or transcribing jobs can be interrupted.'
        }
      });
    }

    const savedJob = await saveJob(
      markRecordingJobFailed(job, {
        code: 'operator-cancel-requested',
        message: 'The operator requested the job to stop immediately.'
      })
    );

    return response.status(202).json(toApiRecordingJob(savedJob));
  });

  app.delete('/api/operator/jobs/:id', async (request, response) => {
    const parsedRequest = operatorStopRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      parsedRequest.data.submitterId
    );

    if (!submitterId) {
      return;
    }

    const job = await repository.getById(request.params.id);

    if (!job || job.submitterId !== submitterId) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    if (!isTerminalJobState(job.state)) {
      return response.status(409).json({
        error: {
          code: 'operator-job-not-terminal',
          message: 'Only completed or failed jobs can be deleted from operator history.'
        }
      });
    }

    await repository.deleteTerminalJobForSubmitter(job.id, submitterId);

    return response.status(204).send();
  });

  app.post('/api/operator/jobs/clear-history', async (request, response) => {
    const parsedRequest = operatorStopRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      parsedRequest.data.submitterId
    );

    if (!submitterId) {
      return;
    }

    const deletedCount = await repository.clearTerminalHistoryForSubmitter(submitterId);

    return response.status(200).json({
      deletedCount
    });
  });

  app.post('/api/operator/jobs/meetings', async (request, response) => {
    const parsedRequest = operatorMeetingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      parsedRequest.data.submitterId
    );

    if (!submitterId) {
      return;
    }

    const supportResult = evaluateMeetingLinkPolicy(parsedRequest.data.meetingUrl);

    if (!supportResult.supported) {
      return response.status(422).json({
        error: {
          code: supportResult.code,
          message: supportResult.message
        }
      });
    }

    const workflowTemplate = getOperatorWorkflowTemplate(parsedRequest.data.submissionTemplateId);
    const policySnapshot = await buildPolicySnapshotForJob({
      submitterId,
      inputSource: 'meeting-link'
    });

    if (!policySnapshot.accepted) {
      return response
        .status(409)
        .json(
          quotaExceededResponse(
            policySnapshot.quotaStatus.remainingUsd,
            policySnapshot.estimatedCloudReservationUsd
          )
        );
    }

    const job = await saveJob(
      createRecordingJob({
        meetingUrl: parsedRequest.data.meetingUrl,
        platform: supportResult.platform,
        inputSource: 'meeting-link',
        submitterId,
        requestedJoinName: resolveRequestedJoinName(
          parsedRequest.data.requestedJoinName,
          workflowTemplate.requestedJoinName
        ),
        submissionTemplateId: workflowTemplate.id,
        summaryProfile: workflowTemplate.summaryProfile,
        preferredExportFormat: workflowTemplate.preferredExportFormat,
        transcriptionProvider: policySnapshot.policy.transcriptionProvider,
        transcriptionModel: policySnapshot.policy.transcriptionModel,
        summaryProvider: policySnapshot.policy.summaryProvider,
        summaryModel: policySnapshot.policy.summaryModel,
        pricingVersion: policySnapshot.policy.pricingVersion,
        estimatedCloudReservationUsd: policySnapshot.estimatedCloudReservationUsd,
        reservedCloudQuotaUsd: policySnapshot.estimatedCloudReservationUsd,
        quotaDayKey: policySnapshot.quotaStatus.quotaDayKey
      })
    );

    return response.status(201).json(toApiRecordingJob(job));
  });

  app.post('/api/operator/jobs/uploads', upload.single('audio'), async (request, response) => {
    if (!uploadedAudioStorage) {
      return response.status(503).json({
        error: {
          code: 'upload-storage-unavailable',
          message: 'Uploaded audio storage is not configured.'
        }
      });
    }

    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      typeof request.body.submitterId === 'string' ? request.body.submitterId : undefined
    );

    if (!submitterId) {
      return;
    }

    const file = request.file;

    if (!file) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: 'audio file is required.'
        }
      });
    }

    if (!file.mimetype.startsWith('audio/') && !file.mimetype.startsWith('video/')) {
      return response.status(400).json({
        error: {
          code: 'unsupported-audio-upload',
          message: 'Only audio or video uploads are supported.'
        }
      });
    }

    const normalizedFileName = normalizeUploadedFileName(file.originalname);
    const workflowTemplate = getOperatorWorkflowTemplate(
      typeof request.body.submissionTemplateId === 'string'
        ? request.body.submissionTemplateId
        : undefined
    );
    const policySnapshot = await buildPolicySnapshotForJob({
      submitterId,
      inputSource: 'uploaded-audio'
    });

    if (!policySnapshot.accepted) {
      return response
        .status(409)
        .json(
          quotaExceededResponse(
            policySnapshot.quotaStatus.remainingUsd,
            policySnapshot.estimatedCloudReservationUsd
          )
        );
    }

    let job = createRecordingJob({
      meetingUrl: buildUploadedAudioMeetingUrl(normalizedFileName),
      platform: 'uploaded-audio',
      inputSource: 'uploaded-audio',
      submitterId,
      requestedJoinName: workflowTemplate.requestedJoinName,
      submissionTemplateId: workflowTemplate.id,
      summaryProfile: workflowTemplate.summaryProfile,
      preferredExportFormat: workflowTemplate.preferredExportFormat,
      uploadedFileName: normalizedFileName,
      transcriptionProvider: policySnapshot.policy.transcriptionProvider,
      transcriptionModel: policySnapshot.policy.transcriptionModel,
      summaryProvider: policySnapshot.policy.summaryProvider,
      summaryModel: policySnapshot.policy.summaryModel,
      pricingVersion: policySnapshot.policy.pricingVersion,
      estimatedCloudReservationUsd: policySnapshot.estimatedCloudReservationUsd,
      reservedCloudQuotaUsd: policySnapshot.estimatedCloudReservationUsd,
      quotaDayKey: policySnapshot.quotaStatus.quotaDayKey
    });

    const recordingArtifact = await uploadedAudioStorage.storeUpload({
      jobId: job.id,
      submitterId,
      originalName: normalizedFileName,
      contentType: file.mimetype,
      bytes: file.buffer
    });

    job = attachQueuedRecordingArtifact(job, recordingArtifact);
    job = await saveJob(job);

    return response.status(201).json(toApiRecordingJob(job));
  });

  app.post('/api/operator/stop-current', async (request, response) => {
    const parsedRequest = operatorStopRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      parsedRequest.data.submitterId
    );

    if (!submitterId) {
      return;
    }

    if (!meetingBotController) {
      return response.status(503).json({
        error: {
          code: 'meeting-bot-stop-unavailable',
          message: 'Meeting bot stop control is not configured.'
        }
      });
    }

    const jobs = await repository.listBySubmitter(submitterId);
    const activeMeetingJob = jobs.find(
      (job) =>
        job.inputSource === 'meeting-link' &&
        (job.state === 'joining' || job.state === 'recording')
    );

    if (!activeMeetingJob) {
      return response.status(409).json({
        error: {
          code: 'no-active-meeting-job',
          message: 'No active meeting bot was found for this operator.'
        }
      });
    }

    await meetingBotController.stopCurrentBot();

    const savedJob = await saveJob(
      updateRecordingJobProgress(activeMeetingJob, {
        processingStage: 'finalizing-recording',
        processingMessage:
          'The operator requested the meeting bot to leave and finalize the recording.'
      })
    );

    return response.status(202).json({
      job: toApiRecordingJob(savedJob)
    });
  });

  app.post('/recording-jobs', async (request, response) => {
    const parsedRequest = createRecordingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const supportResult = evaluateMeetingLinkPolicy(parsedRequest.data.meetingUrl);

    if (!supportResult.supported) {
      return response.status(422).json({
        error: {
          code: supportResult.code,
          message: supportResult.message
        }
      });
    }

    const policySnapshot = await buildPolicySnapshotForJob({
      submitterId: 'anonymous',
      inputSource: 'meeting-link'
    });

    if (!policySnapshot.accepted) {
      return response
        .status(409)
        .json(
          quotaExceededResponse(
            policySnapshot.quotaStatus.remainingUsd,
            policySnapshot.estimatedCloudReservationUsd
          )
        );
    }

    const job = await saveJob(
      createRecordingJob({
        meetingUrl: parsedRequest.data.meetingUrl,
        platform: supportResult.platform,
        inputSource: 'meeting-link',
        transcriptionProvider: policySnapshot.policy.transcriptionProvider,
        transcriptionModel: policySnapshot.policy.transcriptionModel,
        summaryProvider: policySnapshot.policy.summaryProvider,
        summaryModel: policySnapshot.policy.summaryModel,
        pricingVersion: policySnapshot.policy.pricingVersion,
        estimatedCloudReservationUsd: policySnapshot.estimatedCloudReservationUsd,
        reservedCloudQuotaUsd: policySnapshot.estimatedCloudReservationUsd,
        quotaDayKey: policySnapshot.quotaStatus.quotaDayKey
      })
    );

    return response.status(201).json(toApiRecordingJob(job));
  });

  app.post('/recording-workers/claims', async (request, response) => {
    const parsedRequest = claimRecordingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const meetingBotBusy = await cleanupStaleMeetingJobsIfIdle();

    if (meetingBotBusy) {
      return response.status(204).send();
    }

    const claimedJob = await repository.claimNextQueued(parsedRequest.data.workerId);

    if (!claimedJob) {
      return response.status(204).send();
    }

    return response.status(200).json(toApiRecordingJob(claimedJob));
  });

  app.post('/transcription-workers/claims', async (request, response) => {
    const parsedRequest = claimRecordingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const activeJobs = await repository.listActiveProcessingJobs();
    const nowMs = Date.now();
    const staleJobs = activeJobs.filter((job) =>
      isStaleTranscriptionJob(job, staleTranscriptionJobAfterMs, nowMs)
    );

    await Promise.all(
      staleJobs.map((job) =>
        saveJob(releaseTranscriptionJobForRetry(job, staleTranscriptionFailure, maxTranscriptionAttempts))
      )
    );

    const currentPolicy = await transcriptionProviderSettingsRepository.getCurrent();
    const activeTranscriptions = (await repository.listActiveProcessingJobs()).filter(
      (job) =>
        job.state === 'transcribing' &&
        Boolean(job.assignedTranscriptionWorkerId) &&
        !job.transcriptArtifact
    );
    const activeLocalTranscriptions = activeTranscriptions.filter(
      (job) =>
        !job.transcriptionProvider || !isCloudTranscriptionProvider(job.transcriptionProvider)
    );
    const activeCloudTranscriptions = activeTranscriptions.filter(
      (job) =>
        typeof job.transcriptionProvider === 'string' &&
        isCloudTranscriptionProvider(job.transcriptionProvider)
    );
    const allowedProviders = transcriptionProviders.filter((provider) =>
      isCloudTranscriptionProvider(provider)
        ? activeCloudTranscriptions.length < currentPolicy.concurrencyPools.cloudTranscription
        : activeLocalTranscriptions.length < currentPolicy.concurrencyPools.localTranscription
    );

    if (allowedProviders.length === 0) {
      return response.status(204).send();
    }

    const claimedJob = await repository.claimNextTranscriptionReady(
      parsedRequest.data.workerId,
      allowedProviders
    );

    if (!claimedJob) {
      return response.status(204).send();
    }

    return response.status(200).json(toApiRecordingJob(claimedJob));
  });

  app.post('/transcription-workers/summary-claims', async (request, response) => {
    const parsedRequest = claimSummarySlotRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await repository.getById(parsedRequest.data.jobId);

    if (!job) {
      return response.status(404).json(notFoundResponse(parsedRequest.data.jobId));
    }

    if (!job.transcriptArtifact || job.summaryArtifact) {
      return response.status(409).json({
        error: {
          code: 'summary-slot-unavailable',
          message: 'The requested job is not waiting for summary generation.'
        }
      });
    }

    const currentPolicy = await transcriptionProviderSettingsRepository.getCurrent();
    const summaryProvider = job.summaryProvider ?? currentPolicy.summaryProvider;
    const summaryJobs = await repository.listGeneratingSummaryJobs();
    const nowMs = Date.now();
    const liveSummaryJobs = summaryJobs.filter((candidate) => {
      const updatedAtMs = Date.parse(candidate.updatedAt);

      if (candidate.id === job.id) {
        return false;
      }

      if (Number.isNaN(updatedAtMs)) {
        return true;
      }

      return nowMs - updatedAtMs < staleTranscriptionJobAfterMs;
    });
    const activeLocalSummaries = liveSummaryJobs.filter(
      (candidate) => !candidate.summaryProvider || !isCloudSummaryProvider(candidate.summaryProvider)
    );
    const activeCloudSummaries = liveSummaryJobs.filter(
      (candidate) =>
        typeof candidate.summaryProvider === 'string' &&
        isCloudSummaryProvider(candidate.summaryProvider)
    );
    const summaryPoolAvailable = isCloudSummaryProvider(summaryProvider)
      ? activeCloudSummaries.length < currentPolicy.concurrencyPools.cloudSummary
      : activeLocalSummaries.length < currentPolicy.concurrencyPools.localSummary;

    if (!summaryPoolAvailable && job.processingStage !== 'generating-summary') {
      return response.status(204).send();
    }

    if (job.processingStage === 'generating-summary') {
      return response.status(200).json(toApiRecordingJob(job));
    }

    const savedJob = await saveJob(
      updateRecordingJobProgress(job, {
        processingStage: 'generating-summary',
        processingMessage: isCloudSummaryProvider(summaryProvider)
          ? 'Waiting on cloud summary execution.'
          : 'Waiting on local summary execution.'
      })
    );

    return response.status(200).json(toApiRecordingJob(savedJob));
  });

  app.post('/integrations/meeting-bot/completions', async (request, response) => {
    const parsedPayload = meetingBotCompletionSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedPayload.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await repository.getById(parsedPayload.data.metadata.botId);

    if (!job) {
      return response.status(404).json(notFoundResponse(parsedPayload.data.metadata.botId));
    }

    const storageKey = deriveStorageKeyFromCompletionPayload(parsedPayload.data);

    if (!storageKey) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: 'The completion payload must include either metadata.storage.key or blobUrl.'
        }
      });
    }

    const savedJob = await saveJob(
      attachRecordingArtifact(job, {
        storageKey,
        downloadUrl:
          parsedPayload.data.blobUrl ??
          parsedPayload.data.metadata.storage?.url ??
          parsedPayload.data.meetingLink,
        contentType: parsedPayload.data.metadata.contentType
      })
    );

    return response.status(202).json(toApiRecordingJob(savedJob));
  });

  app.patch('/v2/meeting/app/bot/status', async (request, response) => {
    const parsedPayload = meetingBotStatusSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedPayload.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await repository.getById(parsedPayload.data.botId);

    if (!job) {
      return response.status(404).json(notFoundResponse(parsedPayload.data.botId));
    }

    if (
      parsedPayload.data.status.includes('failed') &&
      shouldApplyMeetingBotFailure(job.state) &&
      !isFinalizingMeetingRecording(job)
    ) {
      await saveJob(markRecordingJobFailed(job, genericMeetingBotFailure));
    }

    return response.status(200).json({ success: true });
  });

  app.patch('/v2/meeting/app/bot/log', async (request, response) => {
    const parsedPayload = meetingBotLogSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedPayload.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await repository.getById(parsedPayload.data.botId);

    if (!job) {
      return response.status(404).json(notFoundResponse(parsedPayload.data.botId));
    }

    if (
      parsedPayload.data.level.toLowerCase() === 'error' &&
      shouldApplyMeetingBotFailureDetails(job.state) &&
      !isFinalizingMeetingRecording(job)
    ) {
      await saveJob(markRecordingJobFailed(job, deriveMeetingBotLogFailure(parsedPayload.data)));
    }

    return response.status(200).json({ success: true });
  });

  app.post('/recording-jobs/:id/events', async (request, response) => {
    const parsedEvent = recordingJobEventSchema.safeParse(request.body);

    if (!parsedEvent.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedEvent.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await repository.getById(request.params.id);

    if (!job) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    if (job.state === 'failed' && job.failureCode === 'operator-cancel-requested') {
      return response.status(202).json(toApiRecordingJob(job));
    }

    const updatedJob =
      parsedEvent.data.type === 'state-updated'
        ? transitionRecordingJobState(job, parsedEvent.data.state)
        : parsedEvent.data.type === 'recording-artifact-stored'
          ? attachRecordingArtifact(job, parsedEvent.data.recordingArtifact)
          : parsedEvent.data.type === 'transcript-artifact-stored'
            ? attachTranscriptArtifact(job, parsedEvent.data.transcriptArtifact)
            : parsedEvent.data.type === 'summary-artifact-stored'
              ? attachSummaryArtifact(job, parsedEvent.data.summaryArtifact)
            : parsedEvent.data.type === 'progress-updated'
              ? updateRecordingJobProgress(job, {
                  processingStage: parsedEvent.data.processingStage,
                  processingMessage: parsedEvent.data.processingMessage,
                  progressPercent: parsedEvent.data.progressPercent,
                  progressProcessedMs: parsedEvent.data.progressProcessedMs,
                  progressTotalMs: parsedEvent.data.progressTotalMs
                })
            : parsedEvent.data.type === 'transcription-failed'
              ? releaseTranscriptionJobForRetry(job, parsedEvent.data.failure, maxTranscriptionAttempts)
              : markRecordingJobFailed(job, parsedEvent.data.failure);

    const savedJob = await saveJob(updatedJob);

    if (
      parsedEvent.data.type === 'transcript-artifact-stored' ||
      parsedEvent.data.type === 'summary-artifact-stored'
    ) {
      await appendActualUsageFromEvent(savedJob, parsedEvent.data);
    }

    return response.status(202).json(toApiRecordingJob(savedJob));
  });

  app.get('/recording-jobs/:id', async (request, response) => {
    const job = await repository.getById(request.params.id);

    if (!job) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    return response.status(200).json(toApiRecordingJob(job));
  });

  app.use(express.static(publicDir));

  app.get('/admin', (_request, response) => {
    response.sendFile(resolve(publicDir, 'admin.html'));
  });

  app.get('/', (_request, response) => {
    response.sendFile(resolve(publicDir, 'index.html'));
  });

  return app;
};
