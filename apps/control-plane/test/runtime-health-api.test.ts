import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import type { AuthenticatedUser } from '../src/domain/authenticated-user.js';
import { buildQuotaDayKey } from '../src/domain/cloud-usage.js';
import {
  assignRecordingJobToWorker,
  assignSummaryJobToWorker,
  attachQueuedRecordingArtifact,
  attachTranscriptArtifact,
  createRecordingJob,
  markRecordingJobFailed
} from '../src/domain/recording-job.js';
import { InMemoryRecordingJobRepository } from '../src/infrastructure/in-memory-recording-job-repository.js';

class FakeOperatorAuth {
  constructor(private readonly usersByToken: Record<string, { id: string; email: string }>) {}

  async verifyAuthorizationHeader(header: string | undefined) {
    const token = header?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return undefined;
    }

    return this.usersByToken[token];
  }
}

class FakeAuthenticatedUserRepository {
  private readonly users = new Map<string, AuthenticatedUser>();

  async upsert(user: { id: string; email: string }) {
    const now = new Date().toISOString();
    const existing = this.users.get(user.id);
    const saved = {
      id: user.id,
      email: user.email,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.users.set(user.id, saved);
    return saved;
  }

  async getById(id: string) {
    return this.users.get(id);
  }
}

const withTimestamps = <T extends { createdAt: string; updatedAt: string }>(
  job: T,
  input: Partial<T>
): T => ({
  ...job,
  ...input
});

describe('runtime health API', () => {
  const auth = new FakeOperatorAuth({
    'admin-token': { id: 'admin-user', email: 'admin@example.com' },
    'operator-token': { id: 'operator-user', email: 'operator@example.com' }
  });

  it('returns aggregated runtime health for admins', async () => {
    const quotaDayKey = buildQuotaDayKey(new Date());
    const nowMs = Date.now();
    const repository = new InMemoryRecordingJobRepository();

    const activeMeetingJob = withTimestamps(
      assignRecordingJobToWorker(
        createRecordingJob({
          meetingUrl: 'https://meet.google.com/runtime-health-active',
          platform: 'google-meet',
          submitterId: 'operator-meeting',
          quotaDayKey
        }),
        'meeting-worker'
      ),
      {
        createdAt: new Date(nowMs - 12 * 60_000).toISOString(),
        updatedAt: new Date(nowMs - 30_000).toISOString(),
        recordingLeaseAcquiredAt: new Date(nowMs - 8 * 60_000).toISOString(),
        recordingLeaseHeartbeatAt: new Date(nowMs - 30_000).toISOString(),
        recordingLeaseExpiresAt: new Date(nowMs + 7 * 60_000).toISOString()
      }
    );

    const queuedMeetingJob = withTimestamps(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/runtime-health-queued',
        platform: 'google-meet',
        submitterId: 'operator-meeting-queued',
        quotaDayKey
      }),
      {
        createdAt: new Date(nowMs - 6 * 60_000).toISOString(),
        updatedAt: new Date(nowMs - 6 * 60_000).toISOString()
      }
    );

    const pendingTranscriptionJob = withTimestamps(
      attachQueuedRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'uploaded://pending-transcription.wav',
          platform: 'uploaded-audio',
          inputSource: 'uploaded-audio',
          submitterId: 'operator-upload-queued',
          quotaDayKey,
          summaryRequested: false
        }),
        {
          storageKey: 'uploads/operator-upload-queued/job_pending/pending-transcription.wav',
          downloadUrl:
            'https://storage.example.test/uploads/operator-upload-queued/job_pending/pending-transcription.wav',
          contentType: 'audio/wav'
        }
      ),
      {
        createdAt: new Date(nowMs - 9 * 60_000).toISOString(),
        updatedAt: new Date(nowMs - 5 * 60_000).toISOString()
      }
    );

    const pendingSummaryJob = withTimestamps(
      attachTranscriptArtifact(
        attachQueuedRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'uploaded://pending-summary.wav',
            platform: 'uploaded-audio',
            inputSource: 'uploaded-audio',
            submitterId: 'operator-summary-queued',
            quotaDayKey,
            summaryRequested: true,
            summaryProvider: 'local-codex'
          }),
          {
            storageKey: 'uploads/operator-summary-queued/job_summary_pending/pending-summary.wav',
            downloadUrl:
              'https://storage.example.test/uploads/operator-summary-queued/job_summary_pending/pending-summary.wav',
            contentType: 'audio/wav'
          }
        ),
        {
          storageKey: 'transcripts/job_summary_pending/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_summary_pending/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [{ startMs: 0, endMs: 1000, text: 'pending summary' }]
        }
      ),
      {
        createdAt: new Date(nowMs - 11 * 60_000).toISOString(),
        updatedAt: new Date(nowMs - 4 * 60_000).toISOString()
      }
    );

    const activeSummaryJob = withTimestamps(
      assignSummaryJobToWorker(
        attachTranscriptArtifact(
          attachQueuedRecordingArtifact(
            createRecordingJob({
              meetingUrl: 'uploaded://active-summary.wav',
              platform: 'uploaded-audio',
              inputSource: 'uploaded-audio',
              submitterId: 'operator-summary-active',
              quotaDayKey,
              summaryRequested: true,
              summaryProvider: 'local-codex'
            }),
            {
              storageKey: 'uploads/operator-summary-active/job_summary_active/active-summary.wav',
              downloadUrl:
                'https://storage.example.test/uploads/operator-summary-active/job_summary_active/active-summary.wav',
              contentType: 'audio/wav'
            }
          ),
          {
            storageKey: 'transcripts/job_summary_active/transcript.json',
            downloadUrl: 'https://storage.example.test/transcripts/job_summary_active/transcript.json',
            contentType: 'application/json',
            language: 'en',
            segments: [{ startMs: 0, endMs: 1000, text: 'active summary' }]
          }
        ),
        'summary-worker'
      ),
      {
        createdAt: new Date(nowMs - 14 * 60_000).toISOString(),
        updatedAt: new Date(nowMs - 20_000).toISOString(),
        summaryLeaseAcquiredAt: new Date(nowMs - 5 * 60_000).toISOString(),
        summaryLeaseHeartbeatAt: new Date(nowMs - 20_000).toISOString(),
        summaryLeaseExpiresAt: new Date(nowMs + 9 * 60_000).toISOString()
      }
    );

    const failedUploadJob = withTimestamps(
      markRecordingJobFailed(
        attachQueuedRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'uploaded://failed-upload.wav',
            platform: 'uploaded-audio',
            inputSource: 'uploaded-audio',
            submitterId: 'operator-failed',
            quotaDayKey,
            summaryRequested: false
          }),
          {
            storageKey: 'uploads/operator-failed/job_failed/failed-upload.wav',
            downloadUrl:
              'https://storage.example.test/uploads/operator-failed/job_failed/failed-upload.wav',
            contentType: 'audio/wav'
          }
        ),
        {
          code: 'transcription-worker-stale',
          message: 'Worker stopped heartbeating.'
        }
      ),
      {
        createdAt: new Date(nowMs - 15 * 60_000).toISOString(),
        updatedAt: new Date(nowMs - 12 * 60_000).toISOString()
      }
    );

    const completedUploadJob = withTimestamps(
      attachTranscriptArtifact(
        attachQueuedRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'uploaded://completed-upload.wav',
            platform: 'uploaded-audio',
            inputSource: 'uploaded-audio',
            submitterId: 'operator-completed',
            quotaDayKey,
            summaryRequested: false
          }),
          {
            storageKey: 'uploads/operator-completed/job_completed/completed-upload.wav',
            downloadUrl:
              'https://storage.example.test/uploads/operator-completed/job_completed/completed-upload.wav',
            contentType: 'audio/wav'
          }
        ),
        {
          storageKey: 'transcripts/job_completed/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_completed/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [{ startMs: 0, endMs: 1000, text: 'completed upload' }]
        }
      ),
      {
        createdAt: new Date(nowMs - 10 * 60_000).toISOString(),
        updatedAt: new Date(nowMs - 5 * 60_000).toISOString()
      }
    );

    await Promise.all([
      repository.save(activeMeetingJob),
      repository.save(queuedMeetingJob),
      repository.save(pendingTranscriptionJob),
      repository.save(pendingSummaryJob),
      repository.save(activeSummaryJob),
      repository.save(failedUploadJob),
      repository.save(completedUploadJob)
    ]);

    const app = createApp(repository, {
      operatorAuth: auth,
      authenticatedUserRepository: new FakeAuthenticatedUserRepository(),
      adminEmails: ['admin@example.com']
    });

    const response = await request(app)
      .get('/api/admin/runtime-health')
      .set('authorization', 'Bearer admin-token');

    expect(response.status).toBe(200);
    expect(response.body.quotaDayKey).toBe(quotaDayKey);
    expect(response.body.queues).toMatchObject({
      meeting: { active: 1, queued: 1, saturated: true },
      transcription: { active: 0, queued: 1, saturated: true },
      summary: { active: 1, queued: 1, saturated: true }
    });
    expect(response.body.leases.active).toHaveLength(2);
    expect(response.body.leases.active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobId: activeMeetingJob.id,
          stage: 'recording',
          workerId: 'meeting-worker'
        }),
        expect.objectContaining({
          jobId: activeSummaryJob.id,
          stage: 'summary',
          workerId: 'summary-worker'
        })
      ])
    );
    expect(response.body.leases.oldestLeaseAgeMs).toBeGreaterThan(4 * 60_000);
    expect(response.body.latency.terminalSampleSize).toBe(2);
    expect(response.body.latency.averageTerminalMs).toBeGreaterThan(0);
    expect(response.body.throughput).toMatchObject({
      uploadedToday: 5,
      completedToday: 1,
      completedUploadedToday: 1,
      completedMeetingToday: 0
    });
    expect(response.body.failures).toMatchObject({
      failedToday: 1,
      terminalToday: 2,
      failureRate: 0.5
    });
    expect(response.body.failures.codes).toEqual([
      {
        code: 'transcription-worker-stale',
        count: 1
      }
    ]);
    expect(response.body.cleanup).toEqual({
      pendingJobs: 0,
      policyConfigured: false
    });
  });

  it('rejects runtime health requests from non-admin operators', async () => {
    const app = createApp(undefined, {
      operatorAuth: auth,
      authenticatedUserRepository: new FakeAuthenticatedUserRepository(),
      adminEmails: ['admin@example.com']
    });

    const response = await request(app)
      .get('/api/admin/runtime-health')
      .set('authorization', 'Bearer operator-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('operator-admin-required');
  });
});
