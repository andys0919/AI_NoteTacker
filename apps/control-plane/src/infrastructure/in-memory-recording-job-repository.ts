import {
  assignRecordingJobToWorker,
  assignTranscriptionJobToWorker,
  type RecordingJob
} from '../domain/recording-job.js';
import type { RecordingJobRepository } from '../domain/recording-job-repository.js';

export class InMemoryRecordingJobRepository implements RecordingJobRepository {
  private readonly jobs = new Map<string, RecordingJob>();

  async save(job: RecordingJob): Promise<RecordingJob> {
    this.jobs.set(job.id, job);
    return job;
  }

  async getById(id: string): Promise<RecordingJob | undefined> {
    return this.jobs.get(id);
  }

  async claimNextQueued(workerId: string): Promise<RecordingJob | undefined> {
    const queuedJob = [...this.jobs.values()]
      .filter((job) => job.state === 'queued')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

    if (!queuedJob) {
      return undefined;
    }

    const claimedJob = assignRecordingJobToWorker(queuedJob, workerId);
    this.jobs.set(claimedJob.id, claimedJob);
    return claimedJob;
  }

  async claimNextTranscriptionReady(workerId: string): Promise<RecordingJob | undefined> {
    const transcribingJob = [...this.jobs.values()]
      .filter((job) =>
        job.state === 'transcribing' &&
        job.recordingArtifact &&
        !job.transcriptArtifact &&
        !job.assignedTranscriptionWorkerId
      )
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0];

    if (!transcribingJob) {
      return undefined;
    }

    const claimedJob = assignTranscriptionJobToWorker(transcribingJob, workerId);
    this.jobs.set(claimedJob.id, claimedJob);
    return claimedJob;
  }
}
