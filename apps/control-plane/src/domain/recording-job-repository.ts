import type { RecordingJob } from './recording-job.js';

export interface RecordingJobRepository {
  save(job: RecordingJob): Promise<RecordingJob>;
  getById(id: string): Promise<RecordingJob | undefined>;
  listBySubmitter(submitterId: string): Promise<RecordingJob[]>;
  deleteTerminalJobForSubmitter(id: string, submitterId: string): Promise<boolean>;
  clearTerminalHistoryForSubmitter(submitterId: string): Promise<number>;
  listActiveProcessingJobs(): Promise<RecordingJob[]>;
  claimNextQueued(workerId: string): Promise<RecordingJob | undefined>;
  claimNextTranscriptionReady(workerId: string): Promise<RecordingJob | undefined>;
}
