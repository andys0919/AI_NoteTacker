import type { RecordingJob, RecordingJobLeaseStage } from './recording-job.js';
import type { RecordingJobListItem } from './recording-job-list-item.js';
import type { SummaryProvider } from './summary-provider.js';
import type { TranscriptionProvider } from './transcription-provider.js';

export type RecordingJobPageCursor = {
  createdAt: string;
  id: string;
};

export type RecordingJobPage = {
  jobs: RecordingJobListItem[];
  nextCursor?: RecordingJobPageCursor;
};

export type RecordingJobStats = {
  totalCount: number;
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  failedCount: number;
};

export interface RecordingJobRepository {
  save(job: RecordingJob): Promise<RecordingJob>;
  heartbeatLease(input: {
    jobId: string;
    stage: RecordingJobLeaseStage;
    leaseToken: string;
    heartbeatAt: string;
    expiresAt: string;
  }): Promise<RecordingJob | undefined>;
  getById(id: string): Promise<RecordingJob | undefined>;
  listBySubmitter(submitterId: string): Promise<RecordingJob[]>;
  listBySubmitterPage(
    submitterId: string,
    input: { limit: number; cursor?: RecordingJobPageCursor }
  ): Promise<RecordingJobPage>;
  summarizeBySubmitter(submitterId: string): Promise<RecordingJobStats>;
  listByQuotaDayKey(quotaDayKey: string): Promise<RecordingJob[]>;
  countQueuedMeetingJobs(): Promise<number>;
  countPendingTranscriptionJobs(): Promise<number>;
  countPendingSummaryJobs(): Promise<number>;
  deleteTerminalJobForSubmitter(id: string, submitterId: string): Promise<boolean>;
  clearTerminalHistoryForSubmitter(submitterId: string): Promise<number>;
  listActiveProcessingJobs(): Promise<RecordingJob[]>;
  listGeneratingSummaryJobs(): Promise<RecordingJob[]>;
  claimNextQueued(workerId: string): Promise<RecordingJob | undefined>;
  claimNextTranscriptionReady(
    workerId: string,
    allowedProviders?: TranscriptionProvider | TranscriptionProvider[]
  ): Promise<RecordingJob | undefined>;
  claimNextSummaryReady(
    workerId: string,
    allowedProviders?: SummaryProvider | SummaryProvider[]
  ): Promise<RecordingJob | undefined>;
}
