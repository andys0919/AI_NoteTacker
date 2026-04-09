import type { RecordingJob } from './recording-job.js';
import type { TranscriptionProvider } from './transcription-provider.js';

export interface RecordingJobRepository {
  save(job: RecordingJob): Promise<RecordingJob>;
  getById(id: string): Promise<RecordingJob | undefined>;
  listBySubmitter(submitterId: string): Promise<RecordingJob[]>;
  listByQuotaDayKey(quotaDayKey: string): Promise<RecordingJob[]>;
  deleteTerminalJobForSubmitter(id: string, submitterId: string): Promise<boolean>;
  clearTerminalHistoryForSubmitter(submitterId: string): Promise<number>;
  listActiveProcessingJobs(): Promise<RecordingJob[]>;
  listGeneratingSummaryJobs(): Promise<RecordingJob[]>;
  claimNextQueued(workerId: string): Promise<RecordingJob | undefined>;
  claimNextTranscriptionReady(
    workerId: string,
    allowedProviders?: TranscriptionProvider | TranscriptionProvider[]
  ): Promise<RecordingJob | undefined>;
}
