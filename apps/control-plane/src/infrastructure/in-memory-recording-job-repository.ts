import {
  assignRecordingJobToWorker,
  assignTranscriptionJobToWorker,
  type RecordingJob
} from '../domain/recording-job.js';
import type { RecordingJobRepository } from '../domain/recording-job-repository.js';

const processingStates = new Set(['joining', 'recording', 'transcribing']);
const terminalStates = new Set(['failed', 'completed']);

export class InMemoryRecordingJobRepository implements RecordingJobRepository {
  private readonly jobs = new Map<string, RecordingJob>();

  async save(job: RecordingJob): Promise<RecordingJob> {
    this.jobs.set(job.id, job);
    return job;
  }

  async getById(id: string): Promise<RecordingJob | undefined> {
    return this.jobs.get(id);
  }

  async listBySubmitter(submitterId: string): Promise<RecordingJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.submitterId === submitterId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async deleteTerminalJobForSubmitter(id: string, submitterId: string): Promise<boolean> {
    const job = this.jobs.get(id);

    if (!job || job.submitterId !== submitterId || !terminalStates.has(job.state)) {
      return false;
    }

    return this.jobs.delete(id);
  }

  async clearTerminalHistoryForSubmitter(submitterId: string): Promise<number> {
    const terminalJobIds = [...this.jobs.values()]
      .filter((job) => job.submitterId === submitterId && terminalStates.has(job.state))
      .map((job) => job.id);

    terminalJobIds.forEach((id) => {
      this.jobs.delete(id);
    });

    return terminalJobIds.length;
  }

  async listActiveProcessingJobs(): Promise<RecordingJob[]> {
    return [...this.jobs.values()].filter((job) => processingStates.has(job.state));
  }

  private hasOtherActiveJobForSubmitter(submitterId: string, jobId: string): boolean {
    return [...this.jobs.values()].some(
      (job) =>
        job.submitterId === submitterId &&
        job.id !== jobId &&
        processingStates.has(job.state)
    );
  }

  private hasActiveMeetingJob(): boolean {
    return [...this.jobs.values()].some(
      (job) =>
        job.inputSource === 'meeting-link' &&
        (job.state === 'joining' || job.state === 'recording')
    );
  }

  async claimNextQueued(workerId: string): Promise<RecordingJob | undefined> {
    if (this.hasActiveMeetingJob()) {
      return undefined;
    }

    const queuedJob = [...this.jobs.values()]
      .filter((job) => job.state === 'queued' && job.inputSource === 'meeting-link')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .find((job) => !this.hasOtherActiveJobForSubmitter(job.submitterId, job.id));

    if (!queuedJob) {
      return undefined;
    }

    const claimedJob = assignRecordingJobToWorker(queuedJob, workerId);
    this.jobs.set(claimedJob.id, claimedJob);
    return claimedJob;
  }

  async claimNextTranscriptionReady(workerId: string): Promise<RecordingJob | undefined> {
    const transcribingJob = [...this.jobs.values()]
      .filter(
        (job) =>
          job.recordingArtifact &&
          !job.transcriptArtifact &&
          !job.assignedTranscriptionWorkerId &&
          (job.state === 'transcribing' ||
            (job.state === 'queued' && job.inputSource === 'uploaded-audio'))
      )
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .find(
        (job) =>
          job.state === 'transcribing' ||
          !this.hasOtherActiveJobForSubmitter(job.submitterId, job.id)
      );

    if (!transcribingJob) {
      return undefined;
    }

    const claimedJob = assignTranscriptionJobToWorker(transcribingJob, workerId);
    this.jobs.set(claimedJob.id, claimedJob);
    return claimedJob;
  }
}
