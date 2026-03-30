export type MeetingPlatform = 'google-meet' | 'microsoft-teams' | 'zoom';

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

export type RecordingJob = {
  id: string;
  meetingUrl: string;
  platform: MeetingPlatform;
  state: RecordingJobState;
  assignedWorkerId?: string;
  assignedTranscriptionWorkerId?: string;
  transcriptionAttemptCount?: number;
  createdAt: string;
  updatedAt: string;
  failureCode?: string;
  failureMessage?: string;
  recordingArtifact?: RecordingArtifact;
  transcriptArtifact?: TranscriptArtifact;
};

type CreateRecordingJobInput = {
  meetingUrl: string;
  platform: MeetingPlatform;
};

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

export const createRecordingJob = ({
  meetingUrl,
  platform
}: CreateRecordingJobInput): RecordingJob => ({
  id: nextJobId(),
  meetingUrl,
  platform,
  state: 'queued',
  createdAt: now(),
  updatedAt: now()
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
    updatedAt: now()
  };
};

export const markRecordingJobFailed = (
  job: RecordingJob,
  failure: RecordingFailure
): RecordingJob => ({
  ...job,
  state: 'failed',
  updatedAt: now(),
  failureCode: failure.code,
  failureMessage: failure.message
});

export const attachRecordingArtifact = (
  job: RecordingJob,
  recordingArtifact: RecordingArtifact
): RecordingJob => ({
  ...job,
  recordingArtifact,
  transcriptionAttemptCount: job.transcriptionAttemptCount ?? 0,
  state: 'transcribing',
  updatedAt: now()
});

export const attachTranscriptArtifact = (
  job: RecordingJob,
  transcriptArtifact: TranscriptArtifact
): RecordingJob => ({
  ...job,
  assignedTranscriptionWorkerId: undefined,
  transcriptArtifact,
  state: 'completed',
  updatedAt: now()
});

export const assignRecordingJobToWorker = (
  job: RecordingJob,
  workerId: string
): RecordingJob => ({
  ...job,
  assignedWorkerId: workerId,
  state: 'joining',
  updatedAt: now()
});

export const assignTranscriptionJobToWorker = (
  job: RecordingJob,
  workerId: string
): RecordingJob => ({
  ...job,
  assignedTranscriptionWorkerId: workerId,
  state: 'transcribing',
  updatedAt: now()
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
      failureCode: failure.code,
      failureMessage: failure.message,
      updatedAt: now()
    };
  }

  return {
    ...job,
    assignedTranscriptionWorkerId: undefined,
    transcriptionAttemptCount: nextAttemptCount,
    state: 'transcribing',
    failureCode: failure.code,
    failureMessage: failure.message,
    updatedAt: now()
  };
};
