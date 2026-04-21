import { describe, expect, it } from 'vitest';

import { getMeetingBotStatusCopy } from '../public/job-runtime-state.js';

describe('meeting bot runtime status copy', () => {
  it('shows joining copy while the bot is entering the meeting', () => {
    expect(
      getMeetingBotStatusCopy({
        inputSource: 'meeting-link',
        state: 'joining'
      })
    ).toBe('AI Bot is joining the meeting.');
  });

  it('shows joined copy when the runtime reports recording', () => {
    expect(
      getMeetingBotStatusCopy({
        inputSource: 'meeting-link',
        state: 'joining',
        displayState: 'recording'
      })
    ).toBe('AI Bot joined the meeting and is recording.');
  });

  it('shows lobby-exit copy when the operator leaves before the bot was admitted', () => {
    expect(
      getMeetingBotStatusCopy({
        inputSource: 'meeting-link',
        state: 'joining',
        processingStage: 'finalizing-recording'
      })
    ).toBe('AI Bot is leaving the lobby because the meeting never admitted it.');
  });

  it('shows recording finalization copy only after a recording artifact exists', () => {
    expect(
      getMeetingBotStatusCopy({
        inputSource: 'meeting-link',
        state: 'recording',
        processingStage: 'finalizing-recording',
        recordingArtifact: {
          storageKey: 'recordings/job_runtime/meeting.webm'
        }
      })
    ).toBe('AI Bot is leaving the meeting and finalizing the recording.');
  });
});
