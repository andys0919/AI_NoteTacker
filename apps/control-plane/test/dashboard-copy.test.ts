import { describe, expect, it } from 'vitest';

import {
  getEmptyStateMessage,
  getJobCardViewModel,
  renderOptionalMarkup
} from '../public/dashboard-copy.js';

describe('dashboard copy helpers', () => {
  it('builds a simplified meeting job card view model for active work', () => {
    const model = getJobCardViewModel({
      id: 'job_meeting_1',
      inputSource: 'meeting-link',
      state: 'joining',
      displayState: 'recording',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      requestedJoinName: 'Solomon NoteTaker',
      createdAt: '2026-04-08T09:00:00.000Z',
      updatedAt: '2026-04-08T09:05:00.000Z'
    });

    expect(model).toMatchObject({
      title: '會議摘要',
      sourceLabel: '會議連結',
      sourceValue: 'https://meet.google.com/abc-defg-hij',
      joinNameLabel: '顯示名稱',
      joinNameValue: 'Solomon NoteTaker',
      badgeLabel: '錄製中',
      statusSummary: '系統正在擷取會議內容，完成後會自動產出逐字稿與摘要。',
      progressLabel: '錄製會議中',
      showProgress: true,
      showHistory: false
    });
  });

  it('explains lobby exits without pretending the system is finalizing a recording', () => {
    const model = getJobCardViewModel({
      id: 'job_meeting_lobby_exit',
      inputSource: 'meeting-link',
      state: 'joining',
      meetingUrl: 'https://meet.google.com/lobby-exit-demo',
      requestedJoinName: 'Solomon NoteTaker',
      processingStage: 'finalizing-recording',
      createdAt: '2026-04-08T09:00:00.000Z',
      updatedAt: '2026-04-08T09:05:00.000Z'
    });

    expect(model.statusSummary).toBe('系統正在取消尚未被允許入會的請求，這場會議不會產生錄音。');
    expect(model.progressLabel).toBe('取消入會中');
  });

  it('shows finalization copy when recording state exits without artifact yet', () => {
    const model = getJobCardViewModel({
      id: 'job_recording_finalizing',
      inputSource: 'meeting-link',
      state: 'recording',
      meetingUrl: 'https://teams.live.com/meet/123',
      requestedJoinName: 'Solomon NoteTaker',
      processingStage: 'finalizing-recording',
      createdAt: '2026-04-21T02:00:00.000Z',
      updatedAt: '2026-04-21T02:05:00.000Z'
    });

    expect(model.statusSummary).toBe('系統正在結束錄製並整理檔案，接著會繼續產出逐字稿與摘要。');
  });

  it('marks completed uploaded audio jobs as ready to review and export', () => {
    const model = getJobCardViewModel({
      id: 'job_upload_1',
      inputSource: 'uploaded-audio',
      state: 'completed',
      progressTotalMs: 6_407_000,
      actualTranscriptionCostUsd: 0.12,
      actualSummaryCostUsd: 0.003,
      actualCloudCostUsd: 0.123,
      uploadedFileName: 'quarterly-review.m4a',
      createdAt: '2026-04-08T09:00:00.000Z',
      updatedAt: '2026-04-08T09:08:00.000Z',
      jobHistory: [
        {
          at: '2026-04-08T09:00:00.000Z',
          stage: 'queued',
          message: 'queued'
        },
        {
          at: '2026-04-08T09:08:00.000Z',
          stage: 'completed',
          message: 'done'
        }
      ]
    });

    expect(model).toMatchObject({
      title: '錄音整理',
      sourceLabel: '檔案',
      sourceValue: 'quarterly-review.m4a',
      badgeLabel: '已完成',
      statusSummary: '逐字稿與摘要已完成，可直接查看或匯出。',
      durationLabel: '時長',
      durationValue: '1:46:47',
      transcriptionCostLabel: '轉文字',
      transcriptionCostValue: '$0.120',
      summaryCostLabel: '摘要',
      summaryCostValue: '$0.003',
      totalCostLabel: '合計',
      totalCostValue: '$0.123',
      progressLabel: '已完成',
      showProgress: false,
      showHistory: false
    });
  });

  it('falls back to transcript segment length when total progress duration is unavailable', () => {
    const model = getJobCardViewModel({
      id: 'job_upload_2',
      inputSource: 'uploaded-audio',
      state: 'completed',
      uploadedFileName: 'board-review.m4a',
      createdAt: '2026-04-08T09:00:00.000Z',
      updatedAt: '2026-04-08T09:08:00.000Z',
      transcriptArtifact: {
        storageKey: 'transcripts/job_upload_2/transcript.json',
        downloadUrl: 'https://storage.example.test/transcripts/job_upload_2/transcript.json',
        contentType: 'application/json',
        language: 'zh',
        segments: [
          { startMs: 0, endMs: 1000, text: 'hello' },
          { startMs: 1000, endMs: 3672000, text: 'world' }
        ]
      }
    });

    expect(model.durationLabel).toBe('時長');
    expect(model.durationValue).toBe('1:01:12');
  });

  it('returns a more helpful archive empty-state message while searching', () => {
    expect(getEmptyStateMessage('sales')).toBe(
      '找不到符合「sales」的紀錄，請改用會議名稱、連結或摘要關鍵字搜尋。'
    );
  });

  it('tells the operator when transcript finished but summary is still missing', () => {
    const model = getJobCardViewModel({
      id: 'job_transcript_only',
      inputSource: 'uploaded-audio',
      state: 'completed',
      uploadedFileName: 'transcript-only.m4a',
      createdAt: '2026-04-08T09:00:00.000Z',
      updatedAt: '2026-04-08T09:08:00.000Z',
      transcriptArtifact: {
        storageKey: 'transcripts/job_transcript_only/transcript.json',
        downloadUrl: 'https://storage.example.test/transcripts/job_transcript_only/transcript.json',
        contentType: 'application/json',
        language: 'zh',
        segments: [{ startMs: 0, endMs: 1000, text: 'hello' }]
      }
    });

    expect(model.statusSummary).toBe('逐字稿已完成，但摘要尚未產生。');
  });

  it('drops falsey non-string markup blocks instead of rendering false into the card', () => {
    expect(renderOptionalMarkup(false)).toBe('');
    expect(renderOptionalMarkup(undefined)).toBe('');
    expect(renderOptionalMarkup('<div>ok</div>')).toBe('<div>ok</div>');
  });
});
