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

  it('shows finalizing copy when the operator requested the bot to leave', () => {
    expect(
      getMeetingBotStatusCopy({
        inputSource: 'meeting-link',
        state: 'joining',
        processingStage: 'finalizing-recording'
      })
    ).toBe('AI Bot is leaving the meeting and finalizing the recording.');
  });
});
