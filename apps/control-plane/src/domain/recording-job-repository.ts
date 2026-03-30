import type { RecordingJob } from './recording-job.js';

export interface RecordingJobRepository {
  save(job: RecordingJob): Promise<RecordingJob>;
  getById(id: string): Promise<RecordingJob | undefined>;
  claimNextQueued(workerId: string): Promise<RecordingJob | undefined>;
  claimNextTranscriptionReady(workerId: string): Promise<RecordingJob | undefined>;
}
