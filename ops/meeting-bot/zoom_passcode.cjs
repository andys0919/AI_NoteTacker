const passcodeErrorTokens = [
  'passcode wrong',
  'wrong passcode',
  'passcode is incorrect',
  'incorrect passcode',
  'invalid passcode',
  '密碼錯誤',
  '密码错误'
];

const normalize = (value) => (value ?? '').trim().toLowerCase();

const detectZoomPasscodeError = (bodyText) => {
  const normalizedText = normalize(bodyText);

  if (!normalizedText) {
    return false;
  }

  return passcodeErrorTokens.some((token) => normalizedText.includes(normalize(token)));
};

const resolveZoomPasscodePlan = ({ passcodeFieldVisible, providedPasscode }) => {
  const passcode = (providedPasscode ?? '').trim();

  if (!passcodeFieldVisible) {
    return { action: 'none' };
  }

  if (!passcode) {
    return { action: 'fail' };
  }

  return { action: 'fill', passcode };
};

module.exports = {
  detectZoomPasscodeError,
  resolveZoomPasscodePlan
};
