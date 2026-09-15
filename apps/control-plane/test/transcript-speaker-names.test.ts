import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createAdminConsoleAuth } from '../src/infrastructure/admin-console-auth.js';
import request, { TEST_ADMIN_CONSOLE_PASSWORD } from './test-request.js';

const storeDiarizedTranscript = async (app: ReturnType<typeof createApp>) => {
  const created = await request(app)
    .post('/recording-jobs')
    .send({ meetingUrl: 'https://meet.google.com/abc-defg-hij' });

  await request(app)
    .post(`/recording-jobs/${created.body.id}/events`)
    .send({
      type: 'recording-artifact-stored',
      recordingArtifact: {
        storageKey: 'recordings/job_speakers/meeting.webm',
        downloadUrl: 'https://storage.example.test/recordings/job_speakers/meeting.webm',
        contentType: 'video/webm'
      }
    });

  const stored = await request(app)
    .post(`/recording-jobs/${created.body.id}/events`)
    .send({
      type: 'transcript-artifact-stored',
      transcriptArtifact: {
        schemaVersion: 3,
        storageKey: 'transcripts/job_speakers/transcript.json',
        downloadUrl: 'https://storage.example.test/transcripts/job_speakers/transcript.json',
        contentType: 'application/json',
        language: 'zh-Hant',
        segments: [
          {
            startMs: 0,
            endMs: 4_000,
            text: '先看流程。',
            timingSource: 'provider',
            speaker: 'Speaker 1',
            speakerSource: 'provider-diarization'
          },
          {
            startMs: 4_000,
            endMs: 5_000,
            text: '好。',
            timingSource: 'provider',
            speaker: 'Speaker 2',
            speakerSource: 'provider-diarization'
          }
        ]
      }
    });

  return { jobId: created.body.id as string, stored };
};

describe('transcript speaker names', () => {
  it('accepts a v3 diarized transcript and applies operator names to reads and exports', async () => {
    const app = createApp();
    const { jobId, stored } = await storeDiarizedTranscript(app);

    expect(stored.status).toBe(202);

    const renamed = await request(app)
      .put(`/api/operator/jobs/${jobId}/speakers`)
      .send({ submitterId: 'anonymous', speakerNames: { 'Speaker 1': ' 王經理 ', 'Speaker 2': '' } });

    expect(renamed.status).toBe(200);
    expect(renamed.body.transcriptArtifact.speakerNames).toEqual({ 'Speaker 1': '王經理' });
    // Provider labels stay on the segments as evidence.
    expect(renamed.body.transcriptArtifact.segments[0].speaker).toBe('Speaker 1');

    const detail = await request(app).get(`/api/operator/jobs/${jobId}?submitterId=anonymous`);
    expect(detail.body.transcriptArtifact.speakerNames).toEqual({ 'Speaker 1': '王經理' });

    const markdown = await request(app).get(
      `/api/operator/jobs/${jobId}/export?format=markdown&submitterId=anonymous`
    );
    expect(markdown.text).toContain('] 王經理：先看流程。');
    expect(markdown.text).toContain('] Speaker 2：好。');

    const srt = await request(app).get(
      `/api/operator/jobs/${jobId}/export?format=srt&submitterId=anonymous`
    );
    expect(srt.text).toContain('\n王經理：先看流程。');
  });

  it('moves one segment to a new voice and clears the override when moved back', async () => {
    const app = createApp();
    const { jobId } = await storeDiarizedTranscript(app);

    const moved = await request(app)
      .put(`/api/operator/jobs/${jobId}/speakers`)
      .send({
        submitterId: 'anonymous',
        segmentSpeakers: { '1': 'Speaker 3' },
        speakerNames: { 'Speaker 3': 'AMT-2' }
      });
    expect(moved.status).toBe(200);
    expect(moved.body.transcriptArtifact.segmentSpeakers).toEqual({ '1': 'Speaker 3' });
    expect(moved.body.transcriptArtifact.speakerNames).toEqual({ 'Speaker 3': 'AMT-2' });

    const markdown = await request(app).get(
      `/api/operator/jobs/${jobId}/export?format=markdown&submitterId=anonymous`
    );
    expect(markdown.text).toContain('] AMT-2：好。');

    const restored = await request(app)
      .put(`/api/operator/jobs/${jobId}/speakers`)
      .send({ submitterId: 'anonymous', segmentSpeakers: { '1': 'Speaker 2' } });
    expect(restored.status).toBe(200);
    expect(restored.body.transcriptArtifact.segmentSpeakers).toBeUndefined();
    // A name for a label no segment carries any more is dropped with it.
    expect(restored.body.transcriptArtifact.speakerNames).toBeUndefined();

    const badIndex = await request(app)
      .put(`/api/operator/jobs/${jobId}/speakers`)
      .send({ submitterId: 'anonymous', segmentSpeakers: { '9': 'Speaker 1' } });
    expect(badIndex.status).toBe(400);
  });

  it('exports the transcript alone as Markdown with names and times, for owners and admins', async () => {
    const adminConsoleAuth = createAdminConsoleAuth({
      username: 'admin',
      password: TEST_ADMIN_CONSOLE_PASSWORD,
      sessionSecret: 'unit-test-secret'
    });
    const app = createApp(undefined, { adminConsoleAuth });
    const { jobId } = await storeDiarizedTranscript(app);
    await request(app)
      .put(`/api/operator/jobs/${jobId}/speakers`)
      .send({ submitterId: 'anonymous', speakerNames: { 'Speaker 1': '王經理' } });

    const transcriptOnly = await request(app).get(
      `/api/operator/jobs/${jobId}/export?format=markdown&part=transcript&submitterId=anonymous`
    );
    expect(transcriptOnly.status).toBe(200);
    expect(transcriptOnly.headers['content-disposition']).toContain('-transcript.md');
    expect(transcriptOnly.text).toContain('## Transcript');
    expect(transcriptOnly.text).toContain('- [00:00:00.000] 王經理：先看流程。');
    expect(transcriptOnly.text).not.toContain('## Summary');

    const summaryOnly = await request(app).get(
      `/api/operator/jobs/${jobId}/export?format=markdown&part=summary&submitterId=anonymous`
    );
    expect(summaryOnly.status).toBe(200);
    expect(summaryOnly.text).not.toContain('## Transcript');

    const login = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: TEST_ADMIN_CONSOLE_PASSWORD });
    const adminExport = await request(app)
      .get(`/api/admin/jobs/${jobId}/export?format=markdown&part=transcript`)
      .set('authorization', `Bearer ${login.body.token}`);
    expect(adminExport.status).toBe(200);
    expect(adminExport.text).toContain('王經理：先看流程。');
    expect((await request(app).get(`/api/admin/jobs/${jobId}/export?format=markdown`)).status).toBe(401);
  });

  it('lets an admin apply the same speaker edits to any job', async () => {
    const adminConsoleAuth = createAdminConsoleAuth({
      username: 'admin',
      password: TEST_ADMIN_CONSOLE_PASSWORD,
      sessionSecret: 'unit-test-secret'
    });
    const app = createApp(undefined, { adminConsoleAuth });
    const { jobId } = await storeDiarizedTranscript(app);
    const login = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: TEST_ADMIN_CONSOLE_PASSWORD });

    const renamed = await request(app)
      .put(`/api/admin/jobs/${jobId}/speakers`)
      .set('authorization', `Bearer ${login.body.token}`)
      .send({ speakerNames: { 'Speaker 1': '王經理' } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.transcriptArtifact.speakerNames).toEqual({ 'Speaker 1': '王經理' });

    const unauthenticated = await request(app)
      .put(`/api/admin/jobs/${jobId}/speakers`)
      .send({ speakerNames: { 'Speaker 1': '路人' } });
    expect(unauthenticated.status).toBe(401);
  });

  it('rejects names for labels that are not in the transcript', async () => {
    const app = createApp();
    const { jobId } = await storeDiarizedTranscript(app);

    const response = await request(app)
      .put(`/api/operator/jobs/${jobId}/speakers`)
      .send({ submitterId: 'anonymous', speakerNames: { 'Speaker 9': '路人' } });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('Speaker 9');
  });
});
