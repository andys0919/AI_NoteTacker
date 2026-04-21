import {
  assignRecordingJobToWorker,
  assignSummaryJobToWorker,
  assignTranscriptionJobToWorker,
  refreshLeaseHeartbeatForStage,
  type RecordingJob
} from '../domain/recording-job.js';
import { toRecordingJobListItem } from '../domain/recording-job-list-item.js';
import type {
  RecordingJobPage,
  RecordingJobPageCursor,
  RecordingJobRepository,
  RecordingJobStats
} from '../domain/recording-job-repository.js';
import type { SummaryProvider } from '../domain/summary-provider.js';
import type { TranscriptionProvider } from '../domain/transcription-provider.js';

const processingStates = new Set(['joining', 'recording', 'transcribing']);
const terminalStates = new Set(['failed', 'completed']);
const compareByCreatedAtDesc = (left: RecordingJob, right: RecordingJob): number =>
  left.createdAt === right.createdAt
    ? right.id.localeCompare(left.id)
    : right.createdAt.localeCompare(left.createdAt);

export class InMemoryRecordingJobRepository implements RecordingJobRepository {
  private readonly jobs = new Map<string, RecordingJob>();

  async save(job: RecordingJob): Promise<RecordingJob> {
    this.jobs.set(job.id, job);
    return job;
  }

  async heartbeatLease(input: {
    jobId: string;
    stage: 'recording' | 'transcription' | 'summary';
    leaseToken: string;
    heartbeatAt: string;
    expiresAt: string;
  }): Promise<RecordingJob | undefined> {
    const job = this.jobs.get(input.jobId);

    if (!job) {
      return undefined;
    }

    const activeLeaseToken =
      input.stage === 'recording'
        ? job.recordingLeaseToken
        : input.stage === 'transcription'
          ? job.transcriptionLeaseToken
          : job.summaryLeaseToken;

    if (activeLeaseToken !== input.leaseToken) {
      return undefined;
    }

    const updatedJob =
      input.stage === 'recording'
        ? {
            ...refreshLeaseHeartbeatForStage(job, 'recording', 0),
            recordingLeaseAcquiredAt: job.recordingLeaseAcquiredAt ?? input.heartbeatAt,
            recordingLeaseHeartbeatAt: input.heartbeatAt,
            recordingLeaseExpiresAt: input.expiresAt,
            updatedAt: input.heartbeatAt
          }
        : input.stage === 'transcription'
          ? {
              ...refreshLeaseHeartbeatForStage(job, 'transcription', 0),
              transcriptionLeaseAcquiredAt: job.transcriptionLeaseAcquiredAt ?? input.heartbeatAt,
              transcriptionLeaseHeartbeatAt: input.heartbeatAt,
              transcriptionLeaseExpiresAt: input.expiresAt,
              updatedAt: input.heartbeatAt
            }
          : {
              ...refreshLeaseHeartbeatForStage(job, 'summary', 0),
              summaryLeaseAcquiredAt: job.summaryLeaseAcquiredAt ?? input.heartbeatAt,
              summaryLeaseHeartbeatAt: input.heartbeatAt,
              summaryLeaseExpiresAt: input.expiresAt,
              updatedAt: input.heartbeatAt
            };

    this.jobs.set(job.id, updatedJob);
    return updatedJob;
  }

  async getById(id: string): Promise<RecordingJob | undefined> {
    return this.jobs.get(id);
  }

  async listBySubmitter(submitterId: string): Promise<RecordingJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.submitterId === submitterId)
      .sort(compareByCreatedAtDesc);
  }

  async listBySubmitterPage(
    submitterId: string,
    input: { limit: number; cursor?: RecordingJobPageCursor }
  ): Promise<RecordingJobPage> {
    const ordered = await this.listBySubmitter(submitterId);
    const cursor = input.cursor;
    const filtered = cursor
      ? ordered.filter(
          (job) =>
            job.createdAt < cursor.createdAt ||
            (job.createdAt === cursor.createdAt && job.id < cursor.id)
        )
      : ordered;
    const pageJobs = filtered.slice(0, input.limit).map(toRecordingJobListItem);
    const hasMore = filtered.length > input.limit;
    const nextJob = hasMore ? pageJobs.at(-1) : undefined;

    return {
      jobs: pageJobs,
      nextCursor: nextJob
        ? {
            createdAt: nextJob.createdAt,
            id: nextJob.id
          }
        : undefined
    };
  }

  async summarizeBySubmitter(submitterId: string): Promise<RecordingJobStats> {
    const jobs = [...this.jobs.values()].filter((job) => job.submitterId === submitterId);

    return {
      totalCount: jobs.length,
      activeCount: jobs.filter((job) => processingStates.has(job.state)).length,
      queuedCount: jobs.filter((job) => job.state === 'queued').length,
      completedCount: jobs.filter((job) => job.state === 'completed').length,
      failedCount: jobs.filter((job) => job.state === 'failed').length
    };
  }

  async listByQuotaDayKey(quotaDayKey: string): Promise<RecordingJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.quotaDayKey === quotaDayKey)
      .sort(compareByCreatedAtDesc);
  }

  async countQueuedMeetingJobs(): Promise<number> {
    return [...this.jobs.values()].filter(
      (job) => job.inputSource === 'meeting-link' && job.state === 'queued'
    ).length;
  }

  async countPendingTranscriptionJobs(): Promise<number> {
    return [...this.jobs.values()].filter(
      (job) =>
        Boolean(job.recordingArtifact) &&
        !job.transcriptArtifact &&
        !job.assignedTranscriptionWorkerId &&
        (job.state === 'transcribing' || (job.state === 'queued' && job.inputSource === 'uploaded-audio'))
    ).length;
  }

  async countPendingSummaryJobs(): Promise<number> {
    return [...this.jobs.values()].filter(
      (job) =>
        job.summaryRequested &&
        Boolean(job.transcriptArtifact) &&
        !job.summaryArtifact &&
        !job.assignedSummaryWorkerId &&
        job.state === 'transcribing' &&
        job.processingStage === 'summary-pending'
    ).length;
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

  async listGeneratingSummaryJobs(): Promise<RecordingJob[]> {
    return [...this.jobs.values()].filter(
      (job) =>
        job.summaryRequested &&
        Boolean(job.assignedSummaryWorkerId) &&
        !job.summaryArtifact
    );
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

  async claimNextTranscriptionReady(
    workerId: string,
    allowedProviders?: TranscriptionProvider | TranscriptionProvider[]
  ): Promise<RecordingJob | undefined> {
    const normalizedProviders = !allowedProviders
      ? undefined
      : Array.isArray(allowedProviders)
        ? allowedProviders
        : [allowedProviders];
    const transcribingJob = [...this.jobs.values()]
      .filter(
        (job) =>
          job.recordingArtifact &&
          !job.transcriptArtifact &&
          !job.assignedTranscriptionWorkerId &&
          (!normalizedProviders?.length ||
            normalizedProviders.includes(job.transcriptionProvider ?? 'self-hosted-whisper')) &&
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
    const patchedClaimedJob =
      !claimedJob.transcriptionProvider && normalizedProviders?.length === 1
        ? {
            ...claimedJob,
            transcriptionProvider: normalizedProviders[0]
          }
        : claimedJob;
    this.jobs.set(patchedClaimedJob.id, patchedClaimedJob);
    return patchedClaimedJob;
  }

  async claimNextSummaryReady(
    workerId: string,
    allowedProviders?: SummaryProvider | SummaryProvider[]
  ): Promise<RecordingJob | undefined> {
    const normalizedProviders = !allowedProviders
      ? undefined
      : Array.isArray(allowedProviders)
        ? allowedProviders
        : [allowedProviders];
    const summaryJob = [...this.jobs.values()]
      .filter(
        (job) =>
          job.summaryRequested &&
          Boolean(job.transcriptArtifact) &&
          !job.summaryArtifact &&
          !job.assignedSummaryWorkerId &&
          job.state === 'transcribing' &&
          (!normalizedProviders?.length ||
            normalizedProviders.includes(job.summaryProvider ?? 'local-codex'))
      )
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .find((job) => job.processingStage === 'summary-pending');

    if (!summaryJob) {
      return undefined;
    }

    const claimedJob = assignSummaryJobToWorker(summaryJob, workerId);
    this.jobs.set(claimedJob.id, claimedJob);
    return claimedJob;
  }
}
