import express from 'express';
import multer from 'multer';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import type { AuthenticatedUserRepository } from './domain/authenticated-user-repository.js';
import type { JobNotificationSender, TerminalJobNotification } from './domain/job-notification-sender.js';
import { evaluateMeetingLinkPolicy } from './domain/meeting-link-policy.js';
import type { RecordingJobRepository } from './domain/recording-job-repository.js';
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
import { InMemoryRecordingJobRepository } from './infrastructure/in-memory-recording-job-repository.js';
import type {
  MeetingBotController,
  MeetingBotRuntimeMonitor
} from './infrastructure/meeting-bot-runtime.js';
import type { OperatorAuth } from './infrastructure/operator-auth.js';
import type { UploadedAudioStorage } from './infrastructure/uploaded-audio-storage.js';

const createRecordingJobRequestSchema = z.object({
  meetingUrl: z.url()
});

const claimRecordingJobRequestSchema = z.object({
  workerId: z.string().min(1)
});

const operatorMeetingJobRequestSchema = z.object({
  submitterId: z.string().trim().min(1).max(120).optional(),
  meetingUrl: z.url(),
  requestedJoinName: z.string().trim().max(120).optional()
});

const operatorJobsQuerySchema = z.object({
  submitterId: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().max(200).optional()
});

const operatorJobExportQuerySchema = z.object({
  submitterId: z.string().trim().min(1).max(120).optional(),
  format: z.enum(['markdown', 'txt', 'srt', 'json'])
});

const operatorStopRequestSchema = z.object({
  submitterId: z.string().trim().min(1).max(120).optional()
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
    transcriptArtifact: transcriptArtifactSchema
  }),
  z.object({
    type: z.literal('summary-artifact-stored'),
    summaryArtifact: summaryArtifactSchema
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
  maxTranscriptionAttempts?: number;
  operatorAuth?: OperatorAuth;
  uploadedAudioStorage?: UploadedAudioStorage;
  meetingBotController?: MeetingBotController;
  meetingBotRuntimeMonitor?: MeetingBotRuntimeMonitor;
  jobNotificationSender?: JobNotificationSender;
  maxConcurrentTranscriptionJobs?: number;
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
  uploadedFileName?: string;
  state: string;
  processingStage?: string;
  processingMessage?: string;
  progressPercent?: number;
  progressProcessedMs?: number;
  progressTotalMs?: number;
  assignedWorkerId?: string;
  assignedTranscriptionWorkerId?: string;
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
  displayState?: string;
}) => ({
  id: job.id,
  meetingUrl: job.meetingUrl,
  platform: job.platform,
  inputSource: job.inputSource,
  submitterId: job.submitterId,
  requestedJoinName: job.requestedJoinName,
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
  transcriptionAttemptCount: job.transcriptionAttemptCount,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  failureCode: job.failureCode,
  failureMessage: job.failureMessage,
  recordingArtifact: job.recordingArtifact,
  transcriptArtifact: job.transcriptArtifact,
  summaryArtifact: job.summaryArtifact,
  jobHistory: job.jobHistory
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

const resolveRequestedJoinName = (value?: string): string => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_JOIN_NAME;
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
  const maxTranscriptionAttempts = options.maxTranscriptionAttempts ?? 3;
  const operatorAuth = options.operatorAuth;
  const uploadedAudioStorage = options.uploadedAudioStorage;
  const meetingBotController = options.meetingBotController;
  const meetingBotRuntimeMonitor = options.meetingBotRuntimeMonitor;
  const jobNotificationSender = options.jobNotificationSender;
  const maxConcurrentTranscriptionJobs = Math.max(
    1,
    options.maxConcurrentTranscriptionJobs ??
      Number(process.env.MAX_CONCURRENT_TRANSCRIPTION_JOBS ?? '1')
  );
  const staleMeetingJobAfterMs = options.staleMeetingJobAfterMs ?? 10 * 60 * 1000;
  const staleMeetingFinalizationAfterMs =
    options.staleMeetingFinalizationAfterMs ?? 2 * 60 * 1000;
  const staleTranscriptionJobAfterMs = options.staleTranscriptionJobAfterMs ?? 15 * 60 * 1000;
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const publicDir = options.publicDir ?? resolve(currentDir, '../public');
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

    const authenticatedOperator = await operatorAuth.verifyAuthorizationHeader(
      request.headers.authorization
    );

    if (!authenticatedOperator) {
      response.status(401).json(authRequiredResponse);
      return undefined;
    }

    await authenticatedUserRepository?.upsert(authenticatedOperator);
    return authenticatedOperator.id;
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

  app.get('/api/operator/config', (_request, response) => {
    response.status(200).json({
      defaultJoinName: DEFAULT_JOIN_NAME,
      maxActiveProcessingPerSubmitter: 1
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

    return response.status(200).json({
      jobs: refreshedJobs.map((job) =>
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

    const job = await saveJob(
      createRecordingJob({
        meetingUrl: parsedRequest.data.meetingUrl,
        platform: supportResult.platform,
        inputSource: 'meeting-link',
        submitterId,
        requestedJoinName: resolveRequestedJoinName(parsedRequest.data.requestedJoinName)
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

    let job = createRecordingJob({
      meetingUrl: buildUploadedAudioMeetingUrl(normalizedFileName),
      platform: 'uploaded-audio',
      inputSource: 'uploaded-audio',
      submitterId,
      requestedJoinName: DEFAULT_JOIN_NAME,
      uploadedFileName: normalizedFileName
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

    const job = await saveJob(
      createRecordingJob({
        meetingUrl: parsedRequest.data.meetingUrl,
        platform: supportResult.platform,
        inputSource: 'meeting-link'
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

    const activeGpuTranscriptions = (await repository.listActiveProcessingJobs()).filter(
      (job) =>
        job.state === 'transcribing' &&
        Boolean(job.assignedTranscriptionWorkerId) &&
        !job.transcriptArtifact
    );

    if (activeGpuTranscriptions.length >= maxConcurrentTranscriptionJobs) {
      return response.status(204).send();
    }

    const claimedJob = await repository.claimNextTranscriptionReady(parsedRequest.data.workerId);

    if (!claimedJob) {
      return response.status(204).send();
    }

    return response.status(200).json(toApiRecordingJob(claimedJob));
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

  app.get('/', (_request, response) => {
    response.sendFile(resolve(publicDir, 'index.html'));
  });

  return app;
};
