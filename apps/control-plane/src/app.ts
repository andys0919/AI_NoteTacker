import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  appendActualUsageFromEvent as settleCloudUsageFromEvent,
  CloudUsageSettlementMetadataError
} from './application/cloud-usage-settlement.js';
import {
  hashLeaseToken,
  providerRequestAuditIdsSchema,
  providerRequestBillingClass,
  providerRequestFinishSchema,
  providerRequestIdSchema,
  providerRequestStartSchema,
  settleProviderRequest,
  toProviderRequestApi
} from './application/provider-request-audit.js';
import type { AdminAuditLogRepository } from './domain/admin-audit-log-repository.js';
import type { AuthenticatedUserRepository } from './domain/authenticated-user-repository.js';
import {
  buildQuotaDayKey,
  calculateRemainingCloudQuotaUsd,
  estimateCloudReservationUsd,
  getAzureRetailPricingSnapshot,
  isValidIsoDate,
  resolveCloudUsageEntryCost,
  roundUsd,
  sumActualConsumedUsd,
  sumReservedUsd
} from './domain/cloud-usage.js';
import {
  CloudUsageLedgerConflictError,
  type CloudUsageLedgerRepository,
  isSameProviderRequestStart,
  type ProviderRequestAudit,
  ProviderRequestAuditConflictError
} from './domain/cloud-usage-ledger-repository.js';
import type { JobNotificationSender, TerminalJobNotification } from './domain/job-notification-sender.js';
import {
  createMeetingShareLink,
  createMeetingShareToken,
  isMeetingShareEligible,
  isMeetingShareLinkActive,
  isMeetingShareSecretConfigured,
  parseMeetingShareToken,
  sanitizeAnonymousSpeakerLabels,
  toReadableTranscriptText,
  toPublicMeeting,
  verifyMeetingShareToken
} from './domain/meeting-share.js';
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
  ARTIFACT_LIFECYCLE_POLICY,
  createRecordingJob,
  DEFAULT_JOIN_NAME,
  DEFAULT_WORKER_LEASE_DURATION_MS,
  markMeetingRecordingInProgress,
  markMeetingJobWaitingForCapacity,
  markTerminalJobNotificationSent,
  markRecordingJobFailed,
  recordTerminalArtifactLifecyclePolicy,
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

const codexWeeklyUsageSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    planType: z.string().trim().min(1).max(40).optional(),
    usedPercent: z.number().finite().min(0).max(100),
    windowDurationMins: z.literal(7 * 24 * 60),
    resetsAt: z.number().int().positive(),
    checkedAt: z.string().datetime({ offset: true })
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['probe-failed', 'weekly-window-unavailable']),
    checkedAt: z.string().datetime({ offset: true })
  })
]);

const claimSummaryJobRequestSchema = claimRecordingJobRequestSchema.extend({
  codexUsage: codexWeeklyUsageSchema.optional()
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
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative(),
  reasoningOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  requestCount: z.number().int().nonnegative(),
  acceptedChunkCount: z.number().int().nonnegative(),
  fallbackChunkCount: z.number().int().nonnegative(),
  unmeteredRequestCount: z.number().int().nonnegative()
}).superRefine((usage, context) => {
  if (usage.cachedInputTokens + (usage.cacheWriteTokens ?? 0) > usage.inputTokens) {
    context.addIssue({
      code: 'custom',
      path: ['cachedInputTokens'],
      message: 'Cached and cache-write input tokens cannot exceed input tokens.'
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

const transcriptUsageSchema = z
  .object({
    audioMs: z.number().int().nonnegative().optional(),
    billedAudioMs: z.number().int().nonnegative().optional(),
    providerRequestCount: z.number().int().nonnegative().optional(),
    unmeteredRequestCount: z.number().int().nonnegative().optional(),
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
  })
  .superRefine((usage, context) => {
    if (
      (usage.providerRequestCount === undefined) !==
      (usage.unmeteredRequestCount === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['providerRequestCount'],
        message: 'Provider and unmetered request counts must be reported together.'
      });
    }
    if (
      usage.providerRequestCount !== undefined &&
      (usage.unmeteredRequestCount ?? 0) > usage.providerRequestCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['unmeteredRequestCount'],
        message: 'Unmetered requests cannot exceed provider requests.'
      });
    }
    if (
      usage.audioMs !== undefined &&
      usage.billedAudioMs !== undefined &&
      usage.billedAudioMs < usage.audioMs
    ) {
      context.addIssue({
        code: 'custom',
        path: ['billedAudioMs'],
        message: 'Billed audio duration cannot be less than successful upload duration.'
      });
    }
  });

const summaryArtifactSchema = z.object({
  model: z.string().min(1),
  reasoningEffort: z.string().min(1),
  text: z.string().min(1),
  structured: z
    .object({
      title: z.string().min(1).optional(),
      summary: z.string(),
      topics: z
        .array(
          z.object({
            title: z.string().min(1),
            status: z.enum(['confirmed', 'mixed', 'open']),
            subtopics: z
              .array(
                z.object({
                  title: z.string().min(1),
                  details: z.array(z.string().min(1)).min(1)
                })
              )
              .optional(),
            points: z.array(z.string().min(1)).min(1),
            conclusion: z.string().min(1)
          })
        )
        .optional(),
      followUpGroups: z
        .array(
          z.object({
            title: z.string().min(1),
            items: z.array(z.string().min(1)).min(1)
          })
        )
        .optional(),
      analysisNotes: z.array(z.string()).optional(),
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
  cacheWritePromptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative(),
  reasoningCompletionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  providerRequestCount: z.number().int().positive().optional(),
  unmeteredRequestCount: z.number().int().nonnegative().optional()
}).superRefine((usage, context) => {
  if (
    usage.cachedPromptTokens + (usage.cacheWritePromptTokens ?? 0) >
    usage.promptTokens
  ) {
    context.addIssue({
      code: 'custom',
      path: ['cachedPromptTokens'],
      message: 'Cached and cache-write prompt tokens cannot exceed prompt tokens.'
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
      requestAuditIds: providerRequestAuditIdsSchema.optional(),
      usage: transcriptUsageSchema.optional()
    }),
    z.object({
      type: z.literal('summary-artifact-stored'),
      actualProvider: z.enum(['local-codex', 'azure-openai']).optional(),
      summaryArtifact: summaryArtifactSchema,
      requestAuditIds: providerRequestAuditIdsSchema.optional(),
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
      requestAuditIds: providerRequestAuditIdsSchema.optional(),
      usage: transcriptUsageSchema.optional()
    }),
    z.object({
      type: z.literal('summary-failed'),
      actualProvider: z.enum(['local-codex', 'azure-openai']).optional(),
      failure: z.object({
        code: z.string().min(1),
        message: z.string().min(1)
      }),
      requestAuditIds: providerRequestAuditIdsSchema.optional(),
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

const summaryFallbackReservationSchema = z.object({
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
  meetingShareSecret?: string;
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
      title?: string;
      summary: string;
      topics?: Array<{
        title: string;
        status: 'confirmed' | 'mixed' | 'open';
        subtopics?: Array<{
          title: string;
          details: string[];
        }>;
        points: string[];
        conclusion: string;
      }>;
      followUpGroups?: Array<{
        title: string;
        items: string[];
      }>;
      analysisNotes?: string[];
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
    transcriptArtifact: undefined,
    summaryArtifact: undefined,
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
    const summaryText = sanitizeAnonymousSpeakerLabels(job.summaryArtifact.text).trim();
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
          `- [${formatSrtTimestamp(segment.startMs).replace(',', '.')}] ${toReadableTranscriptText(segment)}`
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
    parts.push('', 'Summary', sanitizeAnonymousSpeakerLabels(job.summaryArtifact.text));
  }

  if (job.transcriptArtifact?.segments.length) {
    parts.push(
      '',
      'Transcript',
      ...job.transcriptArtifact.segments.map(
        (segment) =>
          `[${formatSrtTimestamp(segment.startMs)}] ${toReadableTranscriptText(segment)}`
      )
    );
  }

  return parts.join('\n');
};

const renderSrtExport = (job: RecordingJob): string =>
  (job.transcriptArtifact?.segments ?? [])
    .map(
      (segment, index) =>
        `${index + 1}\n${formatSrtTimestamp(segment.startMs)} --> ${formatSrtTimestamp(segment.endMs)}\n${toReadableTranscriptText(segment)}`
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

const parseAdminEmails = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

const artifactStorageKeys = (jobs: RecordingJob[]): string[] =>
  [...new Set(
    jobs.flatMap((job) =>
      [job.recordingArtifact?.storageKey, job.transcriptArtifact?.storageKey].filter(
        (key): key is string => Boolean(key)
      )
    )
  )];

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
  const internalServiceToken = (
    options.internalServiceToken ?? process.env.INTERNAL_SERVICE_TOKEN
  )?.trim();
  const meetingShareSecret = options.meetingShareSecret ?? process.env.MEETING_SHARE_SECRET ?? '';
  const meetingShareSecretConfigured = isMeetingShareSecretConfigured(meetingShareSecret);
  if (
    !internalServiceToken ||
    internalServiceToken === 'internal-token' ||
    Buffer.byteLength(internalServiceToken, 'utf8') < 32
  ) {
    throw new Error(
      'INTERNAL_SERVICE_TOKEN must be a dedicated non-placeholder secret of at least 32 bytes.'
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
  let latestCodexWeeklyUsage: z.infer<typeof codexWeeklyUsageSchema> | undefined;
  const adminEmails = new Set(
    (options.adminEmails ?? parseAdminEmails(process.env.ADMIN_EMAILS)).map((email) =>
      email.toLowerCase()
    )
  );
  const adminConsoleAuth = options.adminConsoleAuth ?? createAdminConsoleAuthFromEnvironment();
  // ponytail: per-process throttling matches the supported single control-plane profile;
  // move this limiter to ingress or shared storage before adding control-plane replicas.
  const adminLoginFailures = new Map<string, { count: number; resetAt: number }>();
  const adminLoginFailureLimit = 5;
  const adminLoginWindowMs = 15 * 60 * 1000;
  const upload = multer({
    dest: tmpdir(),
    limits: {
      fieldNestingDepth: 0,
      // submitter, template, and the schema's 50 supported glossary entries
      fields: 52,
      files: 1,
      parts: 53,
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

  const sharedMeetingUnavailableResponse = {
    error: {
      code: 'shared-meeting-unavailable',
      message: 'This shared meeting is unavailable.'
    }
  };

  const setSharedMeetingHeaders = (response: express.Response): void => {
    response.set({
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy':
        "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'none'; object-src 'none'; script-src 'self'; style-src 'self'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive'
    });
  };

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

  const cleanupArtifacts = async (jobs: RecordingJob[]) => {
    const storageKeys = artifactStorageKeys(jobs);
    if (storageKeys.length > 0) {
      if (!uploadedAudioStorage?.deleteObjects) {
        throw new Error('artifact storage cleanup is not configured');
      }
      await uploadedAudioStorage.deleteObjects(storageKeys);
    }

    return { status: 'completed' as const, objectCount: storageKeys.length };
  };

  const getQuotaStatusForSubmitter = async (submitterId: string, at: Date = new Date()) => {
    const currentPolicy = await transcriptionProviderSettingsRepository.getCurrent();
    const quotaDayKey = buildQuotaDayKey(at);
    const override = await operatorCloudQuotaOverrideRepository.getBySubmitterId(submitterId);
    const dailyQuotaUsd = override?.dailyQuotaUsd ?? currentPolicy.defaultDailyCloudQuotaUsd;
    const [ledgerEntries, providerRequests] = await Promise.all([
      cloudUsageLedgerRepository.listBySubmitterAndDay(submitterId, quotaDayKey),
      cloudUsageLedgerRepository.listProviderRequestsBySubmitterAndDay(
        submitterId,
        quotaDayKey
      )
    ]);
    const consumed = sumActualConsumedUsd(
      ledgerEntries,
      submitterId,
      quotaDayKey,
      providerRequests
    );
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

    return {
      policy: currentPolicy,
      summaryRequested,
      estimatedCloudReservationUsd,
      quotaStatus
    };
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

  const resolveOwnedJob = async (
    request: express.Request,
    response: express.Response,
    submitterIdValue?: string
  ): Promise<RecordingJob | undefined> => {
    const submitterId = await resolveSubmitterIdFromRequest(
      request,
      response,
      submitterIdValue
    );
    if (!submitterId) {
      return undefined;
    }

    const jobId = String(request.params.id);
    const job = await repository.getById(jobId);
    if (!job || job.submitterId !== submitterId) {
      response.status(404).json(notFoundResponse(jobId));
      return undefined;
    }

    return job;
  };

  const resolveShareableOwnedJob = async (
    request: express.Request,
    response: express.Response,
    submitterId?: string
  ): Promise<RecordingJob | undefined> => {
    const job = await resolveOwnedJob(request, response, submitterId);
    if (!job) {
      return undefined;
    }

    if (!meetingShareSecretConfigured) {
      response.status(503).json({
        error: {
          code: 'meeting-share-unavailable',
          message: 'Meeting sharing is not configured.'
        }
      });
      return undefined;
    }

    if (!isMeetingShareEligible(job)) {
      response.status(409).json({
        error: {
          code: 'meeting-share-ineligible',
          message: 'Only completed meetings with transcript or summary content can be shared.'
        }
      });
      return undefined;
    }

    return job;
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
    const savedJob = await repository.save(recordTerminalArtifactLifecyclePolicy(job));
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

  const resolveTerminalLeaseStage = (
    job: RecordingJob,
    event: z.infer<typeof recordingJobEventSchema>
  ): 'transcription' | 'summary' | undefined => {
    if (event.type === 'summary-artifact-stored' || event.type === 'summary-failed') {
      return 'summary';
    }

    if (
      (event.type === 'transcript-artifact-stored' || event.type === 'transcription-failed') &&
      ((job.transcriptionProvider !== undefined &&
        isCloudTranscriptionProvider(job.transcriptionProvider)) ||
        event.usage?.punctuation !== undefined ||
        (event.requestAuditIds?.length ?? 0) > 0)
    ) {
      return 'transcription';
    }

    return undefined;
  };

  const wasTerminalLeaseIssued = (
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

  const activeLeaseTokenForStage = (
    job: RecordingJob,
    stage: 'transcription' | 'summary'
  ): string | undefined =>
    stage === 'transcription' ? job.transcriptionLeaseToken : job.summaryLeaseToken;

  const providerRequestMatchesJob = (
    job: RecordingJob,
    input: z.infer<typeof providerRequestStartSchema>
  ): boolean =>
    input.stage === 'transcription'
      ? input.provider === job.transcriptionProvider && input.model === job.transcriptionModel
      : (input.provider === 'local-codex' || input.provider === 'azure-openai') &&
        input.model === job.summaryModel;

  const validateTerminalProviderRequests = async (
    job: RecordingJob,
    event: z.infer<typeof recordingJobEventSchema>,
    stage: 'transcription' | 'summary' | undefined
  ): Promise<{ requests: ProviderRequestAudit[] } | { error: string }> => {
    const requestAuditIds =
      'requestAuditIds' in event ? (event.requestAuditIds ?? []) : [];
    if (!stage || !event.leaseToken) {
      return requestAuditIds.length === 0
        ? { requests: [] }
        : { error: 'Provider request audits require a scheduler-issued stage lease.' };
    }

    const leaseTokenHash = hashLeaseToken(event.leaseToken);
    const stageRequests = (await cloudUsageLedgerRepository.listProviderRequestsByJob(job.id)).filter(
      (request) => request.stage === stage && request.leaseTokenHash === leaseTokenHash
    );
    if (stageRequests.length === 0 && requestAuditIds.length === 0) {
      if (
        stage === 'summary' &&
        (event.type === 'summary-artifact-stored' || event.type === 'summary-failed') &&
        event.actualProvider === 'azure-openai'
      ) {
        return {
          error: 'Azure fallback callbacks require their finalized provider request audit.'
        };
      }
      return { requests: [] };
    }
    if (
      stageRequests.some((request) => request.status === 'started') ||
      stageRequests.length !== requestAuditIds.length ||
      stageRequests.some((request) => !requestAuditIds.includes(request.requestId))
    ) {
      return {
        error: 'Terminal callbacks must include every finalized provider request for this lease.'
      };
    }

    const expectedModel = stage === 'transcription' ? job.transcriptionModel : job.summaryModel;
    const expectedProvider =
      stage === 'transcription'
        ? job.transcriptionProvider
        : event.type === 'summary-artifact-stored' || event.type === 'summary-failed'
          ? (event.actualProvider ?? job.summaryProvider ?? 'local-codex')
          : undefined;
    if (
      stageRequests.some(
        (request) =>
          request.model !== expectedModel ||
          (expectedProvider !== undefined && request.provider !== expectedProvider)
      )
    ) {
      return { error: 'Provider request audits do not match the job provider and model.' };
    }

    return { requests: stageRequests };
  };

  app.use(express.json({ limit: '10mb' }));

  app.post(
    '/recording-jobs/:id/provider-requests/:requestId/start',
    async (request, response) => {
      if (!requireInternalService(request, response)) {
        return;
      }

      const parsedRequestId = providerRequestIdSchema.safeParse(request.params.requestId);
      const parsedRequest = providerRequestStartSchema.safeParse(request.body);
      if (!parsedRequestId.success || !parsedRequest.success) {
        return response.status(400).json({
          error: {
            code: 'invalid-request',
            message:
              parsedRequestId.error?.issues[0]?.message ??
              parsedRequest.error?.issues[0]?.message ??
              'The request payload is invalid.'
          }
        });
      }

      const job = await repository.getById(request.params.id);
      if (!job) {
        return response.status(404).json(notFoundResponse(request.params.id));
      }
      if (
        activeLeaseTokenForStage(job, parsedRequest.data.stage) !==
        parsedRequest.data.leaseToken
      ) {
        return response.status(409).json({
          error: {
            code: 'provider-request-lease-not-active',
            message: 'The provider request lease is not active for this job stage.'
          }
        });
      }
      if (!providerRequestMatchesJob(job, parsedRequest.data)) {
        return response.status(409).json({
          error: {
            code: 'provider-request-runtime-mismatch',
            message: 'The provider request provider or model does not match the latched job.'
          }
        });
      }
      if (!isValidIsoDate(job.quotaDayKey) || !job.pricingVersion) {
        return response.status(409).json({
          error: {
            code: 'cloud-usage-settlement-metadata-missing',
            message: `Cloud usage for job ${job.id} cannot be settled without quota and pricing identity.`
          }
        });
      }

      const existing = await cloudUsageLedgerRepository.getProviderRequest(
        parsedRequestId.data
      );
      const auditInput = {
        requestId: parsedRequestId.data,
        jobId: job.id,
        submitterId: job.submitterId,
        quotaDayKey: job.quotaDayKey,
        stage: parsedRequest.data.stage,
        provider: parsedRequest.data.provider,
        model: parsedRequest.data.model,
        pricingVersion: job.pricingVersion,
        leaseTokenHash: hashLeaseToken(parsedRequest.data.leaseToken),
        billingClass: providerRequestBillingClass(parsedRequest.data.provider),
        startedAt: existing?.startedAt ?? new Date().toISOString(),
        detail:
          parsedRequest.data.operation || parsedRequest.data.audioMs !== undefined
            ? {
                ...(parsedRequest.data.operation
                  ? { operation: parsedRequest.data.operation }
                  : {}),
                ...(parsedRequest.data.audioMs === undefined
                  ? {}
                  : { audioMs: parsedRequest.data.audioMs })
              }
            : undefined
      } as const;
      if (
        parsedRequest.data.stage === 'summary' &&
        parsedRequest.data.provider === 'azure-openai'
      ) {
        if (existing && !isSameProviderRequestStart(existing, auditInput)) {
          const error = new ProviderRequestAuditConflictError(parsedRequestId.data);
          return response.status(409).json({
            error: { code: 'provider-request-audit-conflict', message: error.message }
          });
        }
        const claimed = await repository.claimSummaryFallbackRequest({
          jobId: job.id,
          leaseToken: parsedRequest.data.leaseToken,
          requestId: parsedRequestId.data
        });
        if (!claimed) {
          return response.status(409).json({
            error: {
              code: 'summary-fallback-not-reserved',
              message: 'No Azure fallback reservation is available for this provider request.'
            }
          });
        }
      }
      try {
        const audit = await cloudUsageLedgerRepository.startProviderRequest(auditInput);

        return response.status(existing ? 200 : 201).json({
          created: existing === undefined,
          request: toProviderRequestApi(audit)
        });
      } catch (error) {
        if (error instanceof ProviderRequestAuditConflictError) {
          return response.status(409).json({
            error: { code: 'provider-request-audit-conflict', message: error.message }
          });
        }
        throw error;
      }
    }
  );

  app.post(
    '/recording-jobs/:id/provider-requests/:requestId/finish',
    async (request, response) => {
      if (!requireInternalService(request, response)) {
        return;
      }

      const parsedRequestId = providerRequestIdSchema.safeParse(request.params.requestId);
      const parsedRequest = providerRequestFinishSchema.safeParse(request.body);
      if (!parsedRequestId.success || !parsedRequest.success) {
        return response.status(400).json({
          error: {
            code: 'invalid-request',
            message:
              parsedRequestId.error?.issues[0]?.message ??
              parsedRequest.error?.issues[0]?.message ??
              'The request payload is invalid.'
          }
        });
      }

      const [job, audit] = await Promise.all([
        repository.getByIdIncludingHidden(request.params.id),
        cloudUsageLedgerRepository.getProviderRequest(parsedRequestId.data)
      ]);
      if (!job || !audit || audit.jobId !== job.id) {
        return response.status(404).json(notFoundResponse(request.params.id));
      }
      if (
        audit.leaseTokenHash !== hashLeaseToken(parsedRequest.data.leaseToken) ||
        !wasTerminalLeaseIssued(job, audit.stage, parsedRequest.data.leaseToken)
      ) {
        return response.status(409).json({
          error: {
            code: 'provider-request-lease-mismatch',
            message: 'The provider request was not started under this job lease.'
          }
        });
      }

      try {
        const finished = await cloudUsageLedgerRepository.finishProviderRequest(
          settleProviderRequest(
            audit,
            parsedRequest.data,
            audit.finishedAt ?? new Date().toISOString()
          )
        );
        return response.status(200).json({ request: toProviderRequestApi(finished) });
      } catch (error) {
        if (error instanceof ProviderRequestAuditConflictError) {
          return response.status(409).json({
            error: { code: 'provider-request-audit-conflict', message: error.message }
          });
        }
        throw error;
      }
    }
  );

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
    const nowMs = Date.now();
    const source = request.ip || request.socket.remoteAddress || 'unknown';
    const failure = adminLoginFailures.get(source);
    if (failure && failure.resetAt > nowMs && failure.count >= adminLoginFailureLimit) {
      response.set('Retry-After', String(Math.ceil((failure.resetAt - nowMs) / 1000)));
      return response.status(429).json({
        error: {
          code: 'admin-login-rate-limited',
          message: '登入嘗試次數過多，請稍後再試。'
        }
      });
    }
    if (failure && failure.resetAt <= nowMs) {
      adminLoginFailures.delete(source);
    }

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
      const currentFailure = adminLoginFailures.get(source);
      adminLoginFailures.set(source, {
        count: (currentFailure?.count ?? 0) + 1,
        resetAt: currentFailure?.resetAt ?? nowMs + adminLoginWindowMs
      });
      return response.status(401).json({
        error: {
          code: 'admin-login-invalid',
          message: '帳號或密碼錯誤。'
        }
      });
    }

    adminLoginFailures.delete(source);
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

  app.get('/api/admin/codex-usage', async (request, response) => {
    const authenticatedOperator = await requireAdminOperator(request, response);

    if (!authenticatedOperator) {
      return;
    }

    return response.status(200).json(
      latestCodexWeeklyUsage ?? {
        status: 'unavailable',
        reason: 'not-reported',
        checkedAt: null
      }
    );
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
    const [entries, jobs, dayProviderRequests] = await Promise.all([
      cloudUsageLedgerRepository.listByQuotaDayKey(quotaDayKey),
      repository.listByQuotaDayKey(quotaDayKey),
      cloudUsageLedgerRepository.listProviderRequestsByQuotaDayKey(quotaDayKey)
    ]);
    const submitterIds = [
      ...new Set([...entries, ...jobs, ...dayProviderRequests].map((item) => item.submitterId))
    ].sort();

    const rows = await Promise.all(
      submitterIds.map(async (submitterId) => {
        const [override, user] = await Promise.all([
          operatorCloudQuotaOverrideRepository.getBySubmitterId(submitterId),
          authenticatedUserRepository?.getById(submitterId)
        ]);
        const providerRequests = dayProviderRequests.filter(
          (providerRequest) => providerRequest.submitterId === submitterId
        );
        const dailyQuotaUsd = override?.dailyQuotaUsd ?? currentPolicy.defaultDailyCloudQuotaUsd;
        const reservedUsd = sumReservedUsd(jobs, submitterId, quotaDayKey);
        const consumed = sumActualConsumedUsd(
          entries,
          submitterId,
          quotaDayKey,
          providerRequests
        );

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
            .map((entry) => {
              const resolved = resolveCloudUsageEntryCost(entry);

              return {
                stage: entry.stage,
                provider: entry.provider,
                model: entry.model,
                entryType: entry.entryType,
                pricingStatus: resolved.hasUnpricedUsage ? 'unpriced' : 'priced',
                costUsd:
                  resolved.knownCostUsd > 0 || !resolved.hasUnpricedUsage
                    ? resolved.knownCostUsd
                    : null,
                usageQuantity: entry.usageQuantity,
                usageUnit: entry.usageUnit,
                createdAt: entry.createdAt
              };
            }),
          providerRequests: providerRequests.map(toProviderRequestApi)
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
        providerRequestCount: rows.reduce(
          (total, row) => total + row.providerRequests.length,
          0
        ),
        unpricedEntryCount:
          entries.filter(
            (entry) =>
              entry.entryType === 'actual' &&
              resolveCloudUsageEntryCost(entry).hasUnpricedUsage
          ).length +
          rows.reduce(
            (total, row) =>
              total +
              row.providerRequests.filter(
                (providerRequest) =>
                  providerRequest.billingClass === 'metered-api' &&
                  providerRequest.pricingStatus !== 'priced'
              ).length,
            0
          )
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
    const [ledgerEntries, providerRequestAudits] = await Promise.all([
      cloudUsageLedgerRepository.listRecentEntries(limit),
      cloudUsageLedgerRepository.listRecentProviderRequests(limit)
    ]);

    const legacyEntries = ledgerEntries.map((entry) => {
      const detail = entry.detail ?? {};
      const resolved = resolveCloudUsageEntryCost(entry);
      const inputTokens =
        readFiniteNumber(detail.promptTokens) || readFiniteNumber(detail.inputTokens);
      const cachedInputTokens =
        readFiniteNumber(detail.cachedPromptTokens) ||
        readFiniteNumber(detail.cachedInputTokens);
      const cacheWriteInputTokens =
        readFiniteNumber(detail.cacheWritePromptTokens) ||
        readFiniteNumber(detail.cacheWriteTokens);
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
      const billedAudioMs = readFiniteNumber(detail.billedAudioMs);
      const providerRequestCount =
        readFiniteNumber(detail.providerRequestCount) || readFiniteNumber(detail.requestCount);

      return {
        id: entry.id,
        recordKind: 'ledger-entry' as const,
        createdAt: entry.createdAt,
        quotaDayKey: entry.quotaDayKey,
        jobId: entry.jobId,
        submitterId: entry.submitterId,
        stage: entry.stage,
        provider: entry.provider,
        model: entry.model,
        entryType: entry.entryType,
        billingClass: undefined,
        pricingStatus: resolved.hasUnpricedUsage ? 'unpriced' : 'priced',
        inputTokens,
        cachedInputTokens,
        cacheWritePromptTokens: cacheWriteInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
        audioMs,
        billedAudioMs,
        providerRequestCount,
        costUsd:
          resolved.knownCostUsd > 0 || !resolved.hasUnpricedUsage
            ? resolved.knownCostUsd
            : null
      };
    });
    const providerRequestEntries = providerRequestAudits.map((providerRequest) => {
      const detail = providerRequest.detail ?? {};
      const hasTokenUsage = typeof detail.totalTokens === 'number';
      const inputTokens = readFiniteNumber(detail.inputTokens);
      const cachedInputTokens = readFiniteNumber(detail.cachedInputTokens);
      const cacheWriteInputTokens = readFiniteNumber(detail.cacheWriteInputTokens);
      const outputTokens = readFiniteNumber(detail.outputTokens);
      const reasoningOutputTokens = readFiniteNumber(detail.reasoningOutputTokens);

      return {
        id: providerRequest.requestId,
        recordKind: 'provider-request' as const,
        createdAt: providerRequest.startedAt,
        finishedAt: providerRequest.finishedAt,
        quotaDayKey: providerRequest.quotaDayKey,
        jobId: providerRequest.jobId,
        submitterId: providerRequest.submitterId,
        stage: providerRequest.stage,
        provider: providerRequest.provider,
        model: providerRequest.model,
        entryType: 'actual' as const,
        billingClass: providerRequest.billingClass,
        requestStatus: providerRequest.status,
        providerRequestId: providerRequest.providerRequestId,
        httpStatus: providerRequest.httpStatus,
        errorCode: providerRequest.errorCode,
        pricingStatus: providerRequest.pricingStatus,
        hasTokenUsage,
        inputTokens,
        cachedInputTokens,
        cacheWritePromptTokens: cacheWriteInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens: readFiniteNumber(detail.totalTokens) || inputTokens + outputTokens,
        audioMs: readFiniteNumber(detail.audioMs),
        billedAudioMs: readFiniteNumber(detail.billedAudioMs),
        providerRequestCount: 1,
        costUsd:
          providerRequest.knownCostUsd > 0 || providerRequest.pricingStatus === 'priced'
            ? providerRequest.knownCostUsd
            : null
      };
    });
    const entries = [...legacyEntries, ...providerRequestEntries]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);

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
        billingClass: string | undefined;
        entryCount: number;
        inputTokens: number;
        cachedInputTokens: number;
        cacheWritePromptTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
        totalTokens: number;
        billedAudioMs: number;
        providerRequestCount: number;
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
        billingClass: entry.billingClass,
        entryCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWritePromptTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        billedAudioMs: 0,
        providerRequestCount: 0,
        pricedCostUsd: 0,
        totalCostUsd: 0,
        hasUnpricedUsage: false,
        unpricedEntryCount: 0
      };

      current.entryCount += 1;
      current.inputTokens += entry.inputTokens;
      current.cachedInputTokens += entry.cachedInputTokens;
      current.cacheWritePromptTokens += entry.cacheWritePromptTokens;
      current.outputTokens += entry.outputTokens;
      current.reasoningOutputTokens += entry.reasoningOutputTokens;
      current.totalTokens += entry.totalTokens;
      current.billedAudioMs += entry.billedAudioMs;
      current.providerRequestCount += entry.providerRequestCount;
      current.pricedCostUsd = roundUsd(current.pricedCostUsd + (entry.costUsd ?? 0));

      if (entry.pricingStatus === 'unpriced' || entry.pricingStatus === 'pending') {
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
        accumulator.cacheWritePromptTokens += entry.cacheWritePromptTokens;
        accumulator.outputTokens += entry.outputTokens;
        accumulator.reasoningOutputTokens += entry.reasoningOutputTokens;
        accumulator.totalTokens += entry.totalTokens;
        accumulator.billedAudioMs += entry.billedAudioMs;
        accumulator.providerRequestCount += entry.providerRequestCount;
        accumulator.pricedCostUsd = roundUsd(
          accumulator.pricedCostUsd + (entry.costUsd ?? 0)
        );
        accumulator.audioMs += entry.audioMs;

        if (entry.entryType === 'actual') {
          accumulator.actualEntryCount += 1;
        }

        if (entry.pricingStatus === 'unpriced' || entry.pricingStatus === 'pending') {
          accumulator.unpricedEntryCount += 1;
        }

        return accumulator;
      },
      {
        entryCount: entries.length,
        actualEntryCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWritePromptTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        billedAudioMs: 0,
        providerRequestCount: 0,
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

    const [ledgerEntries, providerRequests] = await Promise.all([
      cloudUsageLedgerRepository.listByJob(job.id),
      cloudUsageLedgerRepository.listProviderRequestsByJob(job.id)
    ]);
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
        const resolved = resolveCloudUsageEntryCost(entry);

        return {
          stage: entry.stage,
          entryType: entry.entryType,
          provider: entry.provider,
          model: entry.model,
          pricingVersion: entry.pricingVersion,
          usageUnit: entry.usageUnit,
          pricingStatus: resolved.hasUnpricedUsage ? 'unpriced' : 'priced',
          costUsd:
            resolved.knownCostUsd > 0 || !resolved.hasUnpricedUsage
              ? resolved.knownCostUsd
              : null,
          inputTokens:
            readFiniteNumber(detail.promptTokens) || readFiniteNumber(detail.inputTokens),
          cachedInputTokens:
            readFiniteNumber(detail.cachedPromptTokens) ||
            readFiniteNumber(detail.cachedInputTokens),
          cacheWritePromptTokens:
            readFiniteNumber(detail.cacheWritePromptTokens) ||
            readFiniteNumber(detail.cacheWriteTokens),
          outputTokens:
            readFiniteNumber(detail.completionTokens) || readFiniteNumber(detail.outputTokens),
          reasoningOutputTokens:
            readFiniteNumber(detail.reasoningCompletionTokens) ||
            readFiniteNumber(detail.reasoningOutputTokens),
          totalTokens: readFiniteNumber(detail.totalTokens),
          requestCount: readFiniteNumber(detail.requestCount),
          providerRequestCount: readFiniteNumber(detail.providerRequestCount),
          acceptedChunkCount: readFiniteNumber(detail.acceptedChunkCount),
          fallbackChunkCount: readFiniteNumber(detail.fallbackChunkCount),
          unmeteredRequestCount: readFiniteNumber(detail.unmeteredRequestCount),
          audioMs: readFiniteNumber(detail.audioMs),
          billedAudioMs: readFiniteNumber(detail.billedAudioMs),
          createdAt: entry.createdAt
        };
      }),
      providerRequests: providerRequests.map(toProviderRequestApi)
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
        summaryCapacity: currentPolicy.concurrencyPools.localSummary
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
    const twdPricing = getAzureRetailPricingSnapshot().twd;
    response.status(200).json({
      defaultJoinName: DEFAULT_JOIN_NAME,
      maxActiveProcessingPerSubmitter: 1,
      submissionTemplates: operatorWorkflowTemplates,
      cloudQuotaEnabled: true,
      pricingReference: {
        source: 'Azure Retail Prices API',
        sourceUrl: twdPricing.meterSource,
        usdToTwdRate: twdPricing.usdToTwdRate,
        verifiedAt: twdPricing.verifiedAt
      },
      notifications: {
        emailConfigured: Boolean(jobNotificationSender)
      }
    });
  });

  app.get('/api/shared-meeting', async (request, response) => {
    setSharedMeetingHeaders(response);
    const token = request.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const parsedToken = token ? parseMeetingShareToken(token) : undefined;

    if (!meetingShareSecretConfigured || !token || !parsedToken) {
      return response.status(404).json(sharedMeetingUnavailableResponse);
    }

    const link = await repository.getMeetingShareLinkByShareId(parsedToken.shareId);
    if (
      !link ||
      !isMeetingShareLinkActive(link) ||
      !verifyMeetingShareToken(token, link, meetingShareSecret)
    ) {
      return response.status(404).json(sharedMeetingUnavailableResponse);
    }

    const job = await repository.getById(link.jobId);
    if (!job || !isMeetingShareEligible(job)) {
      return response.status(404).json(sharedMeetingUnavailableResponse);
    }

    return response.status(200).json(toPublicMeeting(job));
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
      ? await repository.listBySubmitter(submitterId, parsedQuery.data.q)
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
    const shareLink = await repository.getMeetingShareLinkByJobId(job.id);
    const shareEligible = isMeetingShareEligible(job);
    const share = !shareLink
      ? { status: 'none' as const, eligible: shareEligible }
      : {
          status: (
            shareLink.revokedAt
              ? 'revoked'
              : isMeetingShareLinkActive(shareLink)
                ? 'active'
                : 'expired'
          ) as 'active' | 'expired' | 'revoked',
          eligible: shareEligible,
          expiresAt: shareLink.expiresAt
        };

    return response.status(200).json({
      ...toApiRecordingJob({ ...job, ...costSummary }),
      share
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

  app.post('/api/operator/jobs/:id/share', async (request, response) => {
    const parsedRequest = operatorStopRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await resolveShareableOwnedJob(
      request,
      response,
      parsedRequest.data.submitterId
    );
    if (!job) {
      return;
    }

    const link = await repository.getOrCreateMeetingShareLink(
      createMeetingShareLink(job.id)
    );
    return response.status(200).json({
      token: createMeetingShareToken(link, meetingShareSecret),
      expiresAt: link.expiresAt
    });
  });

  app.post('/api/operator/jobs/:id/share/rotate', async (request, response) => {
    const parsedRequest = operatorStopRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await resolveShareableOwnedJob(
      request,
      response,
      parsedRequest.data.submitterId
    );
    if (!job) {
      return;
    }

    const link = await repository.rotateMeetingShareLink(createMeetingShareLink(job.id));
    return response.status(200).json({
      token: createMeetingShareToken(link, meetingShareSecret),
      expiresAt: link.expiresAt
    });
  });

  app.delete('/api/operator/jobs/:id/share', async (request, response) => {
    const parsedRequest = operatorStopRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await resolveOwnedJob(request, response, parsedRequest.data.submitterId);
    if (!job) {
      return;
    }

    await repository.revokeMeetingShareLink(job.id, new Date().toISOString());
    return response.status(204).send();
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

    let artifactCleanup: Awaited<ReturnType<typeof cleanupArtifacts>>;
    try {
      artifactCleanup = await cleanupArtifacts([job]);
    } catch (error) {
      console.error(`failed to clean artifacts for ${job.id}`, error);
      return response.status(503).json({
        error: {
          code: 'artifact-cleanup-failed',
          message: 'Stored artifacts could not be deleted. The history entry remains visible.'
        }
      });
    }

    await adminAuditLogRepository.append({
      actorId: submitterId,
      action: 'operator-history-delete',
      target: job.id,
      after: { policy: ARTIFACT_LIFECYCLE_POLICY, ...artifactCleanup }
    });
    await repository.deleteTerminalJobForSubmitter(job.id, submitterId);

    return response.status(200).json({ deleted: true, artifactCleanup });
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

    const listItems = await repository.listBySubmitter(submitterId);
    const terminalJobs = (
      await Promise.all(
        listItems
          .filter((job) => isTerminalJobState(job.state))
          .map((job) => repository.getById(job.id))
      )
    ).filter((job): job is RecordingJob => Boolean(job));
    let artifactCleanup: Awaited<ReturnType<typeof cleanupArtifacts>>;
    try {
      artifactCleanup = await cleanupArtifacts(terminalJobs);
    } catch (error) {
      console.error(`failed to clean artifacts for ${submitterId} history`, error);
      return response.status(503).json({
        error: {
          code: 'artifact-cleanup-failed',
          message: 'Stored artifacts could not be deleted. History remains visible.'
        }
      });
    }

    await adminAuditLogRepository.append({
      actorId: submitterId,
      action: 'operator-history-clear',
      target: submitterId,
      after: { policy: ARTIFACT_LIFECYCLE_POLICY, ...artifactCleanup }
    });
    const deletedCount = await repository.clearTerminalHistoryForSubmitter(submitterId);

    return response.status(200).json({
      deletedCount,
      artifactCleanup
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
    const activeMeetingListItem = jobs.find(
      (job) =>
        job.inputSource === 'meeting-link' &&
        (job.state === 'joining' || job.state === 'recording')
    );

    if (!activeMeetingListItem) {
      return response.status(409).json({
        error: {
          code: 'no-active-meeting-job',
          message: 'No active meeting bot was found for this operator.'
        }
      });
    }

    const activeMeetingJob = await repository.getById(activeMeetingListItem.id);

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
      if (summaryProvider !== 'local-codex') {
        return response.status(409).json({
          error: {
            code: 'summary-provider-retired',
            message: 'Azure OpenAI summaries are retired; submit or migrate this job to Local Codex.'
          }
        });
      }
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
      const summaryPoolAvailable =
        activeLocalSummaries.length < currentPolicy.concurrencyPools.localSummary;

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

    const parsedRequest = claimSummaryJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    if (parsedRequest.data.codexUsage) {
      latestCodexWeeklyUsage = parsedRequest.data.codexUsage;
    }

    return await runSummaryClaimSerially(async () => {
      const currentPolicy = await transcriptionProviderSettingsRepository.getCurrent();
      const summaryJobs = await repository.listGeneratingSummaryJobs();
      const activeLocalSummaries = summaryJobs.filter(
        (candidate) => !candidate.summaryProvider || !isCloudSummaryProvider(candidate.summaryProvider)
      );
      const localSummaryAvailable =
        activeLocalSummaries.length < currentPolicy.concurrencyPools.localSummary;
      const allowedSummaryProviders = localSummaryAvailable ? [...summaryProviders] : [];

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

  app.post('/recording-jobs/:id/summary-fallback/reservations', async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

    const parsedRequest = summaryFallbackReservationSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const reserved = await repository.reserveSummaryFallback({
      jobId: request.params.id,
      leaseToken: parsedRequest.data.leaseToken,
      reservedAt: new Date().toISOString()
    });

    return response.status(200).json({ reserved });
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
      parsedEvent.data.type === 'summary-artifact-stored' ||
      parsedEvent.data.type === 'summary-failed'
    ) {
      const actualSummaryProvider =
        parsedEvent.data.actualProvider ?? job.summaryProvider ?? 'local-codex';
      if (isCloudSummaryProvider(actualSummaryProvider) && !parsedEvent.data.usage) {
        return response.status(400).json({
          error: {
            code: 'invalid-request',
            message: 'Azure summary callbacks must include complete token usage.'
          }
        });
      }
      if (!isCloudSummaryProvider(actualSummaryProvider) && parsedEvent.data.usage) {
        return response.status(400).json({
          error: {
            code: 'invalid-request',
            message: 'Local Codex summary callbacks cannot report Azure token usage.'
          }
        });
      }
      if (
        parsedEvent.data.actualProvider === 'azure-openai' &&
        parsedEvent.data.usage
      ) {
        const usage = parsedEvent.data.usage;
        const hasMeteredRequest =
          usage.providerRequestCount === 1 &&
          usage.unmeteredRequestCount === 0 &&
          usage.totalTokens > 0;
        const hasUnmeteredFailedRequest =
          parsedEvent.data.type === 'summary-failed' &&
          usage.providerRequestCount === 1 &&
          usage.unmeteredRequestCount === 1 &&
          usage.totalTokens === 0;

        if (
          (parsedEvent.data.type === 'summary-artifact-stored' && !hasMeteredRequest) ||
          (parsedEvent.data.type === 'summary-failed' &&
            !hasMeteredRequest &&
            !hasUnmeteredFailedRequest)
        ) {
          return response.status(400).json({
            error: {
              code: 'invalid-request',
              message: 'Azure fallback callbacks must report exactly one metered or failed request.'
            }
          });
        }
      }
    }

    const terminalLeaseStage = resolveTerminalLeaseStage(job, parsedEvent.data);

    if (isOperatorHiddenJob && !terminalLeaseStage) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    if (terminalLeaseStage && !parsedEvent.data.leaseToken) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: 'Terminal callbacks must include a scheduler-issued lease token.'
        }
      });
    }

    if (
      terminalLeaseStage &&
      parsedEvent.data.leaseToken &&
      !wasTerminalLeaseIssued(job, terminalLeaseStage, parsedEvent.data.leaseToken)
    ) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: 'The terminal callback lease token was not issued for this job stage.'
        }
      });
    }

    const providerRequestValidation = await validateTerminalProviderRequests(
      job,
      parsedEvent.data,
      terminalLeaseStage
    );
    if ('error' in providerRequestValidation) {
      return response.status(409).json({
        error: {
          code: 'provider-request-audit-incomplete',
          message: providerRequestValidation.error
        }
      });
    }

    try {
      await settleCloudUsageFromEvent({
        repository: cloudUsageLedgerRepository,
        job,
        event: parsedEvent.data,
        providerRequests: providerRequestValidation.requests
      });
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

    const policyRecordedJob = recordTerminalArtifactLifecyclePolicy(updatedJob);
    const leaseGuardedSavedJob =
      terminalLeaseStage && parsedEvent.data.leaseToken
        ? await repository.saveIfLeaseActive(policyRecordedJob, {
            stage: terminalLeaseStage,
            leaseToken: parsedEvent.data.leaseToken
          })
        : undefined;

    if (terminalLeaseStage && !leaseGuardedSavedJob) {
      const latestJob = await repository.getById(job.id);
      return response.status(202).json(toApiRecordingJob(latestJob ?? job));
    }

    const savedJob = terminalLeaseStage
      ? await maybeSendTerminalJobNotification(leaseGuardedSavedJob!)
      : await saveJob(policyRecordedJob);

    return response.status(202).json(toApiRecordingJob(savedJob));
  });

  app.get('/recording-jobs/:id', async (request, response) => {
    if (!requireInternalService(request, response)) {
      return;
    }

    const job = await repository.getById(request.params.id);

    if (!job) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    return response.status(200).json(toApiRecordingJob(job));
  });

  const uploadErrorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      response.status(tooLarge ? 413 : 400).json({
        error: {
          code: tooLarge ? 'uploaded-media-too-large' : 'invalid-upload',
          message: tooLarge
            ? 'Uploaded media exceeds the configured size limit.'
            : 'The upload form contains unsupported fields.'
        }
      });
      return;
    }

    next(error);
  };
  app.use(uploadErrorHandler);

  app.get(['/share', '/share.html'], (_request, response) => {
    setSharedMeetingHeaders(response);
    response.sendFile(resolve(publicDir, 'share.html'));
  });

  app.use(express.static(publicDir));

  app.get('/notes/:id', (_request, response) => {
    response.sendFile(resolve(publicDir, 'index.html'));
  });

  app.get('/admin', (_request, response) => {
    response.sendFile(resolve(publicDir, 'admin.html'));
  });

  app.get('/', (_request, response) => {
    response.sendFile(resolve(publicDir, 'index.html'));
  });

  return app;
};
