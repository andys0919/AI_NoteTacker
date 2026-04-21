import { describe, expect, it } from 'vitest';

import { getJobProgressModel } from '../public/job-progress.js';

describe('job progress model', () => {
  it('maps uploaded media preparation stages to coarse progress percentages', () => {
    expect(
      getJobProgressModel({
        inputSource: 'uploaded-audio',
        state: 'queued',
        processingStage: 'preparing-media'
      })
    ).toEqual({
      percent: 25,
      label: '媒體整理中',
      tone: 'active'
    });

    expect(
      getJobProgressModel({
        inputSource: 'uploaded-audio',
        state: 'transcribing',
        processingStage: 'transcribing-audio'
      })
    ).toEqual({
      percent: 65,
      label: '語音轉寫中',
      tone: 'active'
    });
  });

  it('prefers real transcription progress when the backend reports it', () => {
    expect(
      getJobProgressModel({
        inputSource: 'uploaded-audio',
        state: 'transcribing',
        processingStage: 'transcribing-audio',
        progressPercent: 41,
        progressProcessedMs: 1200000,
        progressTotalMs: 3600000
      })
    ).toEqual({
      percent: 41,
      label: '語音轉寫中',
      tone: 'active',
      processedMs: 1200000,
      totalMs: 3600000
    });
  });

  it('marks completed jobs as 100 percent', () => {
    expect(
      getJobProgressModel({
        inputSource: 'uploaded-audio',
        state: 'completed',
        processingStage: 'completed'
      })
    ).toEqual({
      percent: 100,
      label: '已完成',
      tone: 'completed'
    });
  });

  it('shows localized waiting and joining labels for meeting backlog states', () => {
    expect(
      getJobProgressModel({
        inputSource: 'meeting-link',
        state: 'queued',
        processingStage: 'waiting-for-recording-capacity'
      })
    ).toEqual({
      percent: 8,
      label: '等待錄製容量',
      tone: 'active'
    });

    expect(
      getJobProgressModel({
        inputSource: 'meeting-link',
        state: 'joining',
        processingStage: 'joining-meeting'
      })
    ).toEqual({
      percent: 20,
      label: '準備加入會議',
      tone: 'active'
    });

    expect(
      getJobProgressModel({
        inputSource: 'meeting-link',
        state: 'joining',
        processingStage: 'waiting-for-host-admission'
      })
    ).toEqual({
      percent: 28,
      label: '等待主持人允許',
      tone: 'active'
    });
  });

  it('does not pretend lobby exits are recording finalization work when no recording artifact exists', () => {
    expect(
      getJobProgressModel({
        inputSource: 'meeting-link',
        state: 'joining',
        processingStage: 'finalizing-recording'
      })
    ).toEqual({
      percent: 18,
      label: '取消入會中',
      tone: 'active'
    });
  });

  it('marks failed jobs as failed even when they reached a terminal stage', () => {
    expect(
      getJobProgressModel({
        inputSource: 'meeting-link',
        state: 'failed',
        processingStage: 'failed'
      })
    ).toEqual({
      percent: 100,
      label: '處理失敗',
      tone: 'failed'
    });
  });
});
