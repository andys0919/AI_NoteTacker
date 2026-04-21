import { describe, expect, it } from 'vitest';

import { getAuthEntryViewModel } from '../public/auth-entry.js';

describe('auth entry helpers', () => {
  it('shows a disabled setup hint when auth is not enabled', () => {
    expect(
      getAuthEntryViewModel({
        authEnabled: false,
        currentOperatorEmail: null,
        pendingAuthEmail: null
      })
    ).toEqual({
      hidden: false,
      disabled: true,
      buttonText: '登入未啟用',
      hintText: '這個環境尚未設定 Email 驗證登入。'
    });
  });

  it('shows a pending verification state when an OTP was requested', () => {
    expect(
      getAuthEntryViewModel({
        authEnabled: true,
        currentOperatorEmail: null,
        pendingAuthEmail: 'person@example.com'
      })
    ).toEqual({
      hidden: false,
      disabled: false,
      buttonText: '輸入驗證碼',
      hintText: '驗證碼已寄到 person@example.com，點這裡繼續完成登入。'
    });
  });

  it('hides the entry once the operator is signed in', () => {
    expect(
      getAuthEntryViewModel({
        authEnabled: true,
        currentOperatorEmail: 'person@example.com',
        pendingAuthEmail: null
      })
    ).toEqual({
      hidden: true,
      disabled: false,
      buttonText: '登入',
      hintText: '使用公司 email 驗證後開始送件。'
    });
  });
});
