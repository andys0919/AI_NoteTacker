import type { SummaryProvider } from './summary-provider.js';
import type { TranscriptionProvider } from './transcription-provider.js';
import {
  DEFAULT_OPERATOR_JOIN_NAME,
  type PreferredExportFormat,
  type SubmissionTemplateId,
  type SummaryProfile
} from './operator-workflow-template.js';

export type MeetingPlatform = 'google-meet' | 'microsoft-teams' | 'zoom' | 'uploaded-audio';
export type RecordingInputSource = 'meeting-link' | 'uploaded-audio';

export type RecordingJobState =
  | 'queued'
  | 'joining'
  | 'recording'
  | 'transcribing'
  | 'completed'
  | 'failed';

export type RecordingJobLeaseStage = 'recording' | 'transcription' | 'summary';

export const DEFAULT_WORKER_LEASE_DURATION_MS = 15 * 60 * 1000;

export type RecordingFailure = {
  code: string;
  message: string;
};

export type RecordingArtifact = {
  storageKey: string;
  downloadUrl: string;
  contentType: string;
};

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type TranscriptArtifact = RecordingArtifact & {
  language: string;
  segments: TranscriptSegment[];
};

export type SummaryArtifact = {
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

export type RecordingJobHistoryEntry = {
  at: string;
  stage: string;
  message: string;
  state: RecordingJobState;
  kind: 'lifecycle' | 'progress' | 'artifact' | 'failure' | 'notification';
};

export type RecordingJob = {
  id: string;
  meetingUrl: string;
  platform: MeetingPlatform;
  inputSource: RecordingInputSource;
  submitterId: string;
  requestedJoinName: string;
  submissionTemplateId?: SubmissionTemplateId;
  summaryProfile?: SummaryProfile;
  preferredExportFormat?: PreferredExportFormat;
  uploadedFileName?: string;
  state: RecordingJobState;
  processingStage?: string;
  processingMessage?: string;
  progressPercent?: number;
  progressProcessedMs?: number;
  progressTotalMs?: number;
  assignedWorkerId?: string;
  assignedTranscriptionWorkerId?: string;
  assignedSummaryWorkerId?: string;
  recordingLeaseToken?: string;
  recordingLeaseAcquiredAt?: string;
  recordingLeaseHeartbeatAt?: string;
  recordingLeaseExpiresAt?: string;
  transcriptionLeaseToken?: string;
  transcriptionLeaseAcquiredAt?: string;
  transcriptionLeaseHeartbeatAt?: string;
  transcriptionLeaseExpiresAt?: string;
  summaryLeaseToken?: string;
  summaryLeaseAcquiredAt?: string;
  summaryLeaseHeartbeatAt?: string;
  summaryLeaseExpiresAt?: string;
  transcriptionProvider?: TranscriptionProvider;
  transcriptionModel?: string;
  summaryProvider?: SummaryProvider;
  summaryModel?: string;
  summaryRequested?: boolean;
  pricingVersion?: string;
  estimatedCloudReservationUsd?: number;
  reservedCloudQuotaUsd?: number;
  quotaDayKey?: string;
  transcriptionAttemptCount?: number;
  createdAt: string;
  updatedAt: string;
  failureCode?: string;
  failureMessage?: string;
  recordingArtifact?: RecordingArtifact;
  transcriptArtifact?: TranscriptArtifact;
  summaryArtifact?: SummaryArtifact;
  jobHistory?: RecordingJobHistoryEntry[];
  terminalNotificationSentAt?: string;
  terminalNotificationTarget?: string;
  terminalNotificationState?: RecordingJobState;
};

type CreateRecordingJobInput = {
  meetingUrl: string;
  platform: MeetingPlatform;
  inputSource?: RecordingInputSource;
  submitterId?: string;
  requestedJoinName?: string;
  submissionTemplateId?: SubmissionTemplateId;
  summaryProfile?: SummaryProfile;
  preferredExportFormat?: PreferredExportFormat;
  uploadedFileName?: string;
  transcriptionProvider?: TranscriptionProvider;
  transcriptionModel?: string;
  summaryProvider?: SummaryProvider;
  summaryModel?: string;
  summaryRequested?: boolean;
  pricingVersion?: string;
  estimatedCloudReservationUsd?: number;
  reservedCloudQuotaUsd?: number;
  quotaDayKey?: string;
};

export const DEFAULT_JOIN_NAME = DEFAULT_OPERATOR_JOIN_NAME;

const validStateTransitions: Record<RecordingJobState, RecordingJobState[]> = {
  queued: ['joining', 'failed'],
  joining: ['recording', 'failed'],
  recording: ['transcribing', 'completed', 'failed'],
  transcribing: ['completed', 'failed'],
  completed: [],
  failed: []
};

const now = (): string => new Date().toISOString();
const addDurationToIso = (value: string, durationMs: number): string =>
  new Date(Date.parse(value) + durationMs).toISOString();

const nextJobId = (): string => `job_${crypto.randomUUID().replace(/-/g, '')}`;
const nextLeaseToken = (): string => `lease_${crypto.randomUUID().replace(/-/g, '')}`;

const clearRecordingLeaseState = {
  assignedWorkerId: undefined,
  recordingLeaseToken: undefined,
  recordingLeaseAcquiredAt: undefined,
  recordingLeaseHeartbeatAt: undefined,
  recordingLeaseExpiresAt: undefined
};

const clearTranscriptionLeaseState = {
  assignedTranscriptionWorkerId: undefined,
  transcriptionLeaseToken: undefined,
  transcriptionLeaseAcquiredAt: undefined,
  transcriptionLeaseHeartbeatAt: undefined,
  transcriptionLeaseExpiresAt: undefined
};

const clearSummaryLeaseState = {
  assignedSummaryWorkerId: undefined,
  summaryLeaseToken: undefined,
  summaryLeaseAcquiredAt: undefined,
  summaryLeaseHeartbeatAt: undefined,
  summaryLeaseExpiresAt: undefined
};

const appendJobHistoryEntry = (
  job: RecordingJob,
  entry: Omit<RecordingJobHistoryEntry, 'at'>
): RecordingJobHistoryEntry[] => {
  const nextEntry: RecordingJobHistoryEntry = {
    at: now(),
    ...entry
  };
  const currentHistory = job.jobHistory ?? [];
  const lastEntry = currentHistory.at(-1);

  if (
    lastEntry &&
    lastEntry.stage === nextEntry.stage &&
    lastEntry.message === nextEntry.message &&
    lastEntry.state === nextEntry.state &&
    lastEntry.kind === nextEntry.kind
  ) {
    return currentHistory;
  }

  return [...currentHistory, nextEntry];
};

const stateHistoryMessage: Record<RecordingJobState, string> = {
  queued: 'Job queued.',
  joining: 'Worker claimed the job and started joining the meeting.',
  recording: 'Meeting recording is in progress.',
  transcribing: 'Job moved into transcription processing.',
  completed: 'Job completed.',
  failed: 'Job failed.'
};

export const createRecordingJob = ({
  meetingUrl,
  platform,
  inputSource = 'meeting-link',
  submitterId = 'anonymous',
  requestedJoinName = DEFAULT_JOIN_NAME,
  submissionTemplateId = 'general',
  summaryProfile = 'general',
  preferredExportFormat = 'markdown',
  uploadedFileName,
  transcriptionProvider,
  transcriptionModel,
  summaryProvider,
  summaryModel,
  summaryRequested = Boolean(summaryProvider),
  pricingVersion,
  estimatedCloudReservationUsd,
  reservedCloudQuotaUsd,
  quotaDayKey
}: CreateRecordingJobInput): RecordingJob => ({
  id: nextJobId(),
  meetingUrl,
  platform,
  inputSource,
  submitterId,
  requestedJoinName,
  submissionTemplateId,
  summaryProfile,
  preferredExportFormat,
  uploadedFileName,
  transcriptionProvider,
  transcriptionModel,
  summaryProvider,
  summaryModel,
  summaryRequested,
  pricingVersion,
  estimatedCloudReservationUsd,
  reservedCloudQuotaUsd,
  quotaDayKey,
  state: 'queued',
  processingStage: 'queued',
  processingMessage: stateHistoryMessage.queued,
  createdAt: now(),
  updatedAt: now(),
  jobHistory: [
    {
      at: now(),
      stage: 'queued',
      message: stateHistoryMessage.queued,
      state: 'queued',
      kind: 'lifecycle'
    }
  ]
});

export const transitionRecordingJobState = (
  job: RecordingJob,
  nextState: RecordingJobState
): RecordingJob => {
  if (!validStateTransitions[job.state].includes(nextState)) {
    throw new Error(`Invalid recording job transition from ${job.state} to ${nextState}`);
  }

  return {
    ...job,
    state: nextState,
    updatedAt: now(),
    jobHistory: appendJobHistoryEntry(job, {
      stage: nextState,
      message: stateHistoryMessage[nextState],
      state: nextState,
      kind: 'lifecycle'
    })
  };
};

export const markRecordingJobFailed = (
  job: RecordingJob,
  failure: RecordingFailure
): RecordingJob => ({
  ...job,
  ...clearRecordingLeaseState,
  ...clearTranscriptionLeaseState,
  ...clearSummaryLeaseState,
  state: 'failed',
  updatedAt: now(),
  processingStage: 'failed',
  processingMessage: failure.message,
  progressPercent: 100,
  failureCode: failure.code,
  failureMessage: failure.message,
  jobHistory: appendJobHistoryEntry(job, {
    stage: 'failed',
    message: failure.message,
    state: 'failed',
    kind: 'failure'
  })
});

export const attachRecordingArtifact = (
  job: RecordingJob,
  recordingArtifact: RecordingArtifact
): RecordingJob => ({
  ...job,
  ...clearRecordingLeaseState,
  recordingArtifact,
  transcriptionAttemptCount: job.transcriptionAttemptCount ?? 0,
  state: 'transcribing',
  processingStage: 'transcribing-audio',
  progressPercent: 65,
  processingMessage: 'Recording artifact stored and queued for transcription.',
  updatedAt: now(),
  jobHistory: appendJobHistoryEntry(job, {
    stage: 'transcribing-audio',
    message: 'Recording artifact stored and queued for transcription.',
    state: 'transcribing',
    kind: 'artifact'
  })
});

export const attachQueuedRecordingArtifact = (
  job: RecordingJob,
  recordingArtifact: RecordingArtifact
): RecordingJob => ({
  ...job,
  recordingArtifact,
  transcriptionAttemptCount: job.transcriptionAttemptCount ?? 0,
  updatedAt: now(),
  jobHistory: appendJobHistoryEntry(job, {
    stage: 'queued',
    message: 'Uploaded media stored and waiting for processing.',
    state: job.state,
    kind: 'artifact'
  })
});

export const attachTranscriptArtifact = (
  job: RecordingJob,
  transcriptArtifact: TranscriptArtifact
): RecordingJob =>
  job.summaryRequested
    ? {
        ...job,
        ...clearTranscriptionLeaseState,
        transcriptArtifact,
        state: 'transcribing',
        processingStage: 'summary-pending',
        processingMessage: 'Transcript generation completed. Waiting for summary generation.',
        progressPercent: 90,
        updatedAt: now(),
        jobHistory: appendJobHistoryEntry(job, {
          stage: 'summary-pending',
          message: 'Transcript generation completed. Waiting for summary generation.',
          state: 'transcribing',
          kind: 'artifact'
        })
      }
    : {
        ...job,
        ...clearTranscriptionLeaseState,
        transcriptArtifact,
        state: 'completed',
        processingStage: 'completed',
        processingMessage: 'Transcript generation completed.',
        progressPercent: 100,
        updatedAt: now(),
        jobHistory: appendJobHistoryEntry(job, {
          stage: 'completed',
          message: 'Transcript generation completed.',
          state: 'completed',
          kind: 'artifact'
        })
      };

export const attachSummaryArtifact = (
  job: RecordingJob,
  summaryArtifact: SummaryArtifact
): RecordingJob => ({
  ...job,
  ...clearSummaryLeaseState,
  summaryArtifact,
  state: 'completed',
  processingStage: 'completed',
  processingMessage: 'Transcript and summary generation completed.',
  progressPercent: 100,
  updatedAt: now(),
  jobHistory: appendJobHistoryEntry(job, {
    stage: 'completed',
    message: 'Transcript and summary generation completed.',
    state: 'completed',
    kind: 'artifact'
  })
});

export const markMeetingJobWaitingForCapacity = (job: RecordingJob): RecordingJob =>
  updateRecordingJobProgress(job, {
    processingStage: 'waiting-for-recording-capacity',
    processingMessage: 'Waiting for meeting bot capacity.'
  });

export const assignRecordingJobToWorker = (
  job: RecordingJob,
  workerId: string
): RecordingJob =>
  activateLeaseForStage(
    {
      ...job,
      assignedWorkerId: workerId,
      recordingLeaseToken: nextLeaseToken(),
      state: 'joining',
      processingStage: 'joining-meeting',
      processingMessage: stateHistoryMessage.joining,
      updatedAt: now(),
      jobHistory: appendJobHistoryEntry(job, {
        stage: 'joining',
        message: stateHistoryMessage.joining,
        state: 'joining',
        kind: 'lifecycle'
      })
    },
    'recording',
    DEFAULT_WORKER_LEASE_DURATION_MS
  );

export const markMeetingRecordingInProgress = (
  job: RecordingJob,
  processingMessage = stateHistoryMessage.recording
): RecordingJob => {
  const nextState = job.state === 'joining' ? 'recording' : job.state;

  return {
    ...job,
    state: nextState,
    processingStage: 'recording',
    processingMessage,
    progressPercent: job.progressPercent ?? 45,
    updatedAt: now(),
    jobHistory: appendJobHistoryEntry(job, {
      stage: 'recording',
      message: processingMessage,
      state: nextState,
      kind: job.state === 'joining' ? 'lifecycle' : 'progress'
    })
  };
};

export const assignTranscriptionJobToWorker = (
  job: RecordingJob,
  workerId: string
): RecordingJob =>
  activateLeaseForStage(
    {
      ...job,
      assignedTranscriptionWorkerId: workerId,
      transcriptionLeaseToken: nextLeaseToken(),
      state: 'transcribing',
      processingStage: job.inputSource === 'uploaded-audio' ? 'preparing-media' : 'transcribing-audio',
      processingMessage:
        job.inputSource === 'uploaded-audio'
          ? 'Preparing uploaded media for transcription.'
          : 'Preparing recording for transcription.',
      progressPercent: job.inputSource === 'uploaded-audio' ? 25 : 65,
      updatedAt: now(),
      jobHistory: appendJobHistoryEntry(job, {
        stage: job.inputSource === 'uploaded-audio' ? 'preparing-media' : 'transcribing-audio',
        message:
          job.inputSource === 'uploaded-audio'
            ? 'Preparing uploaded media for transcription.'
            : 'Preparing recording for transcription.',
        state: 'transcribing',
        kind: 'lifecycle'
      })
    },
    'transcription',
    DEFAULT_WORKER_LEASE_DURATION_MS
  );

export const releaseTranscriptionJobForRetry = (
  job: RecordingJob,
  failure: RecordingFailure,
  maxAttempts: number
): RecordingJob => {
  const nextAttemptCount = (job.transcriptionAttemptCount ?? 0) + 1;

  if (nextAttemptCount >= maxAttempts) {
    return {
      ...job,
      ...clearTranscriptionLeaseState,
      transcriptionAttemptCount: nextAttemptCount,
      state: 'failed',
      processingStage: 'failed',
      processingMessage: failure.message,
      progressPercent: 100,
      failureCode: failure.code,
      failureMessage: failure.message,
      updatedAt: now(),
      jobHistory: appendJobHistoryEntry(job, {
        stage: 'failed',
        message: failure.message,
        state: 'failed',
        kind: 'failure'
      })
    };
  }

  return {
    ...job,
    ...clearTranscriptionLeaseState,
    transcriptionAttemptCount: nextAttemptCount,
    state: 'transcribing',
    processingStage: 'transcribing-audio',
    processingMessage: failure.message,
    progressPercent: 65,
    failureCode: failure.code,
    failureMessage: failure.message,
    updatedAt: now(),
    jobHistory: appendJobHistoryEntry(job, {
      stage: 'transcribing-audio',
      message: failure.message,
      state: 'transcribing',
      kind: 'failure'
      })
  };
};

export const releaseSummaryJobForRetry = (
  job: RecordingJob,
  failure: RecordingFailure
): RecordingJob => ({
  ...job,
  ...clearSummaryLeaseState,
  state: 'transcribing',
  processingStage: 'summary-pending',
  processingMessage: failure.message,
  progressPercent: 90,
  failureCode: failure.code,
  failureMessage: failure.message,
  updatedAt: now(),
  jobHistory: appendJobHistoryEntry(job, {
    stage: 'summary-pending',
    message: failure.message,
    state: 'transcribing',
    kind: 'failure'
  })
});

export const assignSummaryJobToWorker = (
  job: RecordingJob,
  workerId: string
): RecordingJob =>
  activateLeaseForStage(
    {
      ...job,
      assignedSummaryWorkerId: workerId,
      summaryLeaseToken: nextLeaseToken(),
      state: 'transcribing',
      processingStage: 'generating-summary',
      processingMessage: 'Generating meeting summary.',
      progressPercent: 92,
      updatedAt: now(),
      jobHistory: appendJobHistoryEntry(job, {
        stage: 'generating-summary',
        message: 'Generating meeting summary.',
        state: 'transcribing',
        kind: 'lifecycle'
      })
    },
    'summary',
    DEFAULT_WORKER_LEASE_DURATION_MS
  );

export const updateRecordingJobProgress = (
  job: RecordingJob,
  progress: {
    processingStage: string;
    processingMessage?: string;
    progressPercent?: number;
    progressProcessedMs?: number;
    progressTotalMs?: number;
  }
): RecordingJob => ({
  ...job,
  processingStage: progress.processingStage,
  processingMessage: progress.processingMessage,
  progressPercent: progress.progressPercent ?? job.progressPercent,
  progressProcessedMs: progress.progressProcessedMs ?? job.progressProcessedMs,
  progressTotalMs: progress.progressTotalMs ?? job.progressTotalMs,
  updatedAt: now(),
  jobHistory:
    progress.processingStage !== job.processingStage ||
    progress.processingMessage !== job.processingMessage
      ? appendJobHistoryEntry(job, {
          stage: progress.processingStage,
          message: progress.processingMessage ?? stateHistoryMessage[job.state],
          state: job.state,
          kind: 'progress'
        })
      : job.jobHistory
});

export const markTerminalJobNotificationSent = (
  job: RecordingJob,
  notification: {
    to: string;
    state: RecordingJobState;
  }
): RecordingJob => ({
  ...job,
  terminalNotificationSentAt: now(),
  terminalNotificationTarget: notification.to,
  terminalNotificationState: notification.state,
  updatedAt: now(),
  jobHistory: appendJobHistoryEntry(job, {
    stage: 'notification-sent',
    message: `Terminal email notification sent to ${notification.to}.`,
    state: job.state,
    kind: 'notification'
  })
});

export const activateLeaseForStage = (
  job: RecordingJob,
  stage: RecordingJobLeaseStage,
  durationMs: number
): RecordingJob => {
  const activatedAt = now();
  const expiresAt = addDurationToIso(activatedAt, durationMs);

  if (stage === 'recording' && job.recordingLeaseToken) {
    return {
      ...job,
      recordingLeaseAcquiredAt: activatedAt,
      recordingLeaseHeartbeatAt: activatedAt,
      recordingLeaseExpiresAt: expiresAt,
      updatedAt: activatedAt
    };
  }

  if (stage === 'transcription' && job.transcriptionLeaseToken) {
    return {
      ...job,
      transcriptionLeaseAcquiredAt: activatedAt,
      transcriptionLeaseHeartbeatAt: activatedAt,
      transcriptionLeaseExpiresAt: expiresAt,
      updatedAt: activatedAt
    };
  }

  if (stage === 'summary' && job.summaryLeaseToken) {
    return {
      ...job,
      summaryLeaseAcquiredAt: activatedAt,
      summaryLeaseHeartbeatAt: activatedAt,
      summaryLeaseExpiresAt: expiresAt,
      updatedAt: activatedAt
    };
  }

  return job;
};

export const refreshLeaseHeartbeatForStage = (
  job: RecordingJob,
  stage: RecordingJobLeaseStage,
  durationMs: number
): RecordingJob => {
  const heartbeatAt = now();
  const expiresAt = addDurationToIso(heartbeatAt, durationMs);

  if (stage === 'recording' && job.recordingLeaseToken) {
    return {
      ...job,
      recordingLeaseAcquiredAt: job.recordingLeaseAcquiredAt ?? heartbeatAt,
      recordingLeaseHeartbeatAt: heartbeatAt,
      recordingLeaseExpiresAt: expiresAt,
      updatedAt: heartbeatAt
    };
  }

  if (stage === 'transcription' && job.transcriptionLeaseToken) {
    return {
      ...job,
      transcriptionLeaseAcquiredAt: job.transcriptionLeaseAcquiredAt ?? heartbeatAt,
      transcriptionLeaseHeartbeatAt: heartbeatAt,
      transcriptionLeaseExpiresAt: expiresAt,
      updatedAt: heartbeatAt
    };
  }

  if (stage === 'summary' && job.summaryLeaseToken) {
    return {
      ...job,
      summaryLeaseAcquiredAt: job.summaryLeaseAcquiredAt ?? heartbeatAt,
      summaryLeaseHeartbeatAt: heartbeatAt,
      summaryLeaseExpiresAt: expiresAt,
      updatedAt: heartbeatAt
    };
  }

  return job;
};
