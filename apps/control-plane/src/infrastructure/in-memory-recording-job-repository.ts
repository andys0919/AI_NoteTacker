import {
  assignRecordingJobToWorker,
  assignSummaryJobToWorker,
  assignTranscriptionJobToWorker,
  isSummaryLeaseExpired,
  refreshLeaseHeartbeatForStage,
  type RecordingJob
} from '../domain/recording-job.js';
import {
  isMeetingShareLinkActive,
  type MeetingShareLink
} from '../domain/meeting-share.js';
import {
  recordingJobMatchesSearchQuery,
  toRecordingJobListItem,
  type RecordingJobListItem
} from '../domain/recording-job-list-item.js';
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
  private readonly meetingShareLinks = new Map<string, MeetingShareLink>();
  private readonly summaryFallbackReservations = new Map<
    string,
    { leaseToken: string; requestId?: string }
  >();
  // Soft-deleted job ids: hidden from the submitter's own views but still
  // retrievable by getById so the admin console can audit them.
  private readonly operatorHiddenJobIds = new Set<string>();

  async save(job: RecordingJob): Promise<RecordingJob> {
    const current = this.jobs.get(job.id);
    const storedJob = {
      ...job,
      issuedTranscriptionLeaseTokens: [
        ...new Set([
          ...(current?.issuedTranscriptionLeaseTokens ?? []),
          ...(job.issuedTranscriptionLeaseTokens ?? [])
        ])
      ],
      issuedSummaryLeaseTokens: [
        ...new Set([
          ...(current?.issuedSummaryLeaseTokens ?? []),
          ...(job.issuedSummaryLeaseTokens ?? [])
        ])
      ]
    };
    this.jobs.set(job.id, storedJob);
    return storedJob;
  }

  async saveIfLeaseActive(
    job: RecordingJob,
    expectedLease: {
      stage: 'transcription' | 'summary';
      leaseToken: string;
    }
  ): Promise<RecordingJob | undefined> {
    const current = this.jobs.get(job.id);
    const activeLeaseToken =
      expectedLease.stage === 'transcription'
        ? current?.transcriptionLeaseToken
        : current?.summaryLeaseToken;

    if (activeLeaseToken !== expectedLease.leaseToken) {
      return undefined;
    }

    return await this.save(job);
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

  async reserveSummaryFallback(input: {
    jobId: string;
    leaseToken: string;
    reservedAt: string;
  }): Promise<boolean> {
    const job = this.jobs.get(input.jobId);
    if (
      !job ||
      job.summaryLeaseToken !== input.leaseToken ||
      isSummaryLeaseExpired(job, Date.parse(input.reservedAt)) ||
      this.summaryFallbackReservations.has(input.jobId)
    ) {
      return false;
    }

    this.summaryFallbackReservations.set(input.jobId, { leaseToken: input.leaseToken });
    return true;
  }

  async claimSummaryFallbackRequest(input: {
    jobId: string;
    leaseToken: string;
    requestId: string;
  }): Promise<boolean> {
    const reservation = this.summaryFallbackReservations.get(input.jobId);
    if (
      !reservation ||
      reservation.leaseToken !== input.leaseToken ||
      (reservation.requestId !== undefined && reservation.requestId !== input.requestId)
    ) {
      return false;
    }

    reservation.requestId = input.requestId;
    return true;
  }

  async getById(id: string): Promise<RecordingJob | undefined> {
    if (this.operatorHiddenJobIds.has(id)) {
      return undefined;
    }

    return this.jobs.get(id);
  }

  async getByIdIncludingHidden(id: string): Promise<RecordingJob | undefined> {
    return this.jobs.get(id);
  }

  async getMeetingShareLinkByJobId(jobId: string): Promise<MeetingShareLink | undefined> {
    return this.meetingShareLinks.get(jobId);
  }

  async getMeetingShareLinkByShareId(shareId: string): Promise<MeetingShareLink | undefined> {
    return [...this.meetingShareLinks.values()].find((link) => link.shareId === shareId);
  }

  async getOrCreateMeetingShareLink(link: MeetingShareLink): Promise<MeetingShareLink> {
    const current = this.meetingShareLinks.get(link.jobId);
    if (current && isMeetingShareLinkActive(current, new Date(link.createdAt))) {
      return current;
    }

    this.meetingShareLinks.set(link.jobId, link);
    return link;
  }

  async rotateMeetingShareLink(link: MeetingShareLink): Promise<MeetingShareLink> {
    this.meetingShareLinks.set(link.jobId, link);
    return link;
  }

  async revokeMeetingShareLink(jobId: string, revokedAt: string): Promise<boolean> {
    const current = this.meetingShareLinks.get(jobId);
    if (!current) {
      return false;
    }

    this.meetingShareLinks.set(jobId, { ...current, revokedAt });
    return true;
  }

  async listBySubmitter(
    submitterId: string,
    searchQuery?: string
  ): Promise<RecordingJobListItem[]> {
    return [...this.jobs.values()]
      .filter(
        (job) =>
          job.submitterId === submitterId &&
          !this.operatorHiddenJobIds.has(job.id) &&
          recordingJobMatchesSearchQuery(job, searchQuery)
      )
      .sort(compareByCreatedAtDesc)
      .map(toRecordingJobListItem);
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
    const pageJobs = filtered.slice(0, input.limit);
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
    const jobs = [...this.jobs.values()].filter(
      (job) => job.submitterId === submitterId && !this.operatorHiddenJobIds.has(job.id)
    );

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

    if (
      !job ||
      job.submitterId !== submitterId ||
      !terminalStates.has(job.state) ||
      this.operatorHiddenJobIds.has(id)
    ) {
      return false;
    }

    // Soft delete: keep the row, just hide it from the submitter's views.
    this.operatorHiddenJobIds.add(id);
    const shareLink = this.meetingShareLinks.get(id);
    if (shareLink) {
      this.meetingShareLinks.set(id, {
        ...shareLink,
        revokedAt: new Date().toISOString()
      });
    }
    return true;
  }

  async clearTerminalHistoryForSubmitter(submitterId: string): Promise<number> {
    const terminalJobIds = [...this.jobs.values()]
      .filter(
        (job) =>
          job.submitterId === submitterId &&
          terminalStates.has(job.state) &&
          !this.operatorHiddenJobIds.has(job.id)
      )
      .map((job) => job.id);

    const revokedAt = new Date().toISOString();
    terminalJobIds.forEach((id) => {
      this.operatorHiddenJobIds.add(id);
      const shareLink = this.meetingShareLinks.get(id);
      if (shareLink) {
        this.meetingShareLinks.set(id, { ...shareLink, revokedAt });
      }
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
        !job.summaryArtifact &&
        !isSummaryLeaseExpired(job)
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

    // A queued job is never itself in processingStates, so "has another active job for
    // this submitter" reduces to "this submitter has any active job". Pre-compute the set
    // of such submitters once instead of re-scanning all jobs per queued candidate (O(n·m) → O(n)).
    const submitterIdsWithActiveJob = new Set(
      [...this.jobs.values()]
        .filter((job) => processingStates.has(job.state))
        .map((job) => job.submitterId)
    );

    const queuedJob = [...this.jobs.values()]
      .filter((job) => job.state === 'queued' && job.inputSource === 'meeting-link')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .find((job) => !submitterIdsWithActiveJob.has(job.submitterId));

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
          job.state === 'transcribing' &&
          ((!job.assignedSummaryWorkerId && job.processingStage === 'summary-pending') ||
            (Boolean(job.assignedSummaryWorkerId) &&
              job.processingStage === 'generating-summary' &&
              isSummaryLeaseExpired(job))) &&
          (!normalizedProviders?.length ||
            normalizedProviders.includes(job.summaryProvider ?? 'local-codex'))
      )
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .at(0);

    if (!summaryJob) {
      return undefined;
    }

    const claimedJob = assignSummaryJobToWorker(summaryJob, workerId);
    this.jobs.set(claimedJob.id, claimedJob);
    return claimedJob;
  }
}
