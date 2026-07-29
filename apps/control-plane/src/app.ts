import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import type { AdminAuditLogRepository } from './domain/admin-audit-log-repository.js';
import type { AuthenticatedUserRepository } from './domain/authenticated-user-repository.js';
import {
  buildQuotaDayKey,
  calculateAzureResponsesCost,
  calculateAzureTranscriptionActualCost,
  calculateRemainingCloudQuotaUsd,
  estimateCloudReservationUsd,
  isValidIsoDate,
  roundUsd,
  sumActualConsumedUsd,
  sumReservedUsd
} from './domain/cloud-usage.js';
import {
  CloudUsageLedgerConflictError,
  type CloudUsageLedgerRepository
} from './domain/cloud-usage-ledger-repository.js';
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
  createRecordingJob,
  DEFAULT_JOIN_NAME,
  DEFAULT_WORKER_LEASE_DURATION_MS,
  markMeetingRecordingInProgress,
  markMeetingJobWaitingForCapacity,
  markTerminalJobNotificationSent,
  markRecordingJobFailed,
  type RecordingJob,
  type TranscriptArtifact,
  releaseTranscriptionJobForRetry,
  transitionRecordingJobState,
  updateRecordingJobProgress
} from './domain/recording-job.js';
import {
  buildSummaryPreview,
  buildTranscriptPreview
} from './domain/recording-job-list-item.js';
import { buildRuntimeHealthReport } from './domain/runtime-health-report.js';
import {
  createAdminConsoleAuthFromEnvironment,
  type AdminConsoleAuth
} from './infrastructure/admin-console-auth.js';
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
import { createSummaryProviderCatalogFromEnvironment } from './infrastructure/summary-provider-catalog.js';
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
  meetingPasscode: z.string().trim().max(64).optional(),
  submissionTemplateId: z.enum(submissionTemplateIds).optional()
});

const transcriptionGlossarySchema = z
  .array(z.string().min(1).max(200))
  .max(50);

const parseTranscriptionGlossary = (value: unknown) => {
  if (value === undefined || value === '') {
    return transcriptionGlossarySchema.safeParse([]);
  }

  if (typeof value !== 'string' && !Array.isArray(value)) {
    return transcriptionGlossarySchema.safeParse(value);
  }

  const values = typeof value === 'string' ? [value] : value;
  if (!values.every((line): line is string => typeof line === 'string')) {
    return transcriptionGlossarySchema.safeParse(value);
  }

  return transcriptionGlossarySchema.safeParse([
    ...new Set(
      values
        .flatMap((line) => line.split(/\r?\n/))
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ]);
};

const operatorJobsQuerySchema = z.object({
  submitterId: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().trim().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
});

const adminCloudUsageReportQuerySchema = z.object({
  quotaDayKey: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
});

const adminLoginSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200)
});

const adminUsageHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional()
});

const readFiniteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

class CloudUsageSettlementMetadataError extends Error {
  constructor(jobId: string) {
    super(`Cloud usage for job ${jobId} cannot be settled without quota and pricing identity.`);
    this.name = 'CloudUsageSettlementMetadataError';
  }
}

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

const transcriptReviewFlagSchema = z.object({
  reason: z.string().min(1),
  originalText: z.string().min(1),
  candidates: z.array(z.string().min(1)),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  evidence: z.string().min(1).optional()
});

const transcriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1),
  rawText: z.string().min(1).optional(),
  displayText: z.string().min(1).optional(),
  language: z.string().min(2).optional(),
  languageConfidence: z.number().min(0).max(1).optional(),
  timingSource: z.enum(['provider', 'estimated']).optional(),
  speaker: z.string().min(1).optional(),
  speakerSource: z.string().min(1).optional(),
  speakerAlignmentScore: z.number().min(0).max(1).optional(),
  reviewFlags: z.array(transcriptReviewFlagSchema).optional()
});

const transcriptArtifactSchema = recordingArtifactSchema.extend({
  schemaVersion: z.literal(2).optional(),
  language: z.string().min(2),
  segments: z.array(transcriptSegmentSchema),
  speakerAttribution: z
    .object({
      provider: z.literal('azure-openai'),
      model: z.string().min(1),
      status: z.enum(['complete', 'partial', 'failed']),
      referenceCount: z.number().int().nonnegative().max(4),
      attributedSegmentCount: z.number().int().nonnegative(),
      totalSegmentCount: z.number().int().nonnegative(),
      failedChunkCount: z.number().int().nonnegative()
    })
    .optional()
});

const punctuationUsageSchema = z.object({
  provider: z.literal('azure-openai'),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  requestCount: z.number().int().nonnegative(),
  acceptedChunkCount: z.number().int().nonnegative(),
  fallbackChunkCount: z.number().int().nonnegative(),
  unmeteredRequestCount: z.number().int().nonnegative()
}).superRefine((usage, context) => {
  if (usage.cachedInputTokens > usage.inputTokens) {
    context.addIssue({
      code: 'custom',
      path: ['cachedInputTokens'],
      message: 'Cached input tokens cannot exceed input tokens.'
    });
  }

  if (usage.reasoningOutputTokens > usage.outputTokens) {
    context.addIssue({
      code: 'custom',
      path: ['reasoningOutputTokens'],
      message: 'Reasoning output tokens cannot exceed output tokens.'
    });
  }

  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
    context.addIssue({
      code: 'custom',
      path: ['totalTokens'],
      message: 'Total tokens must equal input tokens plus output tokens.'
    });
  }

  if (usage.unmeteredRequestCount > usage.requestCount) {
    context.addIssue({
      code: 'custom',
      path: ['unmeteredRequestCount'],
      message: 'Unmetered requests cannot exceed requests.'
    });
  }

  const chunkOutcomeCount = usage.acceptedChunkCount + usage.fallbackChunkCount;
  if (
    chunkOutcomeCount > usage.requestCount ||
    (usage.requestCount === 0) !== (chunkOutcomeCount === 0)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['acceptedChunkCount'],
      message: 'Chunk outcomes must be non-empty when requests exist and cannot exceed requests.'
    });
  }
});

const transcriptUsageSchema = z.object({
  audioMs: z.number().int().nonnegative().optional(),
  punctuation: punctuationUsageSchema.optional(),
  diarization: z
    .object({
      provider: z.literal('azure-openai'),
      model: z.string().min(1),
      audioMs: z.number().int().nonnegative(),
      requestCount: z.number().int().positive(),
      unmeteredRequestCount: z.number().int().nonnegative(),
      failedChunkCount: z.number().int().nonnegative()
    })
    .refine((usage) => usage.unmeteredRequestCount <= usage.requestCount, {
      message: 'Unmetered diarization requests cannot exceed total requests.',
      path: ['unmeteredRequestCount']
    })
    .optional()
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
  promptTokens: z.number().int().nonnegative(),
  cachedPromptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  reasoningCompletionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  providerRequestCount: z.number().int().positive().optional(),
  unmeteredRequestCount: z.number().int().nonnegative().optional()
}).superRefine((usage, context) => {
  if (usage.cachedPromptTokens > usage.promptTokens) {
    context.addIssue({
      code: 'custom',
      path: ['cachedPromptTokens'],
      message: 'Cached prompt tokens cannot exceed prompt tokens.'
    });
  }

  if (usage.reasoningCompletionTokens > usage.completionTokens) {
    context.addIssue({
      code: 'custom',
      path: ['reasoningCompletionTokens'],
      message: 'Reasoning completion tokens cannot exceed completion tokens.'
    });
  }

  if (usage.totalTokens !== usage.promptTokens + usage.completionTokens) {
    context.addIssue({
      code: 'custom',
      path: ['totalTokens'],
      message: 'Total tokens must equal prompt tokens plus completion tokens.'
    });
  }

  if (
    usage.providerRequestCount !== undefined &&
    (usage.unmeteredRequestCount ?? 0) > usage.providerRequestCount
  ) {
    context.addIssue({
      code: 'custom',
      path: ['unmeteredRequestCount'],
      message: 'Unmetered request count cannot exceed provider request count.'
    });
  }
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

const recordingJobEventSchema = z.intersection(
  z.object({
    leaseToken: z.string().min(1).optional()
  }),
  z.discriminatedUnion('type', [
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
      }),
      usage: transcriptUsageSchema.optional()
    }),
    z.object({
      type: z.literal('summary-failed'),
      failure: z.object({
        code: z.string().min(1),
        message: z.string().min(1)
      }),
      usage: summaryUsageSchema.optional()
    })
  ])
).superRefine((event, context) => {
  if (
    (event.type === 'transcript-artifact-stored' || event.type === 'transcription-failed') &&
    (event.usage?.punctuation || event.usage?.diarization) &&
    !event.leaseToken
  ) {
    context.addIssue({
      code: 'custom',
      path: ['leaseToken'],
      message: 'A lease token is required when reporting transcript provider usage.'
    });
  }
});

const leaseHeartbeatRequestSchema = z.object({
  stage: z.enum(['recording', 'transcription', 'summary']),
  leaseToken: z.string().min(1)
});

type AppOptions = {
  authenticatedUserRepository?: AuthenticatedUserRepository;
  transcriptionProviderSettingsRepository?: TranscriptionProviderSettingsRepository;
  transcriptionProviderCatalog?: TranscriptionProviderCatalog;
  summaryProviderCatalog?: SummaryProviderCatalog;
  operatorCloudQuotaOverrideRepository?: OperatorCloudQuotaOverrideRepository;
  cloudUsageLedgerRepository?: CloudUsageLedgerRepository;
  adminAuditLogRepository?: AdminAuditLogRepository;
  maxTranscriptionAttempts?: number;
  maxUploadBytes?: number;
  operatorAuth?: OperatorAuth;
  uploadedAudioStorage?: UploadedAudioStorage;
  meetingBotController?: MeetingBotController;
  meetingBotRuntimeMonitor?: MeetingBotRuntimeMonitor;
  jobNotificationSender?: JobNotificationSender;
  maxConcurrentTranscriptionJobs?: number;
  maxMeetingJobBacklog?: number;
  maxTranscriptionJobBacklog?: number;
  adminEmails?: string[];
  adminConsoleAuth?: AdminConsoleAuth;
  internalServiceToken?: string;
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
  transcriptionGlossary?: string[];
  state: string;
  processingStage?: string;
  processingMessage?: string;
  progressPercent?: number;
  progressProcessedMs?: number;
  progressTotalMs?: number;
  assignedWorkerId?: string;
  assignedTranscriptionWorkerId?: string;
  assignedSummaryWorkerId?: string;
  transcriptionProvider?: string;
  transcriptionModel?: string;
  summaryProvider?: string;
  summaryModel?: string;
  summaryRequested?: boolean;
  pricingVersion?: string;
  estimatedCloudReservationUsd?: number;
  reservedCloudQuotaUsd?: number;
  quotaDayKey?: string;
  actualTranscriptionCostUsd?: number;
  hasUnpricedTranscriptionUsage?: boolean;
  actualPunctuationCostUsd?: number;
  hasUnpricedPunctuationUsage?: boolean;
  actualSummaryCostUsd?: number;
  hasUnpricedSummaryUsage?: boolean;
  actualCloudCostUsd?: number | null;
  hasUnpricedUsage?: boolean;
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
  transcriptArtifact?: TranscriptArtifact;
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
  transcriptionGlossary: job.transcriptionGlossary ?? [],
  state: job.state,
  displayState: job.displayState,
  processingStage: job.processingStage,
  processingMessage: job.processingMessage,
  progressPercent: job.progressPercent,
  progressProcessedMs: job.progressProcessedMs,
  progressTotalMs: job.progressTotalMs,
  assignedWorkerId: job.assignedWorkerId,
  assignedTranscriptionWorkerId: job.assignedTranscriptionWorkerId,
  assignedSummaryWorkerId: job.assignedSummaryWorkerId,
  transcriptionProvider: job.transcriptionProvider,
  transcriptionModel: job.transcriptionModel,
  summaryProvider: job.summaryProvider,
  summaryModel: job.summaryModel,
  summaryRequested: job.summaryRequested,
  pricingVersion: job.pricingVersion,
  estimatedCloudReservationUsd: job.estimatedCloudReservationUsd,
  reservedCloudQuotaUsd: job.reservedCloudQuotaUsd,
  quotaDayKey: job.quotaDayKey,
  actualTranscriptionCostUsd: job.actualTranscriptionCostUsd,
  hasUnpricedTranscriptionUsage: job.hasUnpricedTranscriptionUsage,
  actualPunctuationCostUsd: job.actualPunctuationCostUsd,
  hasUnpricedPunctuationUsage: job.hasUnpricedPunctuationUsage,
  actualSummaryCostUsd: job.actualSummaryCostUsd,
  hasUnpricedSummaryUsage: job.hasUnpricedSummaryUsage,
  actualCloudCostUsd: job.actualCloudCostUsd,
  hasUnpricedUsage: job.hasUnpricedUsage,
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

const toOperatorJobListItem = (
  job: Parameters<typeof toApiRecordingJob>[0] & {
    hasTranscript?: boolean;
    hasSummary?: boolean;
    transcriptPreview?: string;
    summaryPreview?: string;
  }
) => ({
  ...toApiRecordingJob({
    ...job,
    jobHistory: undefined
  }),
  hasTranscript: job.hasTranscript ?? Boolean(job.transcriptArtifact),
  hasSummary: job.hasSummary ?? Boolean(job.summaryArtifact),
  transcriptPreview: job.transcriptPreview ?? buildTranscriptPreview(job.transcriptArtifact),
  summaryPreview: job.summaryPreview ?? buildSummaryPreview(job.summaryArtifact?.text)
});

const toWorkerClaimResponse = (
  job: RecordingJob,
  stage: 'recording' | 'transcription' | 'summary'
) => ({
  ...toApiRecordingJob(job),
  // Worker-only field: the operator/admin APIs (toApiRecordingJob) must never echo
  // the meeting passcode back to browsers.
  meetingPasscode: job.meetingPasscode,
  leaseToken:
    stage === 'recording'
      ? job.recordingLeaseToken
      : stage === 'transcription'
        ? job.transcriptionLeaseToken
        : job.summaryLeaseToken,
  leaseAcquiredAt:
    stage === 'recording'
      ? job.recordingLeaseAcquiredAt
      : stage === 'transcription'
        ? job.transcriptionLeaseAcquiredAt
        : job.summaryLeaseAcquiredAt,
  leaseHeartbeatAt:
    stage === 'recording'
      ? job.recordingLeaseHeartbeatAt
      : stage === 'transcription'
        ? job.transcriptionLeaseHeartbeatAt
        : job.summaryLeaseHeartbeatAt,
  leaseExpiresAt:
    stage === 'recording'
      ? job.recordingLeaseExpiresAt
      : stage === 'transcription'
        ? job.transcriptionLeaseExpiresAt
        : job.summaryLeaseExpiresAt
});

const encodeJobsCursor = (input: { createdAt: string; id: string }): string =>
  Buffer.from(JSON.stringify(input)).toString('base64url');

const decodeJobsCursor = (
  value: string
): { createdAt: string; id: string } | undefined => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      return undefined;
    }

    return {
      createdAt: parsed.createdAt,
      id: parsed.id
    };
  } catch {
    return undefined;
  }
};

const createSerialExecutor = () => {
  let tail = Promise.resolve();

  return async <T>(task: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await task();
    } finally {
      release();
    }
  };
};

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

const shouldApplyMeetingBotProgressDetails = (state: string): boolean =>
  ['queued', 'joining'].includes(state);

const isFinalizingMeetingRecording = (job: {
  inputSource: string;
  processingStage?: string;
  processingMessage?: string;
}): boolean =>
  job.inputSource === 'meeting-link' && job.processingStage === 'finalizing-recording';

const isFinalizingMeetingWithoutRecording = (job: {
  inputSource: string;
  processingStage?: string;
  recordingArtifact?: object;
}): boolean =>
  job.inputSource === 'meeting-link' &&
  job.processingStage === 'finalizing-recording' &&
  !job.recordingArtifact;

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

const meetingNotAdmittedFailure = {
  code: 'meeting-not-admitted',
  message: 'The meeting bot waited in the meeting lobby and was never admitted.'
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

const deriveMeetingBotLogProgress = (payload: z.infer<typeof meetingBotLogSchema>) => {
  if (payload.category === 'JoinRequest' && payload.subCategory === 'Submitted') {
    return {
      processingStage: 'waiting-for-host-admission',
      processingMessage: payload.message
    };
  }

  if (payload.category === 'Recording' && payload.subCategory === 'Started') {
    return {
      processingStage: 'recording',
      processingMessage: payload.message
    };
  }

  return undefined;
};

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

const renderTranscriptSegmentText = (segment: TranscriptArtifact['segments'][number]): string =>
  `${segment.speaker ? `${segment.speaker}: ` : ''}${segment.text}`;

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
    const summaryText = job.summaryArtifact.text.trim();
    parts.push('');

    // The generated summary already starts with its own "## Summary" heading,
    // so only prepend one when the text isn't already a Markdown document.
    if (!/^#{1,6}\s/.test(summaryText)) {
      parts.push('## Summary', '');
    }

    parts.push(summaryText);
  }

  if (job.transcriptArtifact?.segments.length) {
    parts.push(
      '',
      '## Transcript',
      '',
      ...job.transcriptArtifact.segments.map(
        (segment) =>
          `- [${formatSrtTimestamp(segment.startMs).replace(',', '.')}] ${renderTranscriptSegmentText(segment)}`
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
        (segment) =>
          `[${formatSrtTimestamp(segment.startMs)}] ${renderTranscriptSegmentText(segment)}`
      )
    );
  }

  return parts.join('\n');
};

const renderSrtExport = (job: RecordingJob): string =>
  (job.transcriptArtifact?.segments ?? [])
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTimestamp(segment.startMs)} --> ${formatSrtTimestamp(segment.endMs)}\n${renderTranscriptSegmentText(segment)}`
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

const deriveDisplayState = (
  job: { state: string; inputSource: string },
  _meetingBotBusy: boolean
): string => job.state;

const isLeaseExpiredOrStale = (
  input: {
    leaseHeartbeatAt?: string;
    leaseExpiresAt?: string;
    updatedAt: string;
  },
  staleAfterMs: number,
  nowMs: number
): boolean => {
  const expiresAtMs = input.leaseExpiresAt ? Date.parse(input.leaseExpiresAt) : Number.NaN;

  if (!Number.isNaN(expiresAtMs)) {
    return nowMs >= expiresAtMs;
  }

  const heartbeatAtMs = input.leaseHeartbeatAt ? Date.parse(input.leaseHeartbeatAt) : Number.NaN;

  if (!Number.isNaN(heartbeatAtMs)) {
    return nowMs - heartbeatAtMs >= staleAfterMs;
  }

  const updatedAtMs = Date.parse(input.updatedAt);

  if (Number.isNaN(updatedAtMs)) {
    return false;
  }

  return nowMs - updatedAtMs >= staleAfterMs;
};

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
    transcriptionLeaseHeartbeatAt?: string;
    transcriptionLeaseExpiresAt?: string;
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

  return isLeaseExpiredOrStale(
    {
      leaseHeartbeatAt: job.transcriptionLeaseHeartbeatAt,
      leaseExpiresAt: job.transcriptionLeaseExpiresAt,
      updatedAt: job.updatedAt
    },
    staleAfterMs,
    nowMs
  );
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
  const defaultQwenTranscriptionModel = process.env.QWEN_ASR_MODEL ?? 'qwen3-asr-1.7b';
  const defaultMaiTranscriptionModel =
    process.env.AZURE_SPEECH_MAI_MODEL ?? 'mai-transcribe-1.5';
  const defaultCloudTranscriptionModel =
    process.env.AZURE_OPENAI_DEPLOYMENT ?? 'gpt-4o-transcribe';
  const defaultTranscriptionModel =
    transcriptionProviderCatalog.defaultProvider === 'azure-openai-gpt-4o-transcribe'
      ? defaultCloudTranscriptionModel
      : transcriptionProviderCatalog.defaultProvider ===
          'azure-speech-mai-transcribe-1.5'
        ? defaultMaiTranscriptionModel
      : transcriptionProviderCatalog.defaultProvider === 'qwen3-asr-1.7b'
        ? defaultQwenTranscriptionModel
        : defaultLocalTranscriptionModel;
  const defaultSummaryModel = process.env.SUMMARY_MODEL ?? 'gpt-5.6-luna';
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
      defaultQwenTranscriptionModel,
      defaultMaiTranscriptionModel,
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
  const maxMeetingJobBacklog = Math.max(
    0,
    options.maxMeetingJobBacklog ?? Number(process.env.MAX_MEETING_JOB_BACKLOG ?? '2')
  );
  const maxTranscriptionJobBacklog = Math.max(
    0,
    options.maxTranscriptionJobBacklog ?? Number(process.env.MAX_TRANSCRIPTION_JOB_BACKLOG ?? '10')
  );
  const operatorAuth = options.operatorAuth;
  const uploadedAudioStorage = options.uploadedAudioStorage;
  const meetingBotController = options.meetingBotController;
  const meetingBotRuntimeMonitor = options.meetingBotRuntimeMonitor;
  const jobNotificationSender = options.jobNotificationSender;
  const internalServiceToken = options.internalServiceToken ?? process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalServiceToken) {
    console.warn(
      '[control-plane] INTERNAL_SERVICE_TOKEN is not set — internal worker and integration ' +
        'endpoints will accept UNAUTHENTICATED requests. Set INTERNAL_SERVICE_TOKEN before ' +
        'exposing this service.'
    );
  }
  const staleMeetingJobAfterMs = options.staleMeetingJobAfterMs ?? 10 * 60 * 1000;
  const staleMeetingFinalizationAfterMs =
    options.staleMeetingFinalizationAfterMs ?? 2 * 60 * 1000;
  const staleTranscriptionJobAfterMs = options.staleTranscriptionJobAfterMs ?? 15 * 60 * 1000;
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const publicDir = options.publicDir ?? resolve(currentDir, '../public');
  const runRecordingClaimSerially = createSerialExecutor();
  const runTranscriptionClaimSerially = createSerialExecutor();
  const runSummaryClaimSerially = createSerialExecutor();
  const adminEmails = new Set(
    (options.adminEmails ?? parseAdminEmails(process.env.ADMIN_EMAILS)).map((email) =>
      email.toLowerCase()
    )
  );
  const adminConsoleAuth = options.adminConsoleAuth ?? createAdminConsoleAuthFromEnvironment();
  const upload = multer({
    dest: tmpdir(),
    limits: {
      fileSize: options.maxUploadBytes ?? 512 * 1024 * 1024
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

  const internalServiceAuthRequiredResponse = {
    error: {
      code: 'internal-service-auth-required',
      message: 'A valid internal service credential is required.'
    }
  };

  const quotaExceededResponse = (remainingUsd: number, requiredUsd: number) => ({
    error: {
      code: 'cloud-quota-exceeded',
      message: `The daily cloud quota would be exceeded. Remaining: $${remainingUsd.toFixed(3)}, required: $${requiredUsd.toFixed(3)}.`
    }
  });

  const meetingCapacityExceededResponse = {
    error: {
      code: 'meeting-capacity-exceeded',
      message:
        'The live meeting queue is full right now. Please try again after current queued meetings drain.'
    }
  };

  const transcriptionCapacityExceededResponse = {
    error: {
      code: 'transcription-capacity-exceeded',
      message:
        'The transcription queue is full right now. Please try again after current queued jobs drain.'
    }
  };

  const hasValidInternalServiceCredential = (request: express.Request): boolean => {
    if (!internalServiceToken) {
      return true;
    }

    const headerToken =
      request.header('x-internal-service-token') ??
      request.header('x-internal-token') ??
      request.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
    const queryToken =
      typeof request.query.token === 'string' ? request.query.token : undefined;
    const pathToken =
      typeof request.params.internalToken === 'string' ? request.params.internalToken : undefined;

    return [headerToken, queryToken, pathToken].some((value) => value === internalServiceToken);
  };

  const requireInternalService = (
    request: express.Request,
    response: express.Response
  ): boolean => {
    if (hasValidInternalServiceCredential(request)) {
      return true;
    }

    response.status(401).json(internalServiceAuthRequiredResponse);
    return false;
  };

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
    const consumed = sumActualConsumedUsd(ledgerEntries, submitterId, quotaDayKey);
    const reservedUsd = sumReservedUsd(
      await repository.listBySubmitter(submitterId),
      submitterId,
      quotaDayKey
    );
    const remainingUsd = calculateRemainingCloudQuotaUsd({
      dailyQuotaUsd,
      consumedUsd: consumed.pricedCostUsd,
      reservedUsd
    });

    return {
      dailyQuotaUsd,
      consumedUsd: consumed.totalCostUsd,
      pricedConsumedUsd: consumed.pricedCostUsd,
      hasUnpricedUsage: consumed.hasUnpricedUsage,
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
    const summaryRequested = summaryProviderCatalog.isReady(currentPolicy.summaryProvider);
    const quotaStatus = await getQuotaStatusForSubmitter(input.submitterId);
    const estimatedCloudReservationUsd = estimateCloudReservationUsd(
      {
        inputSource: input.inputSource,
        transcriptionProvider: currentPolicy.transcriptionProvider,
        transcriptionModel: currentPolicy.transcriptionModel,
        summaryProvider: summaryRequested ? currentPolicy.summaryProvider : undefined
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
      summaryRequested,
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
    const requiresSettlement =
      ((event.type === 'transcript-artifact-stored' ||
        (event.type === 'transcription-failed' && event.usage?.audioMs !== undefined)) &&
        job.transcriptionProvider !== undefined &&
        isCloudTranscriptionProvider(job.transcriptionProvider)) ||
      ((event.type === 'transcript-artifact-stored' || event.type === 'transcription-failed') &&
        (event.usage?.punctuation !== undefined ||
          event.usage?.diarization !== undefined)) ||
      ((event.type === 'summary-artifact-stored' || event.type === 'summary-failed') &&
        event.usage !== undefined &&
        job.summaryProvider !== undefined &&
        isCloudSummaryProvider(job.summaryProvider));

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
        (event.type === 'transcription-failed' && event.usage?.audioMs !== undefined)) &&
      job.transcriptionProvider &&
      isCloudTranscriptionProvider(job.transcriptionProvider)
    ) {
      const audioMs =
        event.usage?.audioMs ?? job.progressTotalMs ?? job.progressProcessedMs ?? 0;
      const pricing = calculateAzureTranscriptionActualCost({ audioMs });

      await cloudUsageLedgerRepository.append({
        entryKey: `actual:${job.id}:transcription:${event.leaseToken!}`,
        jobId: job.id,
        submitterId: job.submitterId,
        quotaDayKey: job.quotaDayKey,
        entryType: 'actual',
        stage: 'transcription',
        provider: job.transcriptionProvider,
        model:
          job.transcriptionModel ??
          (event.type === 'transcript-artifact-stored'
            ? event.transcriptArtifact.language
            : 'unknown'),
        pricingVersion: job.pricingVersion,
        usageQuantity: audioMs,
        usageUnit: 'audio-ms',
        ...pricing,
        detail: { audioMs }
      });
    }

    if (
      (event.type === 'transcript-artifact-stored' || event.type === 'transcription-failed') &&
      event.usage?.punctuation
    ) {
      const usage = event.usage.punctuation;
      const pricing =
        usage.unmeteredRequestCount > 0
          ? ({ costUsd: null, pricingStatus: 'unpriced' } as const)
          : calculateAzureResponsesCost({
              model: usage.model,
              pricingVersion: job.pricingVersion,
              inputTokens: usage.inputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              outputTokens: usage.outputTokens,
              reasoningOutputTokens: usage.reasoningOutputTokens
            });

      await cloudUsageLedgerRepository.append({
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

    if (
      (event.type === 'transcript-artifact-stored' || event.type === 'transcription-failed') &&
      event.usage?.diarization
    ) {
      const usage = event.usage.diarization;
      await cloudUsageLedgerRepository.append({
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
      (event.type === 'summary-artifact-stored' || event.type === 'summary-failed') &&
      event.usage &&
      job.summaryProvider &&
      isCloudSummaryProvider(job.summaryProvider)
    ) {
      const {
        promptTokens,
        cachedPromptTokens,
        completionTokens,
        reasoningCompletionTokens,
        totalTokens,
        providerRequestCount,
        unmeteredRequestCount
      } = event.usage;
      const model =
        job.summaryModel ??
        (event.type === 'summary-artifact-stored' ? event.summaryArtifact.model : 'unknown');
      const pricing =
        (unmeteredRequestCount ?? 0) > 0
          ? ({ costUsd: null, pricingStatus: 'unpriced' } as const)
          : calculateAzureResponsesCost({
              model,
              pricingVersion: job.pricingVersion,
              inputTokens: promptTokens,
              cachedInputTokens: cachedPromptTokens,
              outputTokens: completionTokens,
              reasoningOutputTokens: reasoningCompletionTokens
            });

      await cloudUsageLedgerRepository.append({
        entryKey: `actual:${job.id}:summary:${event.leaseToken!}`,
        jobId: job.id,
        submitterId: job.submitterId,
        quotaDayKey: job.quotaDayKey,
        entryType: 'actual',
        stage: 'summary',
        provider: job.summaryProvider,
        model,
        pricingVersion: job.pricingVersion,
        usageQuantity: totalTokens,
        usageUnit: 'tokens',
        ...pricing,
        detail: {
          promptTokens,
          cachedPromptTokens,
          completionTokens,
          reasoningCompletionTokens,
          totalTokens,
          ...(providerRequestCount === undefined ? {} : { providerRequestCount }),
          ...(unmeteredRequestCount === undefined ? {} : { unmeteredRequestCount })
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
          saveJob(
            markRecordingJobFailed(
              job,
              isFinalizingMeetingWithoutRecording(job)
                ? meetingNotAdmittedFailure
                : staleMeetingBotFinalizationFailure
            )
          )
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

  const getMeetingCapacitySnapshot = async () => {
    const meetingBotBusy = await cleanupStaleMeetingJobsIfIdle();
    const activeJobs = await repository.listActiveProcessingJobs();
    const activeMeetingJobs = activeJobs.filter(
      (job) => job.inputSource === 'meeting-link' && (job.state === 'joining' || job.state === 'recording')
    );
    const queuedMeetingJobs = await repository.countQueuedMeetingJobs();
    const capacityBusy = meetingBotBusy || activeMeetingJobs.length > 0;

    return {
      capacityBusy,
      queuedMeetingJobs,
      nextBacklogSize: capacityBusy ? queuedMeetingJobs + 1 : queuedMeetingJobs
    };
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

  const readAdminConsoleToken = (request: express.Request): string | undefined => {
    const headerToken = request.header('x-admin-console-token');

    if (headerToken && headerToken.trim().length > 0) {
      return headerToken.trim();
    }

    const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    return bearer && bearer.length > 0 ? bearer : undefined;
  };

  const resolveAdminConsoleOperatorFromRequest = (
    request: express.Request
  ): AuthenticatedOperator | undefined => {
    const session = adminConsoleAuth.verifyToken(readAdminConsoleToken(request));
    return session ? adminConsoleAuth.toOperator() : undefined;
  };

  const requireAdminOperator = async (
    request: express.Request,
    response: express.Response
  ): Promise<AuthenticatedOperator | undefined> => {
    // The simple admin-console session (username/password login) takes priority and
    // works even when Supabase operator auth is disabled (guest mode).
    const consoleOperator = resolveAdminConsoleOperatorFromRequest(request);

    if (consoleOperator) {
      return consoleOperator;
    }

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

  const eventRequiresLeaseToken = (
    event: z.infer<typeof recordingJobEventSchema>
  ): boolean =>
    event.type === 'state-updated' ||
    event.type === 'recording-artifact-stored' ||
    event.type === 'progress-updated' ||
    event.type === 'transcript-artifact-stored' ||
    event.type === 'summary-artifact-stored' ||
    event.type === 'transcription-failed' ||
    event.type === 'summary-failed' ||
    event.type === 'failed';

  const resolveExpectedLeaseToken = (
    job: RecordingJob,
    event: z.infer<typeof recordingJobEventSchema>
  ): string | undefined => {
    if (
      event.type === 'state-updated' ||
      event.type === 'recording-artifact-stored' ||
      event.type === 'failed'
    ) {
      return job.recordingLeaseToken;
    }

    if (
      event.type === 'transcript-artifact-stored' ||
      event.type === 'transcription-failed' ||
      (event.type === 'progress-updated' &&
        event.processingStage !== 'generating-summary' &&
        job.processingStage !== 'generating-summary')
    ) {
      return job.transcriptionLeaseToken;
    }

    return job.summaryLeaseToken;
  };

  const isDuplicateTerminalStageEvent = (
    job: RecordingJob,
    event: z.infer<typeof recordingJobEventSchema>
  ): boolean =>
    (event.type === 'transcript-artifact-stored' && Boolean(job.transcriptArtifact)) ||
    (event.type === 'summary-artifact-stored' && Boolean(job.summaryArtifact));

  const hasSupersededLeaseToken = (
    job: RecordingJob,
    event: z.infer<typeof recordingJobEventSchema>
  ): boolean => {
    if (!eventRequiresLeaseToken(event) || !event.leaseToken) {
      return false;
    }

    const expectedLeaseToken = resolveExpectedLeaseToken(job, event);
    return expectedLeaseToken !== event.leaseToken;
  };

  const resolveCloudTerminalLeaseStage = (
    job: RecordingJob,
    event: z.infer<typeof recordingJobEventSchema>
  ): 'transcription' | 'summary' | undefined => {
    if (
      (event.type === 'transcript-artifact-stored' || event.type === 'transcription-failed') &&
      ((job.transcriptionProvider !== undefined &&
        isCloudTranscriptionProvider(job.transcriptionProvider)) ||
        event.usage?.punctuation !== undefined)
    ) {
      return 'transcription';
    }

    if (
      (event.type === 'summary-artifact-stored' || event.type === 'summary-failed') &&
      job.summaryProvider !== undefined &&
      isCloudSummaryProvider(job.summaryProvider)
    ) {
      return 'summary';
    }

    return undefined;
  };

  const wasCloudTerminalLeaseIssued = (
    job: RecordingJob,
    stage: 'transcription' | 'summary',
    leaseToken: string
  ): boolean => {
    const issuedLeaseTokens =
      stage === 'transcription'
        ? job.issuedTranscriptionLeaseTokens
        : job.issuedSummaryLeaseTokens;
    const activeLeaseToken =
      stage === 'transcription' ? job.transcriptionLeaseToken : job.summaryLeaseToken;

    return issuedLeaseTokens?.includes(leaseToken) === true || activeLeaseToken === leaseToken;
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

  app.post('/api/admin/login', (request, response) => {
    const parsedRequest = adminLoginSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: '請輸入帳號與密碼。'
        }
      });
    }

    if (
      !adminConsoleAuth.verifyCredentials(
        parsedRequest.data.username,
        parsedRequest.data.password
      )
    ) {
      return response.status(401).json({
        error: {
          code: 'admin-login-invalid',
          message: '帳號或密碼錯誤。'
        }
      });
    }

    const issued = adminConsoleAuth.issueToken();

    return response.status(200).json({
      token: issued.token,
      expiresAt: issued.expiresAt,
      username: adminConsoleAuth.username
    });
  });

  app.get('/api/admin/session', (request, response) => {
    const operator = resolveAdminConsoleOperatorFromRequest(request);

    if (!operator) {
      return response.status(401).json(authRequiredResponse);
    }

    return response.status(200).json({
      username: adminConsoleAuth.username,
      operatorId: operator.id
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
        const consumed = sumActualConsumedUsd(entries, submitterId, quotaDayKey);

        return {
          submitterId,
          email: user?.email,
          dailyQuotaUsd,
          reservedUsd,
          consumedUsd: consumed.totalCostUsd,
          pricedConsumedUsd: consumed.pricedCostUsd,
          hasUnpricedUsage: consumed.hasUnpricedUsage,
          remainingUsd: calculateRemainingCloudQuotaUsd({
            dailyQuotaUsd,
            reservedUsd,
            consumedUsd: consumed.pricedCostUsd
          }),
          entries: entries
            .filter((entry) => entry.submitterId === submitterId)
            .map((entry) => ({
              stage: entry.stage,
              provider: entry.provider,
              model: entry.model,
              entryType: entry.entryType,
              pricingStatus: entry.pricingStatus,
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
        pricedConsumedUsd: roundUsd(
          rows.reduce((total, row) => total + row.pricedConsumedUsd, 0)
        ),
        consumedUsd: rows.some((row) => row.hasUnpricedUsage)
          ? null
          : roundUsd(rows.reduce((total, row) => total + row.pricedConsumedUsd, 0)),
        hasUnpricedUsage: rows.some((row) => row.hasUnpricedUsage),
        unpricedEntryCount: entries.filter(
          (entry) => entry.entryType === 'actual' && entry.pricingStatus === 'unpriced'
        ).length
      },
      rows
    });
  });

  app.get('/api/admin/usage/history', async (request, response) => {
    const parsedQuery = adminUsageHistoryQuerySchema.safeParse(request.query);

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

    const limit = parsedQuery.data.limit ?? 500;
    const ledgerEntries = await cloudUsageLedgerRepository.listRecentEntries(limit);

    const entries = ledgerEntries.map((entry) => {
      const detail = entry.detail ?? {};
      const inputTokens =
        readFiniteNumber(detail.promptTokens) || readFiniteNumber(detail.inputTokens);
      const cachedInputTokens =
        readFiniteNumber(detail.cachedPromptTokens) ||
        readFiniteNumber(detail.cachedInputTokens);
      const outputTokens =
        readFiniteNumber(detail.completionTokens) || readFiniteNumber(detail.outputTokens);
      const reasoningOutputTokens =
        readFiniteNumber(detail.reasoningCompletionTokens) ||
        readFiniteNumber(detail.reasoningOutputTokens);
      const totalTokens =
        readFiniteNumber(detail.totalTokens) || inputTokens + outputTokens;
      const audioMs =
        entry.stage === 'transcription'
          ? readFiniteNumber(detail.audioMs) || readFiniteNumber(entry.usageQuantity)
          : 0;

      return {
        id: entry.id,
        createdAt: entry.createdAt,
        quotaDayKey: entry.quotaDayKey,
        jobId: entry.jobId,
        submitterId: entry.submitterId,
        stage: entry.stage,
        provider: entry.provider,
        model: entry.model,
        entryType: entry.entryType,
        pricingStatus: entry.pricingStatus,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
        audioMs,
        costUsd: entry.costUsd === null ? null : roundUsd(entry.costUsd)
      };
    });

    const submitterIds = [...new Set(entries.map((entry) => entry.submitterId))];
    const submitterEmails: Record<string, string> = {};
    await Promise.all(
      submitterIds.map(async (submitterId) => {
        const user = await authenticatedUserRepository?.getById(submitterId);

        if (user?.email) {
          submitterEmails[submitterId] = user.email;
        }
      })
    );

    const byModelMap = new Map<
      string,
      {
        model: string;
        stage: string;
        provider: string;
        entryCount: number;
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
        totalTokens: number;
        pricedCostUsd: number;
        totalCostUsd: number | null;
        hasUnpricedUsage: boolean;
        unpricedEntryCount: number;
      }
    >();

    for (const entry of entries) {
      const key = `${entry.stage}::${entry.provider}::${entry.model}`;
      const current = byModelMap.get(key) ?? {
        model: entry.model,
        stage: entry.stage,
        provider: entry.provider,
        entryCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        pricedCostUsd: 0,
        totalCostUsd: 0,
        hasUnpricedUsage: false,
        unpricedEntryCount: 0
      };

      current.entryCount += 1;
      current.inputTokens += entry.inputTokens;
      current.cachedInputTokens += entry.cachedInputTokens;
      current.outputTokens += entry.outputTokens;
      current.reasoningOutputTokens += entry.reasoningOutputTokens;
      current.totalTokens += entry.totalTokens;
      current.pricedCostUsd = roundUsd(current.pricedCostUsd + (entry.costUsd ?? 0));

      if (entry.pricingStatus === 'unpriced') {
        current.hasUnpricedUsage = true;
        current.unpricedEntryCount += 1;
      }

      current.totalCostUsd = current.hasUnpricedUsage ? null : current.pricedCostUsd;
      byModelMap.set(key, current);
    }

    const byModel = [...byModelMap.values()].sort(
      (left, right) => right.pricedCostUsd - left.pricedCostUsd
    );

    const totalsBase = entries.reduce(
      (accumulator, entry) => {
        accumulator.inputTokens += entry.inputTokens;
        accumulator.cachedInputTokens += entry.cachedInputTokens;
        accumulator.outputTokens += entry.outputTokens;
        accumulator.reasoningOutputTokens += entry.reasoningOutputTokens;
        accumulator.totalTokens += entry.totalTokens;
        accumulator.pricedCostUsd = roundUsd(
          accumulator.pricedCostUsd + (entry.costUsd ?? 0)
        );
        accumulator.audioMs += entry.audioMs;

        if (entry.entryType === 'actual') {
          accumulator.actualEntryCount += 1;
        }

        if (entry.pricingStatus === 'unpriced') {
          accumulator.unpricedEntryCount += 1;
        }

        return accumulator;
      },
      {
        entryCount: entries.length,
        actualEntryCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        pricedCostUsd: 0,
        unpricedEntryCount: 0,
        audioMs: 0
      }
    );
    const totals = {
      ...totalsBase,
      totalCostUsd:
        totalsBase.unpricedEntryCount > 0 ? null : totalsBase.pricedCostUsd,
      hasUnpricedUsage: totalsBase.unpricedEntryCount > 0
    };

    return response.status(200).json({
      generatedAt: new Date().toISOString(),
      limit,
      totals,
      byModel,
      submitterEmails,
      entries
    });
  });

  app.get('/api/admin/jobs/:id', async (request, response) => {
    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    const job = await repository.getByIdIncludingHidden(request.params.id);

    if (!job) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    const ledgerEntries = await cloudUsageLedgerRepository.listByJob(job.id);
    const costSummary = (await cloudUsageLedgerRepository.summarizeActualCostByJobIds([job.id]))[
      job.id
    ] ?? {
      actualTranscriptionCostUsd: 0,
      hasUnpricedTranscriptionUsage: false,
      actualPunctuationCostUsd: 0,
      hasUnpricedPunctuationUsage: false,
      actualSummaryCostUsd: 0,
      hasUnpricedSummaryUsage: false,
      actualCloudCostUsd: 0,
      hasUnpricedUsage: false
    };
    const user = await authenticatedUserRepository?.getById(job.submitterId);

    return response.status(200).json({
      ...toApiRecordingJob({
        ...job,
        ...costSummary
      }),
      submitterEmail: user?.email,
      ledgerEntries: ledgerEntries.map((entry) => {
        const detail = entry.detail ?? {};

        return {
          stage: entry.stage,
          entryType: entry.entryType,
          provider: entry.provider,
          model: entry.model,
          pricingVersion: entry.pricingVersion,
          usageUnit: entry.usageUnit,
          pricingStatus: entry.pricingStatus,
          costUsd: entry.costUsd === null ? null : roundUsd(entry.costUsd),
          inputTokens:
            readFiniteNumber(detail.promptTokens) || readFiniteNumber(detail.inputTokens),
          cachedInputTokens:
            readFiniteNumber(detail.cachedPromptTokens) ||
            readFiniteNumber(detail.cachedInputTokens),
          outputTokens:
            readFiniteNumber(detail.completionTokens) || readFiniteNumber(detail.outputTokens),
          reasoningOutputTokens:
            readFiniteNumber(detail.reasoningCompletionTokens) ||
            readFiniteNumber(detail.reasoningOutputTokens),
          totalTokens: readFiniteNumber(detail.totalTokens),
          requestCount: readFiniteNumber(detail.requestCount),
          acceptedChunkCount: readFiniteNumber(detail.acceptedChunkCount),
          fallbackChunkCount: readFiniteNumber(detail.fallbackChunkCount),
          unmeteredRequestCount: readFiniteNumber(detail.unmeteredRequestCount),
          audioMs: readFiniteNumber(detail.audioMs),
          createdAt: entry.createdAt
        };
      })
    });
  });

  app.get('/api/admin/runtime-health', async (request, response) => {
    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    const generatedAt = new Date().toISOString();
    const quotaDayKey = buildQuotaDayKey(new Date());
    const [
      currentPolicy,
      activeJobs,
      queuedMeetingJobs,
      queuedTranscriptionJobs,
      queuedSummaryJobs,
      jobsToday
    ] = await Promise.all([
      transcriptionProviderSettingsRepository.getCurrent(),
      repository.listActiveProcessingJobs(),
      repository.countQueuedMeetingJobs(),
      repository.countPendingTranscriptionJobs(),
      repository.countPendingSummaryJobs(),
      repository.listByQuotaDayKey(quotaDayKey)
    ]);

    return response.status(200).json(
      buildRuntimeHealthReport({
        generatedAt,
        quotaDayKey,
        activeJobs,
        jobsToday,
        queuedMeetingJobs,
        queuedTranscriptionJobs,
        queuedSummaryJobs,
        meetingCapacity: 1,
        transcriptionCapacity:
          currentPolicy.concurrencyPools.localTranscription +
          currentPolicy.concurrencyPools.cloudTranscription,
        summaryCapacity:
          currentPolicy.concurrencyPools.localSummary +
          currentPolicy.concurrencyPools.cloudSummary
      })
    );
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

    const meetingBotBusy = await cleanupStaleMeetingJobsIfIdle();
    const decodedCursor = parsedQuery.data.cursor
      ? decodeJobsCursor(parsedQuery.data.cursor)
      : undefined;

    if (parsedQuery.data.cursor && !decodedCursor) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: 'The request cursor is invalid.'
        }
      });
    }

    const pageSize = parsedQuery.data.pageSize ?? 25;
    const page = parsedQuery.data.q
      ? undefined
      : await repository.listBySubmitterPage(submitterId, {
          limit: pageSize,
          cursor: decodedCursor
        });
    const visibleJobs = parsedQuery.data.q
      ? (await repository.listBySubmitter(submitterId)).filter((job) =>
          jobMatchesSearchQuery(job, parsedQuery.data.q)
        )
      : page?.jobs ?? [];
    const costSummaries = await cloudUsageLedgerRepository.summarizeActualCostByJobIds(
      visibleJobs.map((job) => job.id)
    );
    const jobsWithActualCost = visibleJobs.map((job) => ({
      ...job,
      ...(costSummaries[job.id] ?? {
        actualTranscriptionCostUsd: 0,
        hasUnpricedTranscriptionUsage: false,
        actualPunctuationCostUsd: 0,
        hasUnpricedPunctuationUsage: false,
        actualSummaryCostUsd: 0,
        hasUnpricedSummaryUsage: false,
        actualCloudCostUsd: 0,
        hasUnpricedUsage: false
      })
    }));
    const stats = parsedQuery.data.q
      ? {
          totalCount: jobsWithActualCost.length,
          activeCount: jobsWithActualCost.filter((job) =>
            ['joining', 'recording', 'transcribing'].includes(job.state)
          ).length,
          queuedCount: jobsWithActualCost.filter((job) => job.state === 'queued').length,
          completedCount: jobsWithActualCost.filter((job) => job.state === 'completed').length,
          failedCount: jobsWithActualCost.filter((job) => job.state === 'failed').length
        }
      : await repository.summarizeBySubmitter(submitterId);

    return response.status(200).json({
      jobs: jobsWithActualCost.map((job) =>
        toOperatorJobListItem({
          ...job,
          displayState: deriveDisplayState(job, meetingBotBusy)
        })
      ),
      pageInfo: parsedQuery.data.q
        ? undefined
        : {
            pageSize,
            hasMore: Boolean(page?.nextCursor),
            nextCursor: page?.nextCursor ? encodeJobsCursor(page.nextCursor) : undefined
          },
      stats
    });
  });

  app.get('/api/operator/jobs/:id', async (request, response) => {
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

    const job = await repository.getById(request.params.id);

    if (!job || job.submitterId !== submitterId) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    const costSummary = (await cloudUsageLedgerRepository.summarizeActualCostByJobIds([job.id]))[
      job.id
    ] ?? {
      actualTranscriptionCostUsd: 0,
      hasUnpricedTranscriptionUsage: false,
      actualPunctuationCostUsd: 0,
      hasUnpricedPunctuationUsage: false,
      actualSummaryCostUsd: 0,
      hasUnpricedSummaryUsage: false,
      actualCloudCostUsd: 0,
      hasUnpricedUsage: false
    };

    return response.status(200).json(
      toApiRecordingJob({
        ...job,
        ...costSummary
      })
    );
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

    const meetingCapacity = await getMeetingCapacitySnapshot();

    if (meetingCapacity.nextBacklogSize > maxMeetingJobBacklog) {
      return response.status(409).json(meetingCapacityExceededResponse);
    }

    let job = createRecordingJob({
      meetingUrl: parsedRequest.data.meetingUrl,
      platform: supportResult.platform,
      inputSource: 'meeting-link',
      submitterId,
      requestedJoinName: resolveRequestedJoinName(
        parsedRequest.data.requestedJoinName,
        workflowTemplate.requestedJoinName
      ),
      meetingPasscode: parsedRequest.data.meetingPasscode || undefined,
      submissionTemplateId: workflowTemplate.id,
      summaryProfile: workflowTemplate.summaryProfile,
      preferredExportFormat: workflowTemplate.preferredExportFormat,
      transcriptionProvider: policySnapshot.policy.transcriptionProvider,
      transcriptionModel: policySnapshot.policy.transcriptionModel,
      summaryProvider: policySnapshot.policy.summaryProvider,
      summaryModel: policySnapshot.policy.summaryModel,
      summaryRequested: policySnapshot.summaryRequested,
      pricingVersion: policySnapshot.policy.pricingVersion,
      estimatedCloudReservationUsd: policySnapshot.estimatedCloudReservationUsd,
      reservedCloudQuotaUsd: policySnapshot.estimatedCloudReservationUsd,
      quotaDayKey: policySnapshot.quotaStatus.quotaDayKey
    });

    if (meetingCapacity.capacityBusy || meetingCapacity.queuedMeetingJobs > 0) {
      job = markMeetingJobWaitingForCapacity(job);
    }

    job = await saveJob(job);

    return response.status(201).json(toApiRecordingJob(job));
  });

  app.post('/api/operator/jobs/uploads', upload.single('audio'), async (request, response) => {
    // Multer has already written the upload to disk by the time this handler runs.
    // Every early-exit path below must remove that temp file or it leaks in /tmp.
    const uploadedTempPath = request.file?.path;
    const cleanupUploadedTempFile = async () => {
      if (uploadedTempPath) {
        await rm(uploadedTempPath, { force: true });
      }
    };

    if (!uploadedAudioStorage) {
      await cleanupUploadedTempFile();
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
      await cleanupUploadedTempFile();
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
      await cleanupUploadedTempFile();
      return response.status(400).json({
        error: {
          code: 'unsupported-audio-upload',
          message: 'Only audio or video uploads are supported.'
        }
      });
    }

    const parsedGlossary = parseTranscriptionGlossary(request.body.transcriptionGlossary);
    if (!parsedGlossary.success) {
      await cleanupUploadedTempFile();
      return response.status(400).json({
        error: {
          code: 'invalid-transcription-glossary',
          message:
            parsedGlossary.error.issues[0]?.message ??
            'Transcription glossary is invalid.'
        }
      });
    }

    const normalizedFileName = normalizeUploadedFileName(file.originalname);
    const requestedTemplateId =
      typeof request.body.submissionTemplateId === 'string'
        ? request.body.submissionTemplateId
        : submitterId.startsWith('report-portal:line:')
          ? 'sales'
          : undefined;
    const workflowTemplate = getOperatorWorkflowTemplate(
      requestedTemplateId
    );
    const policySnapshot = await buildPolicySnapshotForJob({
      submitterId,
      inputSource: 'uploaded-audio'
    });

    if (!policySnapshot.accepted) {
      await cleanupUploadedTempFile();
      return response
        .status(409)
        .json(
          quotaExceededResponse(
            policySnapshot.quotaStatus.remainingUsd,
            policySnapshot.estimatedCloudReservationUsd
          )
        );
    }

    const pendingTranscriptionJobs = await repository.countPendingTranscriptionJobs();

    if (pendingTranscriptionJobs >= maxTranscriptionJobBacklog) {
      if (file.path) {
        await rm(file.path, { force: true });
      }

      return response.status(409).json(transcriptionCapacityExceededResponse);
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
      transcriptionGlossary: parsedGlossary.data,
      transcriptionProvider: policySnapshot.policy.transcriptionProvider,
      transcriptionModel: policySnapshot.policy.transcriptionModel,
      summaryProvider: policySnapshot.policy.summaryProvider,
      summaryModel: policySnapshot.policy.summaryModel,
      summaryRequested: policySnapshot.summaryRequested,
      pricingVersion: policySnapshot.policy.pricingVersion,
      estimatedCloudReservationUsd: policySnapshot.estimatedCloudReservationUsd,
      reservedCloudQuotaUsd: policySnapshot.estimatedCloudReservationUsd,
      quotaDayKey: policySnapshot.quotaStatus.quotaDayKey
    });

    const recordingArtifact = await (async () => {
      try {
        return await uploadedAudioStorage.storeUpload({
          jobId: job.id,
          submitterId,
          originalName: normalizedFileName,
          contentType: file.mimetype,
          filePath: file.path
        });
      } finally {
        if (file.path) {
          await rm(file.path, { force: true });
        }
      }
    })();

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

    // Re-read from DB because the completion webhook may have already
    // attached a recording artifact while stopCurrentBot() was running.
    const freshJob = (await repository.getById(activeMeetingJob.id)) ?? activeMeetingJob;

    const savedJob =
      freshJob.state === 'joining' && !freshJob.recordingArtifact
        ? await repository.save(markRecordingJobFailed(freshJob, meetingNotAdmittedFailure))
        : freshJob.state === 'completed' || freshJob.state === 'transcribing'
          ? freshJob
          : await saveJob(
              updateRecordingJobProgress(freshJob, {
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

    const meetingCapacity = await getMeetingCapacitySnapshot();

    if (meetingCapacity.nextBacklogSize > maxMeetingJobBacklog) {
      return response.status(409).json(meetingCapacityExceededResponse);
    }

    let job = createRecordingJob({
      meetingUrl: parsedRequest.data.meetingUrl,
      platform: supportResult.platform,
      inputSource: 'meeting-link',
      transcriptionProvider: policySnapshot.policy.transcriptionProvider,
      transcriptionModel: policySnapshot.policy.transcriptionModel,
      summaryProvider: policySnapshot.policy.summaryProvider,
      summaryModel: policySnapshot.policy.summaryModel,
      summaryRequested: policySnapshot.summaryRequested,
      pricingVersion: policySnapshot.policy.pricingVersion,
      estimatedCloudReservationUsd: policySnapshot.estimatedCloudReservationUsd,
      reservedCloudQuotaUsd: policySnapshot.estimatedCloudReservationUsd,
      quotaDayKey: policySnapshot.quotaStatus.quotaDayKey
    });

    if (meetingCapacity.capacityBusy || meetingCapacity.queuedMeetingJobs > 0) {
      job = markMeetingJobWaitingForCapacity(job);
    }

    job = await saveJob(job);

    return response.status(201).json(toApiRecordingJob(job));
  });

  app.post('/recording-workers/claims', async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

    const parsedRequest = claimRecordingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    return await runRecordingClaimSerially(async () => {
      const meetingBotBusy = await cleanupStaleMeetingJobsIfIdle();

      if (meetingBotBusy) {
        return response.status(204).send();
      }

      const claimedJob = await repository.claimNextQueued(parsedRequest.data.workerId);

      if (!claimedJob) {
        return response.status(204).send();
      }

      return response.status(200).json(toWorkerClaimResponse(claimedJob, 'recording'));
    });
  });

  app.post('/transcription-workers/claims', async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

    const parsedRequest = claimRecordingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    return await runTranscriptionClaimSerially(async () => {
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

      return response.status(200).json(toWorkerClaimResponse(claimedJob, 'transcription'));
    });
  });

  app.post('/transcription-workers/summary-claims', async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

    const parsedRequest = claimSummarySlotRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    return await runSummaryClaimSerially(async () => {
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

      if (
        job.processingStage === 'generating-summary' &&
        job.assignedSummaryWorkerId === parsedRequest.data.workerId
      ) {
        // Idempotent re-claim by the worker that already owns this summary. A different
        // worker must NOT be handed an in-progress summary here; it falls through to the
        // lease-aware claimNextSummaryReady below, which only reassigns when the existing
        // lease has expired — preventing two workers from summarizing the same job.
        return response.status(200).json(toWorkerClaimResponse(job, 'summary'));
      }

      const savedJob = await repository.claimNextSummaryReady(
        parsedRequest.data.workerId,
        summaryProvider
      );

      if (!savedJob || savedJob.id !== job.id) {
        return response.status(204).send();
      }

      return response.status(200).json(toWorkerClaimResponse(savedJob, 'summary'));
    });
  });

  app.post('/summary-workers/claims', async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

    const parsedRequest = claimRecordingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    return await runSummaryClaimSerially(async () => {
      const currentPolicy = await transcriptionProviderSettingsRepository.getCurrent();
      const summaryJobs = await repository.listGeneratingSummaryJobs();
      const activeLocalSummaries = summaryJobs.filter(
        (candidate) => !candidate.summaryProvider || !isCloudSummaryProvider(candidate.summaryProvider)
      );
      const activeCloudSummaries = summaryJobs.filter(
        (candidate) =>
          typeof candidate.summaryProvider === 'string' &&
          isCloudSummaryProvider(candidate.summaryProvider)
      );
      const localSummaryAvailable =
        activeLocalSummaries.length < currentPolicy.concurrencyPools.localSummary;
      const cloudSummaryAvailable =
        activeCloudSummaries.length < currentPolicy.concurrencyPools.cloudSummary;

      const allowedSummaryProviders = summaryProviders.filter((provider) =>
        isCloudSummaryProvider(provider)
          ? cloudSummaryAvailable
          : localSummaryAvailable
      );

      if (allowedSummaryProviders.length === 0) {
        return response.status(204).send();
      }

      const claimedJob = await repository.claimNextSummaryReady(
        parsedRequest.data.workerId,
        allowedSummaryProviders
      );

      if (!claimedJob) {
        return response.status(204).send();
      }

      return response.status(200).json(toWorkerClaimResponse(claimedJob, 'summary'));
    });
  });

  app.post('/recording-jobs/:id/leases/heartbeat', async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

    const parsedRequest = leaseHeartbeatRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const heartbeatAt = new Date().toISOString();
    const expiresAt = new Date(
      Date.parse(heartbeatAt) + DEFAULT_WORKER_LEASE_DURATION_MS
    ).toISOString();
    const job = await repository.heartbeatLease({
      jobId: request.params.id,
      stage: parsedRequest.data.stage,
      leaseToken: parsedRequest.data.leaseToken,
      heartbeatAt,
      expiresAt
    });

    if (!job) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    return response.status(200).json(toWorkerClaimResponse(job, parsedRequest.data.stage));
  });

  app.post('/integrations/meeting-bot/completions', async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

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

  app.patch(['/v2/meeting/app/bot/status', '/v2/:internalToken/meeting/app/bot/status'], async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

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

  app.patch(['/v2/meeting/app/bot/log', '/v2/:internalToken/meeting/app/bot/log'], async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

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

    const normalizedLevel = parsedPayload.data.level.toLowerCase();
    const progress = deriveMeetingBotLogProgress(parsedPayload.data);

    if (
      normalizedLevel === 'info' &&
      progress &&
      shouldApplyMeetingBotProgressDetails(job.state) &&
      !isFinalizingMeetingRecording(job)
    ) {
      const nextJob =
        progress.processingStage === 'recording'
          ? markMeetingRecordingInProgress(job, progress.processingMessage)
          : updateRecordingJobProgress(job, progress);

      await saveJob(nextJob);
    }

    if (
      normalizedLevel === 'error' &&
      shouldApplyMeetingBotFailureDetails(job.state) &&
      !isFinalizingMeetingRecording(job)
    ) {
      await saveJob(markRecordingJobFailed(job, deriveMeetingBotLogFailure(parsedPayload.data)));
    }

    return response.status(200).json({ success: true });
  });

  app.post('/recording-jobs/:id/events', async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

    const parsedEvent = recordingJobEventSchema.safeParse(request.body);

    if (!parsedEvent.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedEvent.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const visibleJob = await repository.getById(request.params.id);
    const job = visibleJob ?? (await repository.getByIdIncludingHidden(request.params.id));
    const isOperatorHiddenJob = !visibleJob && Boolean(job);

    if (!job) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    if (
      parsedEvent.data.type === 'summary-artifact-stored' &&
      job.summaryProvider &&
      isCloudSummaryProvider(job.summaryProvider) &&
      !parsedEvent.data.usage
    ) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: 'Cloud summary callbacks must include complete token usage.'
        }
      });
    }

    const cloudTerminalLeaseStage = resolveCloudTerminalLeaseStage(job, parsedEvent.data);

    if (isOperatorHiddenJob && !cloudTerminalLeaseStage) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    if (cloudTerminalLeaseStage && !parsedEvent.data.leaseToken) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: 'Cloud terminal callbacks must include a scheduler-issued lease token.'
        }
      });
    }

    if (
      cloudTerminalLeaseStage &&
      parsedEvent.data.leaseToken &&
      !wasCloudTerminalLeaseIssued(job, cloudTerminalLeaseStage, parsedEvent.data.leaseToken)
    ) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: 'The cloud terminal callback lease token was not issued for this job stage.'
        }
      });
    }

    try {
      await appendActualUsageFromEvent(job, parsedEvent.data);
    } catch (error) {
      if (error instanceof CloudUsageSettlementMetadataError) {
        return response.status(409).json({
          error: {
            code: 'cloud-usage-settlement-metadata-missing',
            message: error.message
          }
        });
      }

      if (error instanceof CloudUsageLedgerConflictError) {
        return response.status(409).json({
          error: {
            code: 'cloud-usage-ledger-conflict',
            message: error.message
          }
        });
      }

      throw error;
    }

    if (isOperatorHiddenJob) {
      return response.status(202).json(toApiRecordingJob(job));
    }

    if (job.state === 'failed' && job.failureCode === 'operator-cancel-requested') {
      return response.status(202).json(toApiRecordingJob(job));
    }

    if (hasSupersededLeaseToken(job, parsedEvent.data)) {
      return response.status(202).json(toApiRecordingJob(job));
    }

    if (isDuplicateTerminalStageEvent(job, parsedEvent.data)) {
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
            : parsedEvent.data.type === 'summary-failed'
              ? markRecordingJobFailed(job, parsedEvent.data.failure)
              : markRecordingJobFailed(job, parsedEvent.data.failure);

    const leaseGuardedSavedJob =
      cloudTerminalLeaseStage && parsedEvent.data.leaseToken
        ? await repository.saveIfLeaseActive(updatedJob, {
            stage: cloudTerminalLeaseStage,
            leaseToken: parsedEvent.data.leaseToken
          })
        : undefined;

    if (cloudTerminalLeaseStage && !leaseGuardedSavedJob) {
      const latestJob = await repository.getById(job.id);
      return response.status(202).json(toApiRecordingJob(latestJob ?? job));
    }

    const savedJob = cloudTerminalLeaseStage
      ? await maybeSendTerminalJobNotification(leaseGuardedSavedJob!)
      : await saveJob(updatedJob);

    return response.status(202).json(toApiRecordingJob(savedJob));
  });

  app.get('/recording-jobs/:id', async (request, response) => {
    const job = await repository.getById(request.params.id);

    if (!job) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    return response.status(200).json(toApiRecordingJob(job));
  });

  const uploadErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({
        error: {
          code: 'uploaded-media-too-large',
          message: 'Uploaded media exceeds the configured size limit.'
        }
      });
      return;
    }

    next(error);
  };
  app.use(uploadErrorHandler);

  app.use(express.static(publicDir));

  app.get('/admin', (_request, response) => {
    response.sendFile(resolve(publicDir, 'admin.html'));
  });

  app.get('/', (_request, response) => {
    response.sendFile(resolve(publicDir, 'index.html'));
  });

  return app;
};
