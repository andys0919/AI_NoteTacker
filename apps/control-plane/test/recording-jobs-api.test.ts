import { statSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import type { AuthenticatedUser } from '../src/domain/authenticated-user.js';
import {
  assignRecordingJobToWorker,
  attachRecordingArtifact,
  attachSummaryArtifact,
  attachTranscriptArtifact,
  createRecordingJob,
  markRecordingJobFailed,
  transitionRecordingJobState
} from '../src/domain/recording-job.js';
import { InMemoryRecordingJobRepository } from '../src/infrastructure/in-memory-recording-job-repository.js';

class FakeUploadedAudioStorage {
  readonly uploads: Array<{
    jobId: string;
    submitterId: string;
    originalName: string;
    contentType: string;
    size: number;
  }> = [];

  async storeUpload(input: {
    jobId: string;
    submitterId: string;
    originalName: string;
    contentType: string;
    bytes?: Buffer;
    filePath?: string;
  }) {
    this.uploads.push({
      jobId: input.jobId,
      submitterId: input.submitterId,
      originalName: input.originalName,
      contentType: input.contentType,
      size: input.bytes?.length ?? (input.filePath ? statSync(input.filePath).size : 0)
    });

    return {
      storageKey: `uploads/${input.submitterId}/${input.jobId}/${input.originalName}`,
      downloadUrl: `https://storage.example.test/uploads/${input.submitterId}/${input.jobId}/${input.originalName}`,
      contentType: input.contentType
    };
  }
}

class FakeMeetingBotController {
  stopCount = 0;

  async stopCurrentBot() {
    this.stopCount += 1;
  }
}

class FakeMeetingBotRuntimeMonitor {
  constructor(private readonly busy: boolean) {}

  async isBusy() {
    return this.busy;
  }
}

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

class FakeJobNotificationSender {
  readonly sent: Array<{
    to: string;
    state: string;
    jobId: string;
    subject: string;
    text: string;
  }> = [];

  async sendTerminalJobNotification(input: {
    to: string;
    state: string;
    jobId: string;
    subject: string;
    text: string;
  }) {
    this.sent.push(input);
  }
}

describe('recording jobs API', () => {
  it('creates a queued recording job for a supported Google Meet link', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toMatch(/^job_/);
    expect(response.body.state).toBe('queued');
    expect(response.body.platform).toBe('google-meet');
    expect(response.body.failureCode).toBeUndefined();
  });

  it('creates a queued recording job for a supported Teams live link', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://teams.live.com/meet/9355309505556?p=TPOX0uAbGd14AdxRDS'
      });

    expect(response.status).toBe(201);
    expect(response.body.state).toBe('queued');
    expect(response.body.platform).toBe('microsoft-teams');
  });

  it('creates a queued recording job for a Zoom link with an embedded passcode', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://us06web.zoom.us/j/123456789?pwd=7b18950c7815jk1hg5&omn=468791'
      });

    expect(response.status).toBe(201);
    expect(response.body.state).toBe('queued');
    expect(response.body.platform).toBe('zoom');
  });

  it('creates a queued recording job for a Zoom web client link', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://app.zoom.us/wc/join/123456789?pwd=7b18950c7815jk1hg5'
      });

    expect(response.status).toBe(201);
    expect(response.body.state).toBe('queued');
    expect(response.body.platform).toBe('zoom');
  });

  it('rejects a meeting link that requires authentication instead of direct join', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://accounts.google.com/'
      });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('unsupported-meeting-link');
  });

  it('retrieves an existing recording job by id', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_example'
      });

    const fetched = await request(app).get(`/recording-jobs/${created.body.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(created.body.id);
    expect(fetched.body.state).toBe('queued');
    expect(fetched.body.platform).toBe('microsoft-teams');
  });

  it('allows a recording worker to claim the next queued job', async () => {
    const app = createApp();

    await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    const claim = await request(app)
      .post('/recording-workers/claims')
      .send({
        workerId: 'worker-alpha'
      });

    expect(claim.status).toBe(200);
    expect(claim.body.state).toBe('joining');
    expect(claim.body.assignedWorkerId).toBe('worker-alpha');
    expect(claim.body.platform).toBe('google-meet');
    expect(claim.body.leaseToken).toBeTruthy();
    expect(claim.body.leaseAcquiredAt).toBeTruthy();
    expect(claim.body.leaseHeartbeatAt).toBeTruthy();
    expect(claim.body.leaseExpiresAt).toBeTruthy();
  });

  it('returns 204 when no queued job is available for workers to claim', async () => {
    const app = createApp();

    const claim = await request(app)
      .post('/recording-workers/claims')
      .send({
        workerId: 'worker-alpha'
      });

    expect(claim.status).toBe(204);
  });

  it('allows a transcription worker to claim a transcribing job', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_123/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_123/meeting.webm',
          contentType: 'video/webm'
        }
      });

    const claim = await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-alpha'
      });

    expect(claim.status).toBe(200);
    expect(claim.body.state).toBe('transcribing');
    expect(claim.body.assignedTranscriptionWorkerId).toBe('transcriber-alpha');
    expect(claim.body.recordingArtifact.storageKey).toBe('recordings/job_123/meeting.webm');
    expect(claim.body.leaseToken).toBeTruthy();
    expect(claim.body.leaseAcquiredAt).toBeTruthy();
    expect(claim.body.leaseHeartbeatAt).toBeTruthy();
    expect(claim.body.leaseExpiresAt).toBeTruthy();
  });

  it('gates transcription claims when the shared gpu transcription slot is full', async () => {
    const uploadedAudioStorage = new FakeUploadedAudioStorage();
    const app = createApp(undefined, {
      uploadedAudioStorage,
      maxConcurrentTranscriptionJobs: 1
    });

    const first = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-a')
      .attach('audio', Buffer.from('audio-a'), {
        filename: 'first.wav',
        contentType: 'audio/wav'
      });

    const second = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-b')
      .attach('audio', Buffer.from('audio-b'), {
        filename: 'second.wav',
        contentType: 'audio/wav'
      });

    const firstClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcriber-alpha' });

    const secondClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcriber-beta' });

    expect(firstClaim.status).toBe(200);
    expect(secondClaim.status).toBe(204);

    const secondJob = await request(app).get(`/recording-jobs/${second.body.id}`);
    expect(secondJob.body.state).toBe('queued');
  });

  it('does not allow a second transcription worker to claim a leased transcription job', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_lease/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_lease/meeting.webm',
          contentType: 'video/webm'
        }
      });

    const firstClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-alpha'
      });

    const secondClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-beta'
      });

    expect(firstClaim.status).toBe(200);
    expect(secondClaim.status).toBe(204);
  });

  it('releases a transcription job for retry after a transcription failure below the max attempts', async () => {
    const app = createApp(undefined, { maxTranscriptionAttempts: 3 });

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_retry/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_retry/meeting.webm',
          contentType: 'video/webm'
        }
      });

    await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-alpha'
      });

    const failedEvent = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcription-failed',
        failure: {
          code: 'transcription-failed',
          message: 'faster-whisper failed to decode audio'
        }
      });

    expect(failedEvent.status).toBe(202);
    expect(failedEvent.body.state).toBe('transcribing');
    expect(failedEvent.body.assignedTranscriptionWorkerId).toBeUndefined();
    expect(failedEvent.body.transcriptionAttemptCount).toBe(1);

    const retriedClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-beta'
      });

    expect(retriedClaim.status).toBe(200);
    expect(retriedClaim.body.assignedTranscriptionWorkerId).toBe('transcriber-beta');
  });

  it('marks a transcription job failed after exhausting max attempts', async () => {
    const app = createApp(undefined, { maxTranscriptionAttempts: 2 });

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_fail/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_fail/meeting.webm',
          contentType: 'video/webm'
        }
      });

    await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-alpha'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcription-failed',
        failure: {
          code: 'transcription-failed',
          message: 'first failure'
        }
      });

    await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-beta'
      });

    const terminalFailure = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcription-failed',
        failure: {
          code: 'transcription-failed',
          message: 'second failure'
        }
      });

    expect(terminalFailure.status).toBe(202);
    expect(terminalFailure.body.state).toBe('failed');
    expect(terminalFailure.body.transcriptionAttemptCount).toBe(2);

    const nextClaim = await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-gamma'
      });

    expect(nextClaim.status).toBe(204);
  });

  it('reclaims a stale transcription lease and lets a new worker resume the job', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const staleJob = {
      ...attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'uploaded://stale-lease.m4a',
          platform: 'uploaded-audio',
          inputSource: 'uploaded-audio',
          submitterId: 'operator-stale',
          uploadedFileName: 'stale-lease.m4a'
        }),
        {
          storageKey: 'uploads/operator-stale/job_stale/stale-lease.m4a',
          downloadUrl: 'https://storage.example.test/uploads/operator-stale/job_stale/stale-lease.m4a',
          contentType: 'audio/mp4'
        }
      ),
      assignedTranscriptionWorkerId: 'transcriber-crashed',
      transcriptionLeaseToken: 'lease_stale_transcription',
      transcriptionLeaseAcquiredAt: '2026-03-30T00:00:00.000Z',
      transcriptionLeaseHeartbeatAt: '2026-03-30T00:00:00.000Z',
      transcriptionLeaseExpiresAt: '2026-03-30T00:15:00.000Z',
      transcriptionAttemptCount: 0,
      processingStage: 'transcribing-audio',
      processingMessage: 'Worker stopped heartbeating mid-transcription.',
      updatedAt: '2026-04-10T00:00:00.000Z'
    };
    await repository.save(staleJob);
    const app = createApp(repository, { maxTranscriptionAttempts: 3 });

    const claim = await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-retry'
      });

    expect(claim.status).toBe(200);
    expect(claim.body.id).toBe(staleJob.id);
    expect(claim.body.assignedTranscriptionWorkerId).toBe('transcriber-retry');
    expect(claim.body.transcriptionAttemptCount).toBe(1);
  });

  it('refreshes a transcription lease heartbeat through the internal heartbeat route', async () => {
    const app = createApp(undefined, { uploadedAudioStorage: new FakeUploadedAudioStorage() });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-heartbeat')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'heartbeat.m4a',
        contentType: 'audio/mp4'
      });

    const claim = await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-alpha'
      });

    expect(claim.status).toBe(200);

    const heartbeat = await request(app)
      .post(`/recording-jobs/${created.body.id}/leases/heartbeat`)
      .send({
        stage: 'transcription',
        leaseToken: claim.body.leaseToken
      });

    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.leaseHeartbeatAt).toBeTruthy();
    expect(heartbeat.body.leaseExpiresAt).toBeTruthy();
  });

  it('does not reclaim a transcription lease that still has a fresh heartbeat even if updatedAt is old', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const freshHeartbeatJob = {
      ...attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'uploaded://fresh-heartbeat.m4a',
          platform: 'uploaded-audio',
          inputSource: 'uploaded-audio',
          submitterId: 'operator-fresh',
          uploadedFileName: 'fresh-heartbeat.m4a'
        }),
        {
          storageKey: 'uploads/operator-fresh/job_heartbeat/fresh-heartbeat.m4a',
          downloadUrl:
            'https://storage.example.test/uploads/operator-fresh/job_heartbeat/fresh-heartbeat.m4a',
          contentType: 'audio/mp4'
        }
      ),
      assignedTranscriptionWorkerId: 'transcriber-alive',
      transcriptionLeaseToken: 'lease_alive_transcription',
      transcriptionLeaseAcquiredAt: '2026-04-10T00:00:00.000Z',
      transcriptionLeaseHeartbeatAt: new Date(Date.now() - 60_000).toISOString(),
      transcriptionLeaseExpiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
      transcriptionAttemptCount: 0,
      processingStage: 'transcribing-audio',
      processingMessage: 'Transcription worker is still heartbeating.',
      updatedAt: '2026-03-30T00:00:00.000Z'
    };
    await repository.save(freshHeartbeatJob);
    const app = createApp(repository, { maxTranscriptionAttempts: 3 });

    const claim = await request(app)
      .post('/transcription-workers/claims')
      .send({
        workerId: 'transcriber-retry'
      });

    expect(claim.status).toBe(204);
  });

  it('accepts a worker callback that stores recording artifact metadata', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    const callback = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_123/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_123/meeting.webm',
          contentType: 'video/webm'
        }
      });

    expect(callback.status).toBe(202);
    expect(callback.body.state).toBe('transcribing');
    expect(callback.body.recordingArtifact.storageKey).toBe('recordings/job_123/meeting.webm');
  });

  it('accepts worker lifecycle callbacks for joining and recording states', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    const joining = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'state-updated',
        state: 'joining'
      });

    expect(joining.status).toBe(202);
    expect(joining.body.state).toBe('joining');

    const recording = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'state-updated',
        state: 'recording'
      });

    expect(recording.status).toBe(202);
    expect(recording.body.state).toBe('recording');
  });

  it('returns recording and transcript artifacts after worker callbacks complete', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_456/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_456/meeting.webm',
          contentType: 'video/webm'
        }
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: 'transcripts/job_456/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_456/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1200,
              text: 'hello everyone'
            }
          ]
        }
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        summaryArtifact: {
          model: 'gpt-5.3-codex-spark',
          reasoningEffort: 'medium',
          text: 'Short summary',
          structured: {
            summary: 'Short summary',
            keyPoints: ['hello everyone'],
            actionItems: ['send recap'],
            decisions: ['ship beta'],
            risks: ['deadline risk'],
            openQuestions: ['who owns rollout']
          }
        }
      });

    const fetched = await request(app).get(`/recording-jobs/${created.body.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.state).toBe('completed');
    expect(fetched.body.recordingArtifact.storageKey).toBe('recordings/job_456/meeting.webm');
    expect(fetched.body.transcriptArtifact.storageKey).toBe('transcripts/job_456/transcript.json');
    expect(fetched.body.transcriptArtifact.segments).toHaveLength(1);
    expect(fetched.body.summaryArtifact.model).toBe('gpt-5.3-codex-spark');
    expect(fetched.body.summaryArtifact.text).toBe('Short summary');
    expect(fetched.body.summaryArtifact.structured.actionItems).toEqual(['send recap']);
  });

  it('keeps a summary-enabled job non-terminal after transcript persistence until summary finishes', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/sum-mary-pnd'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_summary_pending/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_summary_pending/meeting.webm',
          contentType: 'video/webm'
        }
      });

    const transcriptCallback = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: 'transcripts/job_summary_pending/transcript.json',
          downloadUrl:
            'https://storage.example.test/transcripts/job_summary_pending/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1200,
              text: 'hello everyone'
            }
          ]
        }
      });

    expect(transcriptCallback.status).toBe(202);
    expect(transcriptCallback.body.state).toBe('transcribing');
    expect(transcriptCallback.body.processingStage).toBe('summary-pending');

    const summaryClaim = await request(app)
      .post('/summary-workers/claims')
      .send({
        workerId: 'summary-alpha'
      });

    expect(summaryClaim.status).toBe(200);
    expect(summaryClaim.body.id).toBe(created.body.id);
    expect(summaryClaim.body.processingStage).toBe('generating-summary');

    const summaryCallback = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        leaseToken: summaryClaim.body.leaseToken,
        summaryArtifact: {
          model: 'gpt-5.3-codex-spark',
          reasoningEffort: 'medium',
          text: 'Short summary',
          structured: {
            summary: 'Short summary',
            keyPoints: ['hello everyone'],
            actionItems: ['send recap'],
            decisions: ['ship beta'],
            risks: ['deadline risk'],
            openQuestions: ['who owns rollout']
          }
        }
      });

    expect(summaryCallback.status).toBe(202);
    expect(summaryCallback.body.state).toBe('completed');
  });

  it('ignores a summary callback with the wrong active lease token', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/wrg-summ-tok'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_wrong_summary/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_wrong_summary/meeting.webm',
          contentType: 'video/webm'
        }
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: 'transcripts/job_wrong_summary/transcript.json',
          downloadUrl:
            'https://storage.example.test/transcripts/job_wrong_summary/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [{ startMs: 0, endMs: 1200, text: 'hello everyone' }]
        }
      });

    const summaryClaim = await request(app)
      .post('/summary-workers/claims')
      .send({
        workerId: 'summary-alpha'
      });

    expect(summaryClaim.status).toBe(200);

    const staleSummaryCallback = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        leaseToken: 'lease_wrong_summary_token',
        summaryArtifact: {
          model: 'gpt-5.3-codex-spark',
          reasoningEffort: 'medium',
          text: 'This should be ignored.'
        }
      });

    expect(staleSummaryCallback.status).toBe(202);
    expect(staleSummaryCallback.body.state).toBe('transcribing');
    expect(staleSummaryCallback.body.processingStage).toBe('generating-summary');
    expect(staleSummaryCallback.body.summaryArtifact).toBeUndefined();
  });

  it('ignores a stale recording callback after the recording lease has already been released', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      });

    expect(created.status).toBe(201);

    const claim = await request(app)
      .post('/recording-workers/claims')
      .send({
        workerId: 'worker-alpha'
      });

    expect(claim.status).toBe(200);

    const artifactStored = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        leaseToken: claim.body.leaseToken,
        recordingArtifact: {
          storageKey: 'recordings/job_stale_recording/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_stale_recording/meeting.webm',
          contentType: 'video/webm'
        }
      });

    expect(artifactStored.status).toBe(202);
    expect(artifactStored.body.state).toBe('transcribing');

    const staleFailed = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'failed',
        leaseToken: claim.body.leaseToken,
        failure: {
          code: 'stale-recording-worker',
          message: 'This stale callback should be ignored.'
        }
      });

    expect(staleFailed.status).toBe(202);
    expect(staleFailed.body.state).toBe('transcribing');
    expect(staleFailed.body.failureCode).toBeUndefined();
    expect(staleFailed.body.recordingArtifact.storageKey).toBe(
      'recordings/job_stale_recording/meeting.webm'
    );
  });

  it('accepts large transcript artifact callbacks for long recordings', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/lrg-tran-scp'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_large/transcript-source.m4a',
          downloadUrl: 'https://storage.example.test/recordings/job_large/transcript-source.m4a',
          contentType: 'audio/mp4'
        }
      });

    const largeTranscriptCallback = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: 'transcripts/job_large/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_large/transcript.json',
          contentType: 'application/json',
          language: 'zh',
          segments: Array.from({ length: 3000 }, (_, index) => ({
            startMs: index * 1000,
            endMs: (index + 1) * 1000,
            text: `segment-${index} lorem ipsum dolor sit amet`
          }))
        }
      });

    expect(largeTranscriptCallback.status).toBe(202);
    expect(largeTranscriptCallback.body.state).toBe('transcribing');

    const fetched = await request(app).get(`/recording-jobs/${created.body.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.state).toBe('transcribing');
    expect(fetched.body.transcriptArtifact.segments).toHaveLength(3000);
  });

  it('returns 404 for an unknown recording job id', async () => {
    const app = createApp();

    const response = await request(app).get('/recording-jobs/job_missing');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('recording-job-not-found');
  });

  it('creates operator meeting jobs with a default join name and submitter scoping', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-a',
        meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV'
      });

    expect(created.status).toBe(201);
    expect(created.body.submitterId).toBe('operator-a');
    expect(created.body.inputSource).toBe('meeting-link');
    expect(created.body.requestedJoinName).toBe('Solomon - NoteTaker');

    await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-b',
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        requestedJoinName: 'Custom Bot'
      });

    const listed = await request(app).get('/api/operator/jobs').query({ submitterId: 'operator-a' });

    expect(listed.status).toBe(200);
    expect(listed.body.jobs).toHaveLength(1);
    expect(listed.body.jobs[0].submitterId).toBe('operator-a');
    expect(listed.body.jobs[0].requestedJoinName).toBe('Solomon - NoteTaker');
  });

  it('returns lightweight operator job lists and full job details separately', async () => {
    const app = createApp();

    const created = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-list',
        meetingUrl: 'https://meet.google.com/lit-ejob-lst'
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_list/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_list/meeting.webm',
          contentType: 'video/webm'
        }
      });

    await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: 'transcripts/job_list/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_list/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [{ startMs: 0, endMs: 1000, text: 'hello list details' }]
        }
      });

    const listed = await request(app)
      .get('/api/operator/jobs')
      .query({ submitterId: 'operator-list' });

    expect(listed.status).toBe(200);
    expect(listed.body.jobs[0].transcriptArtifact).toBeUndefined();
    expect(listed.body.jobs[0].summaryArtifact).toBeUndefined();
    expect(listed.body.jobs[0].hasTranscript).toBe(true);

    const detailed = await request(app)
      .get(`/api/operator/jobs/${created.body.id}`)
      .query({ submitterId: 'operator-list' });

    expect(detailed.status).toBe(200);
    expect(detailed.body.transcriptArtifact.segments).toHaveLength(1);
  });

  it('paginates operator job lists and returns counts with a cursor', async () => {
    const app = createApp();

    const first = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-page',
        meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc'
      });

    const second = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-page',
        meetingUrl: 'https://meet.google.com/ddd-eeee-fff'
      });

    const third = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-page',
        meetingUrl: 'https://meet.google.com/ggg-hhhh-iii'
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(201);

    const pageOne = await request(app)
      .get('/api/operator/jobs')
      .query({ submitterId: 'operator-page', pageSize: 2 });

    expect(pageOne.status).toBe(200);
    expect(pageOne.body.jobs).toHaveLength(2);
    expect(pageOne.body.stats.totalCount).toBe(3);
    expect(pageOne.body.stats.queuedCount).toBe(3);
    expect(pageOne.body.pageInfo.hasMore).toBe(true);
    expect(typeof pageOne.body.pageInfo.nextCursor).toBe('string');

    const pageTwo = await request(app)
      .get('/api/operator/jobs')
      .query({
        submitterId: 'operator-page',
        pageSize: 2,
        cursor: pageOne.body.pageInfo.nextCursor
      });

    expect(pageTwo.status).toBe(200);
    expect(pageTwo.body.jobs).toHaveLength(1);
    expect(pageTwo.body.pageInfo.hasMore).toBe(false);

    const combinedIds = [...pageOne.body.jobs, ...pageTwo.body.jobs].map((job) => job.id);

    expect(new Set(combinedIds).size).toBe(3);
    expect(combinedIds).toEqual(
      expect.arrayContaining([first.body.id, second.body.id, third.body.id])
    );
    expect(pageTwo.body.jobs[0].id).not.toBe(pageOne.body.jobs[0].id);
    expect(pageTwo.body.jobs[0].id).not.toBe(pageOne.body.jobs[1].id);
  });

  it('requires an internal service token for worker routes when configured', async () => {
    const app = createApp(undefined, {
      internalServiceToken: 'internal-secret'
    });

    await request(app)
      .post('/recording-jobs')
      .send({
        meetingUrl: 'https://meet.google.com/int-erna-ltk'
      });

    const unauthenticatedClaim = await request(app)
      .post('/recording-workers/claims')
      .send({
        workerId: 'worker-alpha'
      });

    expect(unauthenticatedClaim.status).toBe(401);

    const authenticatedClaim = await request(app)
      .post('/recording-workers/claims')
      .set('x-internal-service-token', 'internal-secret')
      .send({
        workerId: 'worker-alpha'
      });

    expect(authenticatedClaim.status).toBe(200);
    expect(authenticatedClaim.body.leaseToken).toBeTruthy();

    const unauthenticatedHeartbeat = await request(app)
      .post(`/recording-jobs/${authenticatedClaim.body.id}/leases/heartbeat`)
      .send({
        stage: 'recording',
        leaseToken: authenticatedClaim.body.leaseToken
      });

    expect(unauthenticatedHeartbeat.status).toBe(401);

    const authenticatedHeartbeat = await request(app)
      .post(`/recording-jobs/${authenticatedClaim.body.id}/leases/heartbeat`)
      .set('x-internal-service-token', 'internal-secret')
      .send({
        stage: 'recording',
        leaseToken: authenticatedClaim.body.leaseToken
      });

    expect(authenticatedHeartbeat.status).toBe(200);
  });

  it('keeps additional meeting jobs queued while another meeting bot job is already active', async () => {
    const app = createApp();

    const first = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-a',
        meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc'
      });

    const second = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-a',
        meetingUrl: 'https://meet.google.com/ddd-eeee-fff'
      });

    const third = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-b',
        meetingUrl: 'https://meet.google.com/ggg-hhhh-iii'
      });

    const claimOne = await request(app)
      .post('/recording-workers/claims')
      .send({ workerId: 'worker-alpha' });

    const claimTwo = await request(app)
      .post('/recording-workers/claims')
      .send({ workerId: 'worker-beta' });

    const queuedSecond = await request(app).get(`/recording-jobs/${second.body.id}`);
    const queuedThird = await request(app).get(`/recording-jobs/${third.body.id}`);

    expect(claimOne.status).toBe(200);
    expect(claimOne.body.id).toBe(first.body.id);
    expect(claimTwo.status).toBe(204);
    expect(queuedSecond.body.state).toBe('queued');
    expect(queuedThird.body.state).toBe('queued');
  });

  it('accepts uploaded audio jobs and routes them to the transcription queue', async () => {
    const uploadedAudioStorage = new FakeUploadedAudioStorage();
    const app = createApp(undefined, { uploadedAudioStorage });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-a')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'meeting-note.wav',
        contentType: 'audio/wav'
      });

    expect(created.status).toBe(201);
    expect(created.body.submitterId).toBe('operator-a');
    expect(created.body.platform).toBe('uploaded-audio');
    expect(created.body.inputSource).toBe('uploaded-audio');
    expect(created.body.uploadedFileName).toBe('meeting-note.wav');
    expect(uploadedAudioStorage.uploads[0]?.originalName).toBe('meeting-note.wav');

    const claim = await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcriber-alpha' });

    expect(claim.status).toBe(200);
    expect(claim.body.id).toBe(created.body.id);
    expect(claim.body.state).toBe('transcribing');
    expect(claim.body.recordingArtifact.storageKey).toContain('meeting-note.wav');
  });

  it('rejects uploaded jobs after the configured transcription backlog limit is reached', async () => {
    const uploadedAudioStorage = new FakeUploadedAudioStorage();
    const app = createApp(undefined, {
      uploadedAudioStorage,
      maxTranscriptionJobBacklog: 1
    });

    const first = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-a')
      .attach('audio', Buffer.from('fake-audio-a'), {
        filename: 'first.wav',
        contentType: 'audio/wav'
      });

    const second = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-b')
      .attach('audio', Buffer.from('fake-audio-b'), {
        filename: 'second.wav',
        contentType: 'audio/wav'
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('transcription-capacity-exceeded');
    expect(uploadedAudioStorage.uploads).toHaveLength(1);
  });

  it('normalizes mojibake uploaded filenames back to readable utf-8 text', async () => {
    const uploadedAudioStorage = new FakeUploadedAudioStorage();
    const app = createApp(undefined, { uploadedAudioStorage });
    const readableName = '錄製_2026_03_27_15_34_04_456.mp4';
    const mojibakeName = Buffer.from(readableName, 'utf8').toString('latin1');

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-a')
      .attach('audio', Buffer.from('fake-video'), {
        filename: mojibakeName,
        contentType: 'video/mp4'
      });

    expect(created.status).toBe(201);
    expect(created.body.uploadedFileName).toBe(readableName);
    expect(uploadedAudioStorage.uploads[0]?.originalName).toBe(readableName);
  });

  it('marks a joining meeting job as not admitted when the operator stops it before any recording starts', async () => {
    const meetingBotController = new FakeMeetingBotController();
    const app = createApp(undefined, { meetingBotController });

    const created = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-a',
        meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV'
      });

    await request(app)
      .post('/recording-workers/claims')
      .send({ workerId: 'worker-alpha' });

    const stopped = await request(app)
      .post('/api/operator/stop-current')
      .send({ submitterId: 'operator-a' });

    expect(stopped.status).toBe(202);
    expect(stopped.body.job.id).toBe(created.body.id);
    expect(meetingBotController.stopCount).toBe(1);
    expect(stopped.body.job.state).toBe('failed');
    expect(stopped.body.job.failureCode).toBe('meeting-not-admitted');
    expect(stopped.body.job.processingStage).toBe('failed');

    const fetched = await request(app).get(`/recording-jobs/${created.body.id}`);
    expect(fetched.body.state).toBe('failed');
    expect(fetched.body.failureCode).toBe('meeting-not-admitted');
  });

  it('keeps finalizing a meeting job when the operator stops after recording has started', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const meetingBotController = new FakeMeetingBotController();
    const activeRecordingJob = transitionRecordingJobState(
      assignRecordingJobToWorker(
        createRecordingJob({
          meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV',
          platform: 'microsoft-teams',
          submitterId: 'operator-a'
        }),
        'worker-alpha'
      ),
      'recording'
    );
    await repository.save(activeRecordingJob);
    const app = createApp(repository, { meetingBotController });

    const stopped = await request(app)
      .post('/api/operator/stop-current')
      .send({ submitterId: 'operator-a' });

    expect(stopped.status).toBe(202);
    expect(stopped.body.job.state).toBe('recording');
    expect(stopped.body.job.failureCode).toBeUndefined();
    expect(stopped.body.job.processingStage).toBe('finalizing-recording');
  });

  it('still accepts a recording completion webhook after an operator requested bot exit', async () => {
    const meetingBotController = new FakeMeetingBotController();
    const app = createApp(undefined, { meetingBotController });

    const created = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-a',
        meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV'
      });

    await request(app)
      .post('/recording-workers/claims')
      .send({ workerId: 'worker-alpha' });

    await request(app)
      .post('/api/operator/stop-current')
      .send({ submitterId: 'operator-a' });

    const completion = await request(app)
      .post('/integrations/meeting-bot/completions')
      .send({
        recordingId: 'rec_exit',
        meetingLink: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV',
        status: 'completed',
        timestamp: '2026-04-07T06:00:00.000Z',
        blobUrl:
          'http://minio:9000/meeting-artifacts/meeting-bot/meeting-bot-user/exit-requested.webm',
        metadata: {
          userId: 'meeting-bot-user',
          teamId: 'meeting-bot-team',
          botId: created.body.id,
          contentType: 'video/webm',
          uploaderType: 's3'
        }
      });

    expect(completion.status).toBe(202);
    expect(completion.body.state).toBe('transcribing');
  });

  it('keeps joining as the display state while the meeting bot is busy but no recording state was reported yet', async () => {
    const meetingBotRuntimeMonitor = new FakeMeetingBotRuntimeMonitor(true);
    const repository = new InMemoryRecordingJobRepository();
    await repository.save(
      assignRecordingJobToWorker(
        createRecordingJob({
          meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV',
          platform: 'microsoft-teams',
          submitterId: 'operator-a'
        }),
        'worker-alpha'
      )
    );
    const app = createApp(repository, { meetingBotRuntimeMonitor });

    const listed = await request(app).get('/api/operator/jobs').query({ submitterId: 'operator-a' });

    expect(listed.status).toBe(200);
    expect(listed.body.jobs[0].displayState).toBe('joining');
  });

  it('does not claim a queued meeting job while the meeting bot runtime is already busy', async () => {
    const app = createApp(undefined, {
      meetingBotRuntimeMonitor: new FakeMeetingBotRuntimeMonitor(true)
    });

    await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-a',
        meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV'
      });

    const claim = await request(app)
      .post('/recording-workers/claims')
      .send({ workerId: 'worker-alpha' });

    expect(claim.status).toBe(204);
  });

  it('marks a meeting job as waiting for recording capacity when the shared meeting bot is busy', async () => {
    const app = createApp(undefined, {
      meetingBotRuntimeMonitor: new FakeMeetingBotRuntimeMonitor(true),
      maxMeetingJobBacklog: 1
    });

    const created = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-a',
        meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV'
      });

    expect(created.status).toBe(201);
    expect(created.body.state).toBe('queued');
    expect(created.body.processingStage).toBe('waiting-for-recording-capacity');
    expect(created.body.processingMessage).toBe('Waiting for meeting bot capacity.');

    const listed = await request(app).get('/api/operator/jobs').query({ submitterId: 'operator-a' });
    expect(listed.status).toBe(200);
    expect(listed.body.jobs[0].processingStage).toBe('waiting-for-recording-capacity');
  });

  it('rejects new meeting submissions after the configured meeting backlog limit is reached', async () => {
    const app = createApp(undefined, {
      meetingBotRuntimeMonitor: new FakeMeetingBotRuntimeMonitor(true),
      maxMeetingJobBacklog: 1
    });

    const first = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-a',
        meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV'
      });

    const second = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-b',
        meetingUrl: 'https://meet.google.com/ddd-eeee-fff'
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('meeting-capacity-exceeded');
  });

  it('allows the next meeting job to start while another meeting job is already transcribing', async () => {
    const app = createApp();

    const first = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-a',
        meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc'
      });

    await request(app)
      .post('/recording-workers/claims')
      .send({ workerId: 'worker-alpha' });

    await request(app)
      .post(`/recording-jobs/${first.body.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'recordings/job_transcribing/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_transcribing/meeting.webm',
          contentType: 'video/webm'
        }
      });

    const second = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-b',
        meetingUrl: 'https://meet.google.com/ddd-eeee-fff'
      });

    expect(second.status).toBe(201);

    const claim = await request(app)
      .post('/recording-workers/claims')
      .send({ workerId: 'worker-beta' });

    expect(claim.status).toBe(200);
    expect(claim.body.id).toBe(second.body.id);
    expect(claim.body.state).toBe('joining');
    expect(claim.body.processingStage).toBe('joining-meeting');
  });

  it('automatically clears stale joining jobs when the meeting bot runtime is idle', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const staleJob = {
      ...assignRecordingJobToWorker(
        createRecordingJob({
          meetingUrl: 'https://meet.google.com/stale-job-aaa',
          platform: 'google-meet',
          submitterId: 'operator-stale'
        }),
        'worker-stale'
      ),
      updatedAt: '2026-03-30T00:00:00.000Z'
    };
    await repository.save(staleJob);

    const app = createApp(repository, {
      meetingBotRuntimeMonitor: new FakeMeetingBotRuntimeMonitor(false)
    });

    const queued = await request(app)
      .post('/api/operator/jobs/meetings')
      .send({
        submitterId: 'operator-fresh',
        meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc'
      });

    const claim = await request(app)
      .post('/recording-workers/claims')
      .send({ workerId: 'worker-fresh' });

    expect(claim.status).toBe(200);
    expect(claim.body.id).toBe(queued.body.id);

    const staleFetched = await request(app).get(`/recording-jobs/${staleJob.id}`);
    expect(staleFetched.body.state).toBe('failed');
    expect(staleFetched.body.failureCode).toBe('meeting-bot-stale');
  });

  it('marks stale finalizing meeting jobs without a recording artifact as not admitted when the runtime is idle', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const staleFinalizingJob = {
      ...assignRecordingJobToWorker(
        createRecordingJob({
          meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV',
          platform: 'microsoft-teams',
          submitterId: 'operator-stale'
        }),
        'worker-stale'
      ),
      processingStage: 'finalizing-recording',
      processingMessage: 'The operator requested the meeting bot to leave and finalize the recording.',
      updatedAt: '2026-03-30T00:00:00.000Z'
    };
    await repository.save(staleFinalizingJob);

    const app = createApp(repository, {
      meetingBotRuntimeMonitor: new FakeMeetingBotRuntimeMonitor(false)
    });

    const listed = await request(app).get('/api/operator/jobs').query({ submitterId: 'operator-stale' });

    expect(listed.status).toBe(200);
    expect(listed.body.jobs[0].state).toBe('failed');
    expect(listed.body.jobs[0].failureCode).toBe('meeting-not-admitted');
  });

  it('still marks stale finalizing meeting jobs with a recording artifact as finalization timeouts', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const staleFinalizingJob = {
      ...transitionRecordingJobState(
        assignRecordingJobToWorker(
          createRecordingJob({
            meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV',
            platform: 'microsoft-teams',
            submitterId: 'operator-stale'
          }),
          'worker-stale'
        ),
        'recording'
      ),
      processingStage: 'finalizing-recording',
      processingMessage: 'The operator requested the meeting bot to leave and finalize the recording.',
      recordingArtifact: {
        storageKey: 'recordings/job_stale_timeout/meeting.webm',
        downloadUrl: 'https://storage.example.test/recordings/job_stale_timeout/meeting.webm',
        contentType: 'video/webm'
      },
      updatedAt: '2026-03-30T00:00:00.000Z'
    };
    await repository.save(staleFinalizingJob);

    const app = createApp(repository, {
      meetingBotRuntimeMonitor: new FakeMeetingBotRuntimeMonitor(false)
    });

    const listed = await request(app).get('/api/operator/jobs').query({ submitterId: 'operator-stale' });

    expect(listed.status).toBe(200);
    expect(listed.body.jobs[0].state).toBe('failed');
    expect(listed.body.jobs[0].failureCode).toBe('meeting-bot-finalization-timeout');
  });

  it('deletes a terminal operator job from visible history', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const failedJob = markRecordingJobFailed(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/history-delete',
        platform: 'google-meet',
        submitterId: 'operator-a'
      }),
      {
        code: 'meeting-bot-failed',
        message: 'meeting join failed'
      }
    );
    await repository.save(failedJob);
    const app = createApp(repository);

    const deleted = await request(app)
      .delete(`/api/operator/jobs/${failedJob.id}`)
      .send({ submitterId: 'operator-a' });

    expect(deleted.status).toBe(204);

    const listed = await request(app).get('/api/operator/jobs').query({ submitterId: 'operator-a' });
    expect(listed.body.jobs).toHaveLength(0);

    const fetched = await request(app).get(`/recording-jobs/${failedJob.id}`);
    expect(fetched.status).toBe(404);
  });

  it('rejects deletion of an active operator job', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const activeJob = assignRecordingJobToWorker(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/history-active',
        platform: 'google-meet',
        submitterId: 'operator-a'
      }),
      'worker-alpha'
    );
    await repository.save(activeJob);
    const app = createApp(repository);

    const deleted = await request(app)
      .delete(`/api/operator/jobs/${activeJob.id}`)
      .send({ submitterId: 'operator-a' });

    expect(deleted.status).toBe(409);
    expect(deleted.body.error.code).toBe('operator-job-not-terminal');

    const fetched = await request(app).get(`/recording-jobs/${activeJob.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.state).toBe('joining');
  });

  it('clears only terminal history for the current operator', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const failedJob = markRecordingJobFailed(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/history-failed',
        platform: 'google-meet',
        submitterId: 'operator-a'
      }),
      {
        code: 'meeting-bot-failed',
        message: 'join failed'
      }
    );
    const completedJob = attachTranscriptArtifact(
      attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'https://meet.google.com/history-completed',
          platform: 'google-meet',
          submitterId: 'operator-a'
        }),
        {
          storageKey: 'recordings/job_history_completed/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_history_completed/meeting.webm',
          contentType: 'video/webm'
        }
      ),
      {
        storageKey: 'transcripts/job_history_completed/transcript.json',
        downloadUrl:
          'https://storage.example.test/transcripts/job_history_completed/transcript.json',
        contentType: 'application/json',
        language: 'en',
        segments: [
          {
            startMs: 0,
            endMs: 1000,
            text: 'history completed'
          }
        ]
      }
    );
    const activeJob = assignRecordingJobToWorker(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/history-keep',
        platform: 'google-meet',
        submitterId: 'operator-a'
      }),
      'worker-alpha'
    );
    const otherOperatorJob = markRecordingJobFailed(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/history-other',
        platform: 'google-meet',
        submitterId: 'operator-b'
      }),
      {
        code: 'meeting-bot-failed',
        message: 'other operator history'
      }
    );

    await repository.save(failedJob);
    await repository.save(completedJob);
    await repository.save(activeJob);
    await repository.save(otherOperatorJob);

    const app = createApp(repository);

    const cleared = await request(app)
      .post('/api/operator/jobs/clear-history')
      .send({ submitterId: 'operator-a' });

    expect(cleared.status).toBe(200);
    expect(cleared.body.deletedCount).toBe(2);

    const listedA = await request(app).get('/api/operator/jobs').query({ submitterId: 'operator-a' });
    expect(listedA.body.jobs).toHaveLength(1);
    expect(listedA.body.jobs[0].id).toBe(activeJob.id);

    const listedB = await request(app).get('/api/operator/jobs').query({ submitterId: 'operator-b' });
    expect(listedB.body.jobs).toHaveLength(1);
    expect(listedB.body.jobs[0].id).toBe(otherOperatorJob.id);
  });

  it('stores uploaded-media progress updates and returns them in job payloads', async () => {
    const app = createApp(undefined, { uploadedAudioStorage: new FakeUploadedAudioStorage() });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-progress')
      .attach('audio', Buffer.from('fake-video'), {
        filename: 'progress-demo.mp4',
        contentType: 'video/mp4'
      });

    const progress = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'progress-updated',
        processingStage: 'preparing-media',
        processingMessage: 'Extracting audio track from uploaded media.',
        progressPercent: 24,
        progressProcessedMs: 120000,
        progressTotalMs: 500000
      });

    expect(progress.status).toBe(202);
    expect(progress.body.processingStage).toBe('preparing-media');
    expect(progress.body.processingMessage).toBe('Extracting audio track from uploaded media.');
    expect(progress.body.progressPercent).toBe(24);
    expect(progress.body.progressProcessedMs).toBe(120000);
    expect(progress.body.progressTotalMs).toBe(500000);
    expect(progress.body.jobHistory.some((entry: { stage: string }) => entry.stage === 'preparing-media')).toBe(true);

    const fetched = await request(app).get(`/recording-jobs/${created.body.id}`);
    expect(fetched.body.processingStage).toBe('preparing-media');
    expect(fetched.body.processingMessage).toBe('Extracting audio track from uploaded media.');
    expect(fetched.body.progressPercent).toBe(24);
    expect(fetched.body.progressProcessedMs).toBe(120000);
    expect(fetched.body.progressTotalMs).toBe(500000);
    expect(fetched.body.jobHistory.at(-1).message).toBe('Extracting audio track from uploaded media.');
  });

  it('lets an operator interrupt their own uploaded-media job and keeps the cancellation sticky', async () => {
    const app = createApp(undefined, { uploadedAudioStorage: new FakeUploadedAudioStorage() });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-interrupt')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'interrupt-me.m4a',
        contentType: 'audio/mp4'
      });

    await request(app)
      .post('/transcription-workers/claims')
      .send({ workerId: 'transcriber-alpha' });

    const cancelled = await request(app)
      .post(`/api/operator/jobs/${created.body.id}/cancel`)
      .send({ submitterId: 'operator-interrupt' });

    expect(cancelled.status).toBe(202);
    expect(cancelled.body.state).toBe('failed');
    expect(cancelled.body.failureCode).toBe('operator-cancel-requested');

    const lateTranscript = await request(app)
      .post(`/recording-jobs/${created.body.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: 'transcripts/job_interrupt/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_interrupt/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: 'late transcript should be ignored'
            }
          ]
        }
      });

    expect(lateTranscript.status).toBe(202);
    expect(lateTranscript.body.state).toBe('failed');
    expect(lateTranscript.body.failureCode).toBe('operator-cancel-requested');
    expect(lateTranscript.body.transcriptArtifact).toBeUndefined();
  });

  it('rejects interrupt attempts for jobs owned by another operator', async () => {
    const app = createApp(undefined, { uploadedAudioStorage: new FakeUploadedAudioStorage() });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .field('submitterId', 'operator-a')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'owner-check.m4a',
        contentType: 'audio/mp4'
      });

    const cancelled = await request(app)
      .post(`/api/operator/jobs/${created.body.id}/cancel`)
      .send({ submitterId: 'operator-b' });

    expect(cancelled.status).toBe(404);
  });

  it('rejects operator routes without a valid bearer token when auth is enabled', async () => {
    const app = createApp(undefined, {
      operatorAuth: new FakeOperatorAuth({
        validtoken: { id: 'user-1', email: 'user1@example.com' }
      }),
      authenticatedUserRepository: new FakeAuthenticatedUserRepository()
    });

    const response = await request(app).get('/api/operator/jobs');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('operator-auth-required');
  });

  it('uses the authenticated user identity for operator jobs and persists the local user record', async () => {
    const authenticatedUsers = new FakeAuthenticatedUserRepository();
    const app = createApp(undefined, {
      uploadedAudioStorage: new FakeUploadedAudioStorage(),
      operatorAuth: new FakeOperatorAuth({
        validtoken: { id: 'user-1', email: 'user1@example.com' }
      }),
      authenticatedUserRepository: authenticatedUsers
    });

    const created = await request(app)
      .post('/api/operator/jobs/uploads')
      .set('Authorization', 'Bearer validtoken')
      .field('submitterId', 'ignored-client-value')
      .attach('audio', Buffer.from('fake-audio'), {
        filename: 'authenticated.wav',
        contentType: 'audio/wav'
      });

    expect(created.status).toBe(201);
    expect(created.body.submitterId).toBe('user-1');

    const listed = await request(app)
      .get('/api/operator/jobs')
      .set('Authorization', 'Bearer validtoken')
      .query({ submitterId: 'ignored-client-value' });

    expect(listed.status).toBe(200);
    expect(listed.body.jobs).toHaveLength(1);
    expect(listed.body.jobs[0].submitterId).toBe('user-1');

    const savedUser = await authenticatedUsers.getById('user-1');
    expect(savedUser?.email).toBe('user1@example.com');
  });

  it('filters authenticated operator jobs by archive search across metadata and content', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const authUsers = new FakeAuthenticatedUserRepository();

    const matchingUpload = attachSummaryArtifact(
      attachTranscriptArtifact(
        attachRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'uploaded://QBR-roadmap.m4a',
            platform: 'uploaded-audio',
            inputSource: 'uploaded-audio',
            submitterId: 'user-1',
            uploadedFileName: 'QBR-roadmap.m4a'
          }),
          {
            storageKey: 'uploads/user-1/job_qbr/QBR-roadmap.m4a',
            downloadUrl: 'https://storage.example.test/uploads/user-1/job_qbr/QBR-roadmap.m4a',
            contentType: 'audio/mp4'
          }
        ),
        {
          storageKey: 'transcripts/job_qbr/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_qbr/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: 'quarterly budget review'
            }
          ]
        }
      ),
      {
        model: 'gpt-5.3-codex-spark',
        reasoningEffort: 'medium',
        text: 'Roadmap checkpoint summary'
      }
    );

    const matchingTranscript = attachSummaryArtifact(
      attachTranscriptArtifact(
        attachRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'https://meet.google.com/prod-decision-xyz',
            platform: 'google-meet',
            submitterId: 'user-1'
          }),
          {
            storageKey: 'recordings/job_prod/meeting.webm',
            downloadUrl: 'https://storage.example.test/recordings/job_prod/meeting.webm',
            contentType: 'video/webm'
          }
        ),
        {
          storageKey: 'transcripts/job_prod/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_prod/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: 'the roadmap owner is Solomon'
            }
          ]
        }
      ),
      {
        model: 'gpt-5.3-codex-spark',
        reasoningEffort: 'medium',
        text: 'Product decision notes'
      }
    );

    const otherUsersMatch = attachSummaryArtifact(
      attachTranscriptArtifact(
        attachRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'uploaded://shadow-roadmap.m4a',
            platform: 'uploaded-audio',
            inputSource: 'uploaded-audio',
            submitterId: 'user-2',
            uploadedFileName: 'shadow-roadmap.m4a'
          }),
          {
            storageKey: 'uploads/user-2/job_shadow/shadow-roadmap.m4a',
            downloadUrl: 'https://storage.example.test/uploads/user-2/job_shadow/shadow-roadmap.m4a',
            contentType: 'audio/mp4'
          }
        ),
        {
          storageKey: 'transcripts/job_shadow/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_shadow/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: 'shadow roadmap transcript'
            }
          ]
        }
      ),
      {
        model: 'gpt-5.3-codex-spark',
        reasoningEffort: 'medium',
        text: 'Shadow roadmap summary'
      }
    );

    const nonMatch = attachSummaryArtifact(
      attachTranscriptArtifact(
        attachRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'https://meet.google.com/finance-close-abc',
            platform: 'google-meet',
            submitterId: 'user-1'
          }),
          {
            storageKey: 'recordings/job_finance/meeting.webm',
            downloadUrl: 'https://storage.example.test/recordings/job_finance/meeting.webm',
            contentType: 'video/webm'
          }
        ),
        {
          storageKey: 'transcripts/job_finance/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_finance/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: 'finance close discussion'
            }
          ]
        }
      ),
      {
        model: 'gpt-5.3-codex-spark',
        reasoningEffort: 'medium',
        text: 'Finance summary'
      }
    );

    await repository.save(matchingUpload);
    await repository.save(matchingTranscript);
    await repository.save(otherUsersMatch);
    await repository.save(nonMatch);

    const app = createApp(repository, {
      operatorAuth: new FakeOperatorAuth({
        validtoken: { id: 'user-1', email: 'user1@example.com' }
      }),
      authenticatedUserRepository: authUsers
    });

    const response = await request(app)
      .get('/api/operator/jobs')
      .set('Authorization', 'Bearer validtoken')
      .query({ q: 'ROADMAP' });

    expect(response.status).toBe(200);
    expect(response.body.jobs.map((job: { id: string }) => job.id).sort()).toEqual(
      [matchingTranscript.id, matchingUpload.id].sort()
    );
  });

  it('exports an owned completed job in markdown, txt, srt, and json formats', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const authUsers = new FakeAuthenticatedUserRepository();
    await authUsers.upsert({ id: 'user-1', email: 'user1@example.com' });

    const exportedJob = attachSummaryArtifact(
      attachTranscriptArtifact(
        attachRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'uploaded://export-demo.m4a',
            platform: 'uploaded-audio',
            inputSource: 'uploaded-audio',
            submitterId: 'user-1',
            uploadedFileName: 'export-demo.m4a'
          }),
          {
            storageKey: 'uploads/user-1/job_export/export-demo.m4a',
            downloadUrl: 'https://storage.example.test/uploads/user-1/job_export/export-demo.m4a',
            contentType: 'audio/mp4'
          }
        ),
        {
          storageKey: 'transcripts/job_export/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_export/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1200,
              text: 'hello export world'
            },
            {
              startMs: 1200,
              endMs: 2600,
              text: 'next transcript line'
            }
          ]
        }
      ),
      {
        model: 'gpt-5.3-codex-spark',
        reasoningEffort: 'medium',
        text: 'Export summary'
      }
    );

    await repository.save(exportedJob);

    const app = createApp(repository, {
      operatorAuth: new FakeOperatorAuth({
        validtoken: { id: 'user-1', email: 'user1@example.com' }
      }),
      authenticatedUserRepository: authUsers
    });

    const markdown = await request(app)
      .get(`/api/operator/jobs/${exportedJob.id}/export`)
      .set('Authorization', 'Bearer validtoken')
      .query({ format: 'markdown' });

    expect(markdown.status).toBe(200);
    expect(markdown.headers['content-type']).toContain('text/markdown');
    expect(markdown.headers['content-disposition']).toContain('.md');
    expect(markdown.text).toContain('# AI NoteTacker Export');
    expect(markdown.text).toContain('Export summary');
    expect(markdown.text).toContain('hello export world');

    const txt = await request(app)
      .get(`/api/operator/jobs/${exportedJob.id}/export`)
      .set('Authorization', 'Bearer validtoken')
      .query({ format: 'txt' });

    expect(txt.status).toBe(200);
    expect(txt.headers['content-type']).toContain('text/plain');
    expect(txt.text).toContain('Export summary');
    expect(txt.text).toContain('next transcript line');

    const srt = await request(app)
      .get(`/api/operator/jobs/${exportedJob.id}/export`)
      .set('Authorization', 'Bearer validtoken')
      .query({ format: 'srt' });

    expect(srt.status).toBe(200);
    expect(srt.headers['content-type']).toContain('application/x-subrip');
    expect(srt.text).toContain('1\n00:00:00,000 --> 00:00:01,200\nhello export world');

    const json = await request(app)
      .get(`/api/operator/jobs/${exportedJob.id}/export`)
      .set('Authorization', 'Bearer validtoken')
      .query({ format: 'json' });

    expect(json.status).toBe(200);
    expect(json.headers['content-type']).toContain('application/json');
    expect(json.body.job.id).toBe(exportedJob.id);
    expect(json.body.summary.text).toBe('Export summary');
    expect(json.body.transcript.segments).toHaveLength(2);
  });

  it('rejects exporting another operator job and rejects unsupported formats', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const authUsers = new FakeAuthenticatedUserRepository();
    await authUsers.upsert({ id: 'user-1', email: 'user1@example.com' });

    const exportedJob = attachTranscriptArtifact(
      attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'https://meet.google.com/export-owner-abc',
          platform: 'google-meet',
          submitterId: 'user-2'
        }),
        {
          storageKey: 'recordings/job_owner/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_owner/meeting.webm',
          contentType: 'video/webm'
        }
      ),
      {
        storageKey: 'transcripts/job_owner/transcript.json',
        downloadUrl: 'https://storage.example.test/transcripts/job_owner/transcript.json',
        contentType: 'application/json',
        language: 'en',
        segments: [
          {
            startMs: 0,
            endMs: 1000,
            text: 'owner transcript'
          }
        ]
      }
    );

    await repository.save(exportedJob);

    const app = createApp(repository, {
      operatorAuth: new FakeOperatorAuth({
        validtoken: { id: 'user-1', email: 'user1@example.com' }
      }),
      authenticatedUserRepository: authUsers
    });

    const forbidden = await request(app)
      .get(`/api/operator/jobs/${exportedJob.id}/export`)
      .set('Authorization', 'Bearer validtoken')
      .query({ format: 'markdown' });

    expect(forbidden.status).toBe(404);

    const unsupported = await request(app)
      .get(`/api/operator/jobs/${exportedJob.id}/export`)
      .set('Authorization', 'Bearer validtoken')
      .query({ format: 'pdf' });

    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.code).toBe('invalid-request');
  });

  it('sends one terminal completion email notification for an authenticated job', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const authUsers = new FakeAuthenticatedUserRepository();
    const notifications = new FakeJobNotificationSender();
    await authUsers.upsert({ id: 'user-1', email: 'user1@example.com' });

    const created = createRecordingJob({
      meetingUrl: 'uploaded://notify-complete.m4a',
      platform: 'uploaded-audio',
      inputSource: 'uploaded-audio',
      submitterId: 'user-1',
      uploadedFileName: 'notify-complete.m4a'
    });

    await repository.save(created);

    const app = createApp(repository, {
      authenticatedUserRepository: authUsers,
      jobNotificationSender: notifications
    });

    await request(app)
      .post(`/recording-jobs/${created.id}/events`)
      .send({
        type: 'recording-artifact-stored',
        recordingArtifact: {
          storageKey: 'uploads/user-1/job_notify/notify-complete.m4a',
          downloadUrl: 'https://storage.example.test/uploads/user-1/job_notify/notify-complete.m4a',
          contentType: 'audio/mp4'
        }
      });

    const transcriptStored = await request(app)
      .post(`/recording-jobs/${created.id}/events`)
      .send({
        type: 'transcript-artifact-stored',
        transcriptArtifact: {
          storageKey: 'transcripts/job_notify/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_notify/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: 'job is complete'
            }
          ]
        }
      });

    expect(transcriptStored.status).toBe(202);
    expect(notifications.sent).toHaveLength(1);
    expect(notifications.sent[0].to).toBe('user1@example.com');
    expect(notifications.sent[0].state).toBe('completed');
    expect(notifications.sent[0].jobId).toBe(created.id);

    await request(app)
      .post(`/recording-jobs/${created.id}/events`)
      .send({
        type: 'summary-artifact-stored',
        summaryArtifact: {
          model: 'gpt-5.3-codex-spark',
          reasoningEffort: 'medium',
          text: 'Final summary'
        }
      });

    expect(notifications.sent).toHaveLength(1);
  });

  it('does not send a failed terminal email when the operator only requests bot exit finalization', async () => {
    const authUsers = new FakeAuthenticatedUserRepository();
    const notifications = new FakeJobNotificationSender();
    await authUsers.upsert({ id: 'user-1', email: 'user1@example.com' });

    const app = createApp(undefined, {
      authenticatedUserRepository: authUsers,
      operatorAuth: new FakeOperatorAuth({
        validtoken: { id: 'user-1', email: 'user1@example.com' }
      }),
      meetingBotController: new FakeMeetingBotController(),
      jobNotificationSender: notifications
    });

    const created = await request(app)
      .post('/api/operator/jobs/meetings')
      .set('Authorization', 'Bearer validtoken')
      .send({
        meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV'
      });

    await request(app)
      .post('/recording-workers/claims')
      .send({ workerId: 'worker-alpha' });

    const stopped = await request(app)
      .post('/api/operator/stop-current')
      .set('Authorization', 'Bearer validtoken')
      .send({});

    expect(stopped.status).toBe(202);
    expect(notifications.sent).toHaveLength(0);
  });
});
