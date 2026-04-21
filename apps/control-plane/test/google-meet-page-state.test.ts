import { describe, expect, it } from 'vitest';

import { isLikelyValidGoogleMeetPage } from '../../ops/meeting-bot/google_meet_page_state.js';

describe('google meet page state helper', () => {
  it('keeps the recording alive during startup grace even when english ui buttons are missing', () => {
    expect(
      isLikelyValidGoogleMeetPage({
        currentUrl: 'https://meet.google.com/ric-xqxo-pcc',
        bodyText: '',
        visibleButtonAriaLabels: [],
        hasAvatarCountBadge: false,
        nowMs: 30_000,
        recordingStartedAtMs: 0
      })
    ).toBe(true);
  });

  it('accepts in-meeting body text signals even without english aria labels', () => {
    expect(
      isLikelyValidGoogleMeetPage({
        currentUrl: 'https://meet.google.com/ric-xqxo-pcc',
        bodyText: 'Andy Tsai (Presenting)\n3\nPress Down Arrow to open details\nchat\nChat with everyone\napps\nMeeting tools',
        visibleButtonAriaLabels: [],
        hasAvatarCountBadge: false,
        nowMs: 120_000,
        recordingStartedAtMs: 0
      })
    ).toBe(true);
  });

  it('treats explicit not-admitted and removed messages as invalid meeting pages', () => {
    expect(
      isLikelyValidGoogleMeetPage({
        currentUrl: 'https://meet.google.com/ric-xqxo-pcc',
        bodyText: 'No one responded to your request to join the call',
        visibleButtonAriaLabels: [],
        hasAvatarCountBadge: false,
        nowMs: 120_000,
        recordingStartedAtMs: 0
      })
    ).toBe(false);

    expect(
      isLikelyValidGoogleMeetPage({
        currentUrl: 'https://meet.google.com/ric-xqxo-pcc',
        bodyText: "You've been removed from the meeting",
        visibleButtonAriaLabels: [],
        hasAvatarCountBadge: false,
        nowMs: 120_000,
        recordingStartedAtMs: 0
      })
    ).toBe(false);
  });

  it('rejects unrelated pages after grace period when no meeting signals remain', () => {
    expect(
      isLikelyValidGoogleMeetPage({
        currentUrl: 'https://example.com/',
        bodyText: '',
        visibleButtonAriaLabels: [],
        hasAvatarCountBadge: false,
        nowMs: 120_000,
        recordingStartedAtMs: 0
      })
    ).toBe(false);

    expect(
      isLikelyValidGoogleMeetPage({
        currentUrl: 'https://meet.google.com/ric-xqxo-pcc',
        bodyText: '',
        visibleButtonAriaLabels: [],
        hasAvatarCountBadge: false,
        nowMs: 120_000,
        recordingStartedAtMs: 0
      })
    ).toBe(false);
  });
});
