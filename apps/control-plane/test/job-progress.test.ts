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
      label: 'Preparing Media',
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
      label: 'Transcribing Audio',
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
      label: 'Transcribing Audio',
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
      label: 'Completed',
      tone: 'completed'
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
      label: 'Failed',
      tone: 'failed'
    });
  });
});
