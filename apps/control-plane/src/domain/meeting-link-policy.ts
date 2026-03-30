import type { MeetingPlatform } from './recording-job.js';

type SupportedMeetingLink = {
  supported: true;
  platform: MeetingPlatform;
};

type UnsupportedMeetingLink = {
  supported: false;
  code: 'unsupported-meeting-link';
  message: string;
};

export type MeetingLinkPolicyResult = SupportedMeetingLink | UnsupportedMeetingLink;

const unsupported = (message: string): UnsupportedMeetingLink => ({
  supported: false,
  code: 'unsupported-meeting-link',
  message
});

const isGoogleMeetJoinLink = (url: URL): boolean =>
  url.hostname === 'meet.google.com' && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname);

const isTeamsJoinLink = (url: URL): boolean =>
  (url.hostname === 'teams.microsoft.com' && url.pathname.includes('/l/meetup-join/')) ||
  (url.hostname === 'teams.live.com' && url.pathname.startsWith('/meet/'));

const isZoomJoinLink = (url: URL): boolean =>
  /(^|\.)zoom\.us$/i.test(url.hostname) && /^\/j\/\d+/.test(url.pathname) && !url.searchParams.has('pwd');

export const evaluateMeetingLinkPolicy = (meetingUrl: string): MeetingLinkPolicyResult => {
  let url: URL;

  try {
    url = new URL(meetingUrl);
  } catch {
    return unsupported('The meeting URL is not a valid absolute URL.');
  }

  if (!['https:'].includes(url.protocol)) {
    return unsupported('Only HTTPS meeting URLs are supported.');
  }

  if (isGoogleMeetJoinLink(url)) {
    return {
      supported: true,
      platform: 'google-meet'
    };
  }

  if (isTeamsJoinLink(url)) {
    return {
      supported: true,
      platform: 'microsoft-teams'
    };
  }

  if (isZoomJoinLink(url)) {
    return {
      supported: true,
      platform: 'zoom'
    };
  }

  if (/(^|\.)zoom\.us$/i.test(url.hostname) && url.searchParams.has('pwd')) {
    return unsupported('Zoom links with embedded passwords are not supported in the current guest-join policy.');
  }

  return unsupported('The meeting URL does not match a supported direct guest-join meeting pattern.');
};
