import { describe, expect, it } from 'vitest';

import zoomPasscodeModule from '../../ops/meeting-bot/zoom_passcode.cjs';

const { detectZoomPasscodeError, resolveZoomPasscodePlan } = zoomPasscodeModule as {
  detectZoomPasscodeError: (bodyText?: string) => boolean;
  resolveZoomPasscodePlan: (input: {
    passcodeFieldVisible: boolean;
    providedPasscode?: string;
  }) => { action: 'none' | 'fail' | 'fill'; passcode?: string };
};

describe('zoom passcode plan helper', () => {
  it('skips passcode handling when the meeting does not show a passcode field', () => {
    expect(
      resolveZoomPasscodePlan({ passcodeFieldVisible: false, providedPasscode: '424242' })
    ).toEqual({ action: 'none' });
  });

  it('fails fast when the meeting requires a passcode and none was provided', () => {
    expect(resolveZoomPasscodePlan({ passcodeFieldVisible: true })).toEqual({ action: 'fail' });
    expect(
      resolveZoomPasscodePlan({ passcodeFieldVisible: true, providedPasscode: '   ' })
    ).toEqual({ action: 'fail' });
  });

  it('fills the trimmed passcode when the meeting requires one and it was provided', () => {
    expect(
      resolveZoomPasscodePlan({ passcodeFieldVisible: true, providedPasscode: ' 424242 ' })
    ).toEqual({ action: 'fill', passcode: '424242' });
  });
});

describe('zoom passcode error detection', () => {
  it('recognizes Zoom wrong-passcode copy in English and Chinese', () => {
    expect(detectZoomPasscodeError('Passcode wrong. Please try again.')).toBe(true);
    expect(detectZoomPasscodeError('The passcode is incorrect')).toBe(true);
    expect(detectZoomPasscodeError('會議密碼錯誤，請再試一次')).toBe(true);
  });

  it('does not flag unrelated page text or empty bodies', () => {
    expect(detectZoomPasscodeError('Please wait, the meeting host will let you in soon')).toBe(
      false
    );
    expect(detectZoomPasscodeError('')).toBe(false);
    expect(detectZoomPasscodeError(undefined)).toBe(false);
  });
});
