import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

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
          text: 'Short summary'
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
  });

  it('returns 404 for an unknown recording job id', async () => {
    const app = createApp();

    const response = await request(app).get('/recording-jobs/job_missing');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('recording-job-not-found');
  });
});
