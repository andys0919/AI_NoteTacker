export const GOOGLE_MEET_PAGE_STATE_GRACE_MS = 60_000;

const positiveMeetingTokens = [
  'Meeting tools',
  'Chat with everyone',
  'Press Down Arrow to open',
  'Presenting',
  'Meeting details',
  '會議工具',
  '與所有人聊天',
  '會議詳細資料',
  '發言',
  '參與者'
];

const negativeMeetingTokens = [
  "You've been removed from the meeting",
  'No one responded to your request to join the call',
  '你無法加入這場視訊通話',
  '任何人都必須經過主辦人邀請或允許，才能加入會議'
];

const knownButtonLabelFragments = [
  'people',
  'leave call',
  'leave meeting',
  'meeting details',
  'participants',
  '參與者',
  '離開通話',
  '離開會議',
  '會議詳細資料'
];

const normalize = (value) => (value ?? '').toLowerCase();

export const isLikelyValidGoogleMeetPage = ({
  currentUrl,
  bodyText,
  visibleButtonAriaLabels,
  hasAvatarCountBadge,
  nowMs,
  recordingStartedAtMs
}) => {
  if (!currentUrl.includes('meet.google.com')) {
    return false;
  }

  if (negativeMeetingTokens.some((token) => bodyText.includes(token))) {
    return false;
  }

  if (nowMs - recordingStartedAtMs < GOOGLE_MEET_PAGE_STATE_GRACE_MS) {
    return true;
  }

  const normalizedLabels = (visibleButtonAriaLabels ?? []).map(normalize);
  const hasKnownButtonLabels = normalizedLabels.some((label) =>
    knownButtonLabelFragments.some((fragment) => label.includes(fragment))
  );
  const hasKnownMeetingText = positiveMeetingTokens.some((token) => bodyText.includes(token));

  return Boolean(hasAvatarCountBadge || hasKnownButtonLabels || hasKnownMeetingText);
};
