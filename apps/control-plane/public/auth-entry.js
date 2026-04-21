export const getAuthEntryViewModel = ({
  authEnabled,
  currentOperatorEmail,
  pendingAuthEmail
}) => {
  if (!authEnabled) {
    return {
      hidden: false,
      disabled: true,
      buttonText: '登入未啟用',
      hintText: '這個環境尚未設定 Email 驗證登入。'
    };
  }

  if (currentOperatorEmail) {
    return {
      hidden: true,
      disabled: false,
      buttonText: '登入',
      hintText: '使用公司 email 驗證後開始送件。'
    };
  }

  if (pendingAuthEmail) {
    return {
      hidden: false,
      disabled: false,
      buttonText: '輸入驗證碼',
      hintText: `驗證碼已寄到 ${pendingAuthEmail}，點這裡繼續完成登入。`
    };
  }

  return {
    hidden: false,
    disabled: false,
    buttonText: '登入',
    hintText: '使用公司 email 驗證後開始送件。'
  };
};
