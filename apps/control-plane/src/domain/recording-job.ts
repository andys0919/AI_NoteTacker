export type MeetingPlatform = 'google-meet' | 'microsoft-teams' | 'zoom' | 'uploaded-audio';
export type RecordingInputSource = 'meeting-link' | 'uploaded-audio';

export type RecordingJobState =
  | 'queued'
  | 'joining'
  | 'recording'
  | 'transcribing'
  | 'completed'
  | 'failed';

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
  uploadedFileName?: string;
  state: RecordingJobState;
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
  uploadedFileName?: string;
};

export const DEFAULT_JOIN_NAME = 'Solomon - NoteTaker';

const validStateTransitions: Record<RecordingJobState, RecordingJobState[]> = {
  queued: ['joining', 'failed'],
  joining: ['recording', 'failed'],
  recording: ['transcribing', 'completed', 'failed'],
  transcribing: ['completed', 'failed'],
  completed: [],
  failed: []
};

const now = (): string => new Date().toISOString();

const nextJobId = (): string => `job_${crypto.randomUUID().replace(/-/g, '')}`;

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
  uploadedFileName
}: CreateRecordingJobInput): RecordingJob => ({
  id: nextJobId(),
  meetingUrl,
  platform,
  inputSource,
  submitterId,
  requestedJoinName,
  uploadedFileName,
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
): RecordingJob => ({
  ...job,
  assignedTranscriptionWorkerId: undefined,
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
});

export const attachSummaryArtifact = (
  job: RecordingJob,
  summaryArtifact: SummaryArtifact
): RecordingJob => ({
  ...job,
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

export const assignRecordingJobToWorker = (
  job: RecordingJob,
  workerId: string
): RecordingJob => ({
  ...job,
  assignedWorkerId: workerId,
  state: 'joining',
  updatedAt: now(),
  jobHistory: appendJobHistoryEntry(job, {
    stage: 'joining',
    message: stateHistoryMessage.joining,
    state: 'joining',
    kind: 'lifecycle'
  })
});

export const assignTranscriptionJobToWorker = (
  job: RecordingJob,
  workerId: string
): RecordingJob => ({
  ...job,
  assignedTranscriptionWorkerId: workerId,
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
});

export const releaseTranscriptionJobForRetry = (
  job: RecordingJob,
  failure: RecordingFailure,
  maxAttempts: number
): RecordingJob => {
  const nextAttemptCount = (job.transcriptionAttemptCount ?? 0) + 1;

  if (nextAttemptCount >= maxAttempts) {
    return {
      ...job,
      assignedTranscriptionWorkerId: undefined,
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
    assignedTranscriptionWorkerId: undefined,
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
