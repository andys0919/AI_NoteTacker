import type { RecordingJob } from './recording-job.js';

export type RuntimeHealthQueue = {
  active: number;
  queued: number;
  capacity: number;
  saturated: boolean;
};

export type RuntimeHealthLease = {
  jobId: string;
  submitterId: string;
  stage: 'recording' | 'transcription' | 'summary';
  workerId: string;
  state: string;
  processingStage?: string;
  acquiredAt?: string;
  heartbeatAt?: string;
  expiresAt?: string;
  ageMs: number;
  heartbeatAgeMs: number;
  expiresInMs: number;
};

export type RuntimeHealthReport = {
  generatedAt: string;
  quotaDayKey: string;
  queues: {
    meeting: RuntimeHealthQueue;
    transcription: RuntimeHealthQueue;
    summary: RuntimeHealthQueue;
  };
  leases: {
    active: RuntimeHealthLease[];
    oldestLeaseAgeMs: number;
    staleCount: number;
    churnCount: number;
  };
  latency: {
    oldestActiveMs: number;
    averageTerminalMs: number;
    terminalSampleSize: number;
  };
  throughput: {
    uploadedToday: number;
    completedToday: number;
    completedUploadedToday: number;
    completedMeetingToday: number;
  };
  failures: {
    failedToday: number;
    terminalToday: number;
    failureRate: number;
    codes: Array<{
      code: string;
      count: number;
    }>;
  };
  cleanup: {
    pendingJobs: number;
    policyConfigured: boolean;
  };
};

const parseTimestamp = (value?: string): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const calculateDurationMs = (startAt?: string, endAt?: string): number | undefined => {
  const startMs = parseTimestamp(startAt);
  const endMs = parseTimestamp(endAt);

  if (startMs === undefined || endMs === undefined) {
    return undefined;
  }

  return Math.max(0, endMs - startMs);
};

const buildQueueSnapshot = (active: number, queued: number, capacity: number): RuntimeHealthQueue => ({
  active,
  queued,
  capacity,
  saturated: queued > 0 || active >= capacity
});

const buildActiveLease = (
  job: RecordingJob,
  generatedAtMs: number
): RuntimeHealthLease | undefined => {
  const leaseCandidates = [
    {
      stage: 'summary' as const,
      workerId: job.assignedSummaryWorkerId,
      acquiredAt: job.summaryLeaseAcquiredAt,
      heartbeatAt: job.summaryLeaseHeartbeatAt,
      expiresAt: job.summaryLeaseExpiresAt,
      token: job.summaryLeaseToken
    },
    {
      stage: 'transcription' as const,
      workerId: job.assignedTranscriptionWorkerId,
      acquiredAt: job.transcriptionLeaseAcquiredAt,
      heartbeatAt: job.transcriptionLeaseHeartbeatAt,
      expiresAt: job.transcriptionLeaseExpiresAt,
      token: job.transcriptionLeaseToken
    },
    {
      stage: 'recording' as const,
      workerId: job.assignedWorkerId,
      acquiredAt: job.recordingLeaseAcquiredAt,
      heartbeatAt: job.recordingLeaseHeartbeatAt,
      expiresAt: job.recordingLeaseExpiresAt,
      token: job.recordingLeaseToken
    }
  ];

  const activeLease = leaseCandidates.find((candidate) => candidate.workerId && candidate.token);

  if (!activeLease?.workerId) {
    return undefined;
  }

  const acquiredAtMs = parseTimestamp(activeLease.acquiredAt);
  const heartbeatAtMs = parseTimestamp(activeLease.heartbeatAt) ?? acquiredAtMs;
  const expiresAtMs = parseTimestamp(activeLease.expiresAt);

  return {
    jobId: job.id,
    submitterId: job.submitterId,
    stage: activeLease.stage,
    workerId: activeLease.workerId,
    state: job.state,
    processingStage: job.processingStage,
    acquiredAt: activeLease.acquiredAt,
    heartbeatAt: activeLease.heartbeatAt,
    expiresAt: activeLease.expiresAt,
    ageMs: acquiredAtMs === undefined ? 0 : Math.max(0, generatedAtMs - acquiredAtMs),
    heartbeatAgeMs: heartbeatAtMs === undefined ? 0 : Math.max(0, generatedAtMs - heartbeatAtMs),
    expiresInMs: expiresAtMs === undefined ? 0 : expiresAtMs - generatedAtMs
  };
};

export const buildRuntimeHealthReport = (input: {
  generatedAt: string;
  quotaDayKey: string;
  activeJobs: RecordingJob[];
  jobsToday: RecordingJob[];
  queuedMeetingJobs: number;
  queuedTranscriptionJobs: number;
  queuedSummaryJobs: number;
  meetingCapacity: number;
  transcriptionCapacity: number;
  summaryCapacity: number;
}): RuntimeHealthReport => {
  const generatedAtMs = parseTimestamp(input.generatedAt) ?? Date.now();
  const activeLeases = input.activeJobs
    .map((job) => buildActiveLease(job, generatedAtMs))
    .filter((lease): lease is RuntimeHealthLease => Boolean(lease))
    .sort((left, right) => right.ageMs - left.ageMs);
  const meetingActiveCount = input.activeJobs.filter(
    (job) => job.inputSource === 'meeting-link' && (job.state === 'joining' || job.state === 'recording')
  ).length;
  const transcriptionActiveCount = input.activeJobs.filter(
    (job) => Boolean(job.assignedTranscriptionWorkerId) && !job.transcriptArtifact
  ).length;
  const summaryActiveCount = input.activeJobs.filter(
    (job) => Boolean(job.assignedSummaryWorkerId) && !job.summaryArtifact
  ).length;
  const terminalJobs = input.jobsToday.filter(
    (job) => job.state === 'completed' || job.state === 'failed'
  );
  const terminalDurations = terminalJobs
    .map((job) => calculateDurationMs(job.createdAt, job.updatedAt))
    .filter((value): value is number => value !== undefined);
  const failedJobs = terminalJobs.filter((job) => job.state === 'failed');
  const staleFailures = failedJobs.filter(
    (job) => /stale/i.test(job.failureCode ?? '') || /stale/i.test(job.failureMessage ?? '')
  );
  const failureCodeCounts = [...failedJobs.reduce((counts, job) => {
    const code = job.failureCode ?? 'job-failed';
    counts.set(code, (counts.get(code) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([code, count]) => ({ code, count }));
  const uploadedJobs = input.jobsToday.filter((job) => job.inputSource === 'uploaded-audio');
  const completedJobs = input.jobsToday.filter((job) => job.state === 'completed');

  return {
    generatedAt: input.generatedAt,
    quotaDayKey: input.quotaDayKey,
    queues: {
      meeting: buildQueueSnapshot(meetingActiveCount, input.queuedMeetingJobs, input.meetingCapacity),
      transcription: buildQueueSnapshot(
        transcriptionActiveCount,
        input.queuedTranscriptionJobs,
        input.transcriptionCapacity
      ),
      summary: buildQueueSnapshot(summaryActiveCount, input.queuedSummaryJobs, input.summaryCapacity)
    },
    leases: {
      active: activeLeases,
      oldestLeaseAgeMs: activeLeases[0]?.ageMs ?? 0,
      staleCount:
        staleFailures.length + activeLeases.filter((lease) => lease.expiresInMs <= 0).length,
      churnCount: staleFailures.length
    },
    latency: {
      oldestActiveMs: input.activeJobs.reduce((maxDuration, job) => {
        const createdAtMs = parseTimestamp(job.createdAt);
        if (createdAtMs === undefined) {
          return maxDuration;
        }

        return Math.max(maxDuration, generatedAtMs - createdAtMs);
      }, 0),
      averageTerminalMs:
        terminalDurations.length === 0
          ? 0
          : Math.round(
              terminalDurations.reduce((total, value) => total + value, 0) /
                terminalDurations.length
            ),
      terminalSampleSize: terminalJobs.length
    },
    throughput: {
      uploadedToday: uploadedJobs.length,
      completedToday: completedJobs.length,
      completedUploadedToday: completedJobs.filter((job) => job.inputSource === 'uploaded-audio')
        .length,
      completedMeetingToday: completedJobs.filter((job) => job.inputSource === 'meeting-link')
        .length
    },
    failures: {
      failedToday: failedJobs.length,
      terminalToday: terminalJobs.length,
      failureRate:
        terminalJobs.length === 0 ? 0 : Number((failedJobs.length / terminalJobs.length).toFixed(3)),
      codes: failureCodeCounts
    },
    cleanup: {
      pendingJobs: 0,
      policyConfigured: false
    }
  };
};
