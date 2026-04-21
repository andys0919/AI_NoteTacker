const googleSubmittedTokens = [
  'Please wait until a meeting host brings you',
  'Asking to join'
];

const googleTimeoutTokens = ['No one responded to your request to join the call'];

const googleDeniedTokens = [
  '你無法加入這場視訊通話',
  '任何人都必須經過主辦人邀請或允許，才能加入會議',
  "You can't join this video call",
  'No one can join a meeting unless invited or admitted by the host'
];

const microsoftSubmittedTokens = [
  "We've let people in the meeting know you're waiting",
  "We've let the meeting organizer know you're waiting",
  'Someone in the meeting should let you in soon',
  "When someone lets you in, you'll join the meeting"
];

const microsoftDeniedTokens = ['Sorry, but you were denied access to the meeting'];

const zoomSubmittedTokens = [
  'Please wait, the meeting host will let you in soon',
  'Waiting Room'
];

const zoomDeniedTokens = ['You have been removed'];

const normalize = (value) => (value ?? '').trim().toLowerCase();

const includesAny = (text, tokens) => tokens.some((token) => text.includes(normalize(token)));

const detectJoinRequestEvidence = ({ platform, bodyText }) => {
  const normalizedText = normalize(bodyText);

  if (!normalizedText) {
    return {
      submitted: false,
      status: 'unknown'
    };
  }

  if (platform === 'google') {
    if (includesAny(normalizedText, googleTimeoutTokens)) {
      return {
        submitted: false,
        status: 'timed-out'
      };
    }

    if (includesAny(normalizedText, googleDeniedTokens)) {
      return {
        submitted: false,
        status: 'denied'
      };
    }

    if (includesAny(normalizedText, googleSubmittedTokens)) {
      return {
        submitted: true,
        status: 'submitted'
      };
    }
  }

  if (platform === 'microsoft') {
    if (includesAny(normalizedText, microsoftDeniedTokens)) {
      return {
        submitted: false,
        status: 'denied'
      };
    }

    if (includesAny(normalizedText, microsoftSubmittedTokens)) {
      return {
        submitted: true,
        status: 'submitted'
      };
    }
  }

  if (platform === 'zoom') {
    if (includesAny(normalizedText, zoomDeniedTokens)) {
      return {
        submitted: false,
        status: 'denied'
      };
    }

    if (includesAny(normalizedText, zoomSubmittedTokens)) {
      return {
        submitted: true,
        status: 'submitted'
      };
    }
  }

  return {
    submitted: false,
    status: 'unknown'
  };
};

module.exports = {
  detectJoinRequestEvidence
};
