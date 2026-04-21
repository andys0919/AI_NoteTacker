import { describe, expect, it } from 'vitest';

import joinRequestEvidenceModule from '../../ops/meeting-bot/join_request_evidence.cjs';

const { detectJoinRequestEvidence } = joinRequestEvidenceModule as {
  detectJoinRequestEvidence: (input: {
    platform: 'google' | 'microsoft' | 'zoom';
    bodyText?: string;
  }) => {
    submitted: boolean;
    status: 'submitted' | 'denied' | 'timed-out' | 'unknown';
  };
};

describe('meeting join-request evidence helper', () => {
  it('recognizes Google Meet waiting-room copy as submitted join-request evidence', () => {
    expect(
      detectJoinRequestEvidence({
        platform: 'google',
        bodyText: 'Please wait until a meeting host brings you into the call'
      })
    ).toEqual({
      submitted: true,
      status: 'submitted'
    });
  });

  it('recognizes Microsoft Teams waiting-room copy as submitted join-request evidence', () => {
    expect(
      detectJoinRequestEvidence({
        platform: 'microsoft',
        bodyText:
          "We've let people in the meeting know you're waiting. When someone lets you in, you'll join the meeting."
      })
    ).toEqual({
      submitted: true,
      status: 'submitted'
    });
  });

  it('recognizes Zoom waiting-room copy as submitted join-request evidence', () => {
    expect(
      detectJoinRequestEvidence({
        platform: 'zoom',
        bodyText: 'Please wait, the meeting host will let you in soon. Waiting Room'
      })
    ).toEqual({
      submitted: true,
      status: 'submitted'
    });
  });

  it('keeps denial and timeout states distinct from submitted join requests', () => {
    expect(
      detectJoinRequestEvidence({
        platform: 'google',
        bodyText: 'No one responded to your request to join the call'
      })
    ).toEqual({
      submitted: false,
      status: 'timed-out'
    });

    expect(
      detectJoinRequestEvidence({
        platform: 'google',
        bodyText:
          "You can't join this video call. No one can join a meeting unless invited or admitted by the host."
      })
    ).toEqual({
      submitted: false,
      status: 'denied'
    });

    expect(
      detectJoinRequestEvidence({
        platform: 'microsoft',
        bodyText: 'Sorry, but you were denied access to the meeting'
      })
    ).toEqual({
      submitted: false,
      status: 'denied'
    });
  });
});
