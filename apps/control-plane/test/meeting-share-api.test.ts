import request from './test-request.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import {
  attachSummaryArtifact,
  attachTranscriptArtifact,
  createRecordingJob
} from '../src/domain/recording-job.js';
import {
  createMeetingShareLink,
  createMeetingShareToken
} from '../src/domain/meeting-share.js';
import { InMemoryRecordingJobRepository } from '../src/infrastructure/in-memory-recording-job-repository.js';

const shareSecret = 'test-only-meeting-share-secret-32-bytes';
const now = new Date('2026-07-31T08:00:00.000Z');

const createCompletedJob = () =>
  attachSummaryArtifact(
    attachTranscriptArtifact(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/private-room',
        platform: 'google-meet',
        submitterId: 'operator-share',
        uploadedFileName: 'private-recording.mp4',
        summaryRequested: true,
        pricingVersion: 'private-pricing'
      }),
      {
        storageKey: 'private/transcript.json',
        downloadUrl: 'https://storage.example.test/private/transcript.json',
        contentType: 'application/json',
        language: 'zh-Hant',
        segments: [
          {
            startMs: 1_000,
            endMs: 8_000,
            text: 'Speaker A：第一項決議',
            rawText: 'PRIVATE_RAW_TEXT',
            displayText: 'Speaker A：第一項決議',
            speaker: 'Speaker A',
            reviewFlags: [
              {
                reason: 'private-review',
                originalText: 'PRIVATE_ORIGINAL',
                candidates: ['PRIVATE_CANDIDATE'],
                evidence: 'PRIVATE_EVIDENCE'
              }
            ]
          },
          {
            startMs: 8_000,
            endMs: 12_500,
            text: 'Speaker <B>：下一步由我整理。'
          }
        ]
      }
    ),
    {
      model: 'private-summary-model',
      reasoningEffort: 'private-effort',
      text: 'Speaker A 完成第一項決議。\n\n## AI 分析\n\n- 不公開模型分析',
      structured: {
        title: 'Speaker A 專案會議',
        summary: 'Speaker A 完成第一項決議。',
        topics: [
          {
            title: 'Speaker A 的提案',
            status: 'confirmed',
            points: ['Speaker A 提出方案'],
            conclusion: '採用方案'
          }
        ],
        followUpGroups: [{ title: '執行', items: ['王小明整理記錄'] }],
        keyPoints: ['第一項決議'],
        actionItems: ['王小明整理記錄'],
        decisions: ['採用方案'],
        risks: ['時程緊迫'],
        openQuestions: ['上線日期'],
        analysisNotes: ['不公開模型分析']
      }
    }
  );

const createShare = (app: ReturnType<typeof createApp>, jobId: string) =>
  request(app)
    .post(`/api/operator/jobs/${jobId}/share`)
    .send({ submitterId: 'operator-share' });

describe('meeting share API', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses one 30-day link and exposes only the public meeting allowlist', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const job = createCompletedJob();
    await repository.save(job);
    const app = createApp(repository, { meetingShareSecret: shareSecret });

    const beforeCreate = await request(app)
      .get(`/api/operator/jobs/${job.id}`)
      .query({ submitterId: 'operator-share' });
    expect(beforeCreate.body.share).toEqual({ status: 'none', eligible: true });

    const first = await createShare(app, job.id);
    const second = await createShare(app, job.id);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.token).toMatch(/^v1\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]+$/);
    expect(second.body.token).toBe(first.body.token);
    expect(first.body.expiresAt).toBe('2026-08-30T08:00:00.000Z');

    const afterCreate = await request(app)
      .get(`/api/operator/jobs/${job.id}`)
      .query({ submitterId: 'operator-share' });
    expect(afterCreate.body.share).toEqual({
      status: 'active',
      eligible: true,
      expiresAt: '2026-08-30T08:00:00.000Z'
    });

    const shared = await request(app)
      .get('/api/shared-meeting')
      .set('Authorization', `Bearer ${first.body.token}`);

    expect(shared.status).toBe(200);
    expect(shared.headers['cache-control']).toContain('no-store');
    expect(shared.headers['referrer-policy']).toBe('no-referrer');
    expect(shared.headers['x-robots-tag']).toContain('noindex');
    expect(shared.body).toEqual({
      title: '與會者 專案會議',
      createdAt: job.createdAt,
      durationMs: 11_500,
      summary: {
        structured: {
          title: '與會者 專案會議',
          summary: '與會者 完成第一項決議。',
          topics: [
            {
              title: '與會者 的提案',
              status: 'confirmed',
              points: ['與會者 提出方案'],
              conclusion: '採用方案'
            }
          ],
          followUpGroups: [{ title: '執行', items: ['王小明整理記錄'] }],
          keyPoints: ['第一項決議'],
          actionItems: ['王小明整理記錄'],
          decisions: ['採用方案'],
          risks: ['時程緊迫'],
          openQuestions: ['上線日期']
        }
      },
      transcript: {
        segments: [
          {
            startMs: 1_000,
            endMs: 8_000,
            text: '第一項決議'
          },
          {
            startMs: 8_000,
            endMs: 12_500,
            text: '下一步由我整理。'
          }
        ]
      }
    });

    const serialized = JSON.stringify(shared.body);
    [
      'private-room',
      'private-recording.mp4',
      'operator-share',
      'private-pricing',
      'private-summary-model',
      'private-effort',
      'private/transcript.json',
      'storage.example.test',
      'PRIVATE_RAW_TEXT',
      'PRIVATE_ORIGINAL',
      'PRIVATE_CANDIDATE',
      'PRIVATE_EVIDENCE',
      '不公開模型分析',
      'Speaker <B>'
    ].forEach((privateValue) => expect(serialized).not.toContain(privateValue));
  });

  it('rotates, revokes, expires, and soft-delete invalidates links with one generic response', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const job = createCompletedJob();
    await repository.save(job);
    const app = createApp(repository, {
      meetingShareSecret: shareSecret,
      uploadedAudioStorage: {
        async storeUpload() {
          throw new Error('not used by this test');
        },
        async deleteObjects() {}
      }
    });

    const created = await createShare(app, job.id);
    const rotated = await request(app)
      .post(`/api/operator/jobs/${job.id}/share/rotate`)
      .send({ submitterId: 'operator-share' });

    expect(rotated.status).toBe(200);
    expect(rotated.body.token).not.toBe(created.body.token);

    const oldLink = await request(app)
      .get('/api/shared-meeting')
      .set('Authorization', `Bearer ${created.body.token}`);
    expect(oldLink.status).toBe(404);
    expect(oldLink.body).toEqual({
      error: { code: 'shared-meeting-unavailable', message: 'This shared meeting is unavailable.' }
    });

    const revoked = await request(app)
      .delete(`/api/operator/jobs/${job.id}/share`)
      .send({ submitterId: 'operator-share' });
    expect(revoked.status).toBe(204);

    const afterRevoke = await request(app)
      .get(`/api/operator/jobs/${job.id}`)
      .query({ submitterId: 'operator-share' });
    expect(afterRevoke.body.share).toEqual({
      status: 'revoked',
      eligible: true,
      expiresAt: '2026-08-30T08:00:00.000Z'
    });

    const revokedLink = await request(app)
      .get('/api/shared-meeting')
      .set('Authorization', `Bearer ${rotated.body.token}`);
    expect(revokedLink.status).toBe(404);
    expect(revokedLink.body).toEqual(oldLink.body);

    const recreated = await createShare(app, job.id);
    vi.setSystemTime(new Date('2026-08-30T08:00:00.001Z'));
    const expired = await request(app)
      .get('/api/shared-meeting')
      .set('Authorization', `Bearer ${recreated.body.token}`);
    expect(expired.status).toBe(404);
    expect(expired.body).toEqual(oldLink.body);

    vi.setSystemTime(now);
    const activeAgain = await createShare(app, job.id);
    const deletedJob = await request(app)
      .delete(`/api/operator/jobs/${job.id}`)
      .send({ submitterId: 'operator-share' });
    expect(deletedJob.status).toBe(200);
    expect(deletedJob.body.artifactCleanup).toEqual({ status: 'completed', objectCount: 1 });
    const deleted = await request(app)
      .get('/api/shared-meeting')
      .set('Authorization', `Bearer ${activeAgain.body.token}`);
    expect(deleted.status).toBe(404);
    expect(deleted.body).toEqual(oldLink.body);
  });

  it('rejects ineligible, unauthorized, malformed, and unconfigured sharing', async () => {
    const repository = new InMemoryRecordingJobRepository();
    const completed = createCompletedJob();
    const active = createRecordingJob({
      meetingUrl: 'https://meet.google.com/not-finished',
      platform: 'google-meet',
      submitterId: 'operator-share'
    });
    const emptyContent = createCompletedJob();
    emptyContent.transcriptArtifact = {
      ...emptyContent.transcriptArtifact!,
      segments: [{ startMs: 0, endMs: 1_000, text: '   ' }]
    };
    emptyContent.summaryArtifact = {
      ...emptyContent.summaryArtifact!,
      text: '   ',
      structured: undefined
    };
    await repository.save(completed);
    await repository.save(active);
    await repository.save(emptyContent);

    const configured = createApp(repository, { meetingShareSecret: shareSecret });
    const wrongOwner = await request(configured)
      .post(`/api/operator/jobs/${completed.id}/share`)
      .send({ submitterId: 'operator-other' });
    expect(wrongOwner.status).toBe(404);

    const ineligible = await createShare(configured, active.id);
    expect(ineligible.status).toBe(409);
    expect(ineligible.body.error.code).toBe('meeting-share-ineligible');

    const empty = await createShare(configured, emptyContent.id);
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe('meeting-share-ineligible');

    const emptyDetail = await request(configured)
      .get(`/api/operator/jobs/${emptyContent.id}`)
      .query({ submitterId: 'operator-share' });
    expect(emptyDetail.body.share).toEqual({ status: 'none', eligible: false });

    for (const authorization of [undefined, 'Bearer invalid', 'Basic invalid']) {
      const shared = request(configured).get('/api/shared-meeting');
      if (authorization) shared.set('Authorization', authorization);
      const response = await shared;
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('shared-meeting-unavailable');
    }

    const unconfigured = createApp(repository, { meetingShareSecret: '' });
    const disabledCreate = await createShare(unconfigured, completed.id);
    expect(disabledCreate.status).toBe(503);
    expect(disabledCreate.body.error.code).toBe('meeting-share-unavailable');

    const disabledRead = await request(unconfigured)
      .get('/api/shared-meeting')
      .set('Authorization', 'Bearer v1.fake.fake');
    expect(disabledRead.status).toBe(404);
    expect(disabledRead.body.error.code).toBe('shared-meeting-unavailable');

    const weakSecret = createApp(repository, { meetingShareSecret: 'too-short' });
    const weakCreate = await createShare(weakSecret, completed.id);
    expect(weakCreate.status).toBe(503);
    expect(weakCreate.body.error.code).toBe('meeting-share-unavailable');

    const weakLink = await repository.rotateMeetingShareLink(
      createMeetingShareLink(completed.id, now)
    );
    const weakRead = await request(weakSecret)
      .get('/api/shared-meeting')
      .set('Authorization', `Bearer ${createMeetingShareToken(weakLink, 'too-short')}`);
    expect(weakRead.status).toBe(404);
    expect(weakRead.body.error.code).toBe('shared-meeting-unavailable');
  });
});
