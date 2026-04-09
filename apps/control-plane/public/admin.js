import { createOperatorAuthClient } from '/auth-client.js';
import { formatJobTimestamp } from '/dashboard-copy.js';
import {
  formatProviderLabel,
  formatSummaryModeLabel,
  formatUsd,
  getAdminGovernanceViewModel,
  getAuditEntryViewModels,
  getUsageReportRowViewModels
} from '/governance-panel.js';

const elements = {
  adminAuditList: document.querySelector('#admin-audit-list'),
  adminContent: document.querySelector('#admin-content'),
  adminDeniedPanel: document.querySelector('#admin-denied-panel'),
  adminUsageReportList: document.querySelector('#admin-usage-report-list'),
  adminUsageReportSummary: document.querySelector('#admin-usage-report-summary'),
  adminProviderCopy: document.querySelector('#admin-provider-copy'),
  adminProviderCurrent: document.querySelector('#admin-provider-current'),
  adminProviderForm: document.querySelector('#admin-provider-form'),
  adminProviderPanel: document.querySelector('#admin-provider-panel'),
  adminProviderSelect: document.querySelector('#admin-provider-select'),
  adminTranscriptionModelInput: document.querySelector('#admin-transcription-model-input'),
  adminSummaryProviderSelect: document.querySelector('#admin-summary-provider-select'),
  adminSummaryModelInput: document.querySelector('#admin-summary-model-input'),
  adminPricingVersionInput: document.querySelector('#admin-pricing-version-input'),
  adminDefaultQuotaInput: document.querySelector('#admin-default-quota-input'),
  adminLiveMeetingCapInput: document.querySelector('#admin-live-meeting-cap-input'),
  adminLocalTranscriptionInput: document.querySelector('#admin-local-transcription-input'),
  adminCloudTranscriptionInput: document.querySelector('#admin-cloud-transcription-input'),
  adminLocalSummaryInput: document.querySelector('#admin-local-summary-input'),
  adminCloudSummaryInput: document.querySelector('#admin-cloud-summary-input'),
  adminOverrideForm: document.querySelector('#admin-override-form'),
  adminOverrideSubmitterId: document.querySelector('#admin-override-submitter-id'),
  adminOverrideQuotaInput: document.querySelector('#admin-override-quota-input'),
  adminOverrideSubmit: document.querySelector('#admin-override-submit'),
  adminSummaryModelStatus: document.querySelector('#admin-summary-model-status'),
  adminProviderStatus: document.querySelector('#admin-provider-status'),
  adminProviderStatusPill: document.querySelector('#admin-provider-status-pill'),
  adminProviderSubmit: document.querySelector('#admin-provider-submit'),
  authCopy: document.querySelector('#auth-copy'),
  authEmail: document.querySelector('#auth-email'),
  authForm: document.querySelector('#auth-form'),
  authOtp: document.querySelector('#auth-otp'),
  authPanel: document.querySelector('#auth-panel'),
  authSubmitButton: document.querySelector('#auth-submit-button'),
  otpField: document.querySelector('#otp-field'),
  otpVerifyButton: document.querySelector('#otp-verify-button'),
  sessionEmail: document.querySelector('#session-email'),
  signOutButton: document.querySelector('#sign-out-button')
};

let authClient = {
  enabled: false,
  authorizedFetch: (input, init) => fetch(input, init),
  getCurrentUser: async () => null,
  getPendingEmail: () => null,
  onAuthStateChange: () => () => {},
  requestEmailOtp: async () => {},
  verifyEmailOtp: async () => null,
  signOut: async () => {}
};
let authEnabled = false;
let currentOperatorEmail = null;
let pendingAuthEmail = null;
let unsubscribeAuthState = () => {};
let adminProviderState = null;

const apiFetch = async (input, init) => authClient.authorizedFetch(input, init);

const setBanner = (message) => {
  if (!message) {
    return;
  }

  elements.adminProviderStatus.textContent = message;
};

const syncOtpUi = () => {
  const hasPendingOtp = Boolean(authEnabled && !currentOperatorEmail && pendingAuthEmail);
  elements.otpField.hidden = !hasPendingOtp;
  elements.otpVerifyButton.hidden = !hasPendingOtp;
  elements.authSubmitButton.textContent = hasPendingOtp ? '重新寄送驗證碼' : '寄送驗證碼';
  elements.authEmail.value = pendingAuthEmail ?? elements.authEmail.value;
  elements.authEmail.disabled = hasPendingOtp;
  elements.authOtp.required = hasPendingOtp;
  elements.authCopy.textContent = hasPendingOtp
    ? `驗證碼已寄到 ${pendingAuthEmail}。請輸入信中的驗證碼完成登入。`
    : '使用管理員 email 驗證登入後，才可進入治理設定頁。';
};

const resetAdminView = () => {
  adminProviderState = null;
  elements.adminProviderSelect.replaceChildren();
  elements.adminSummaryProviderSelect.replaceChildren();
  elements.adminAuditList.innerHTML = '<p class="admin-provider-status">尚無治理異動紀錄。</p>';
  elements.adminUsageReportSummary.textContent = '尚無 cloud usage 資料。';
  elements.adminUsageReportList.innerHTML = '<p class="admin-provider-status">尚無 cloud usage 資料。</p>';
  elements.adminContent.hidden = true;
};

const renderAuditEntries = (entries = []) => {
  if (!entries.length) {
    elements.adminAuditList.innerHTML = '<p class="admin-provider-status">尚無治理異動紀錄。</p>';
    return;
  }

  elements.adminAuditList.replaceChildren(
    ...getAuditEntryViewModels(entries, formatJobTimestamp).map((entry) => {
      const node = document.createElement('article');
      node.className = 'admin-audit-entry';
      node.innerHTML = `
        <strong>${entry.action}</strong>
        <span>${entry.target}</span>
        <small>${entry.timestampText}</small>
      `;
      return node;
    })
  );
};

const renderUsageReport = (payload) => {
  if (!payload?.rows?.length) {
    elements.adminUsageReportSummary.textContent = '尚無 cloud usage 資料。';
    elements.adminUsageReportList.innerHTML = '<p class="admin-provider-status">尚無 cloud usage 資料。</p>';
    return;
  }

  elements.adminUsageReportSummary.textContent = `${payload.quotaDayKey} / 已用 ${formatUsd(payload.totals.consumedUsd)} / 保留 ${formatUsd(payload.totals.reservedUsd)}`;
  elements.adminUsageReportList.replaceChildren(
    ...getUsageReportRowViewModels(payload.rows).map((row) => {
      const node = document.createElement('article');
      node.className = 'admin-audit-entry';
      node.innerHTML = `
        <strong>${row.identityLabel}</strong>
        <span>${row.submitterId}</span>
        <small>已用 ${row.consumedLabel} / 保留 ${row.reservedLabel} / 剩餘 ${row.remainingLabel} / 總額 ${row.dailyQuotaLabel} / ${row.entryCountLabel}</small>
      `;
      return node;
    })
  );
};

const updateAdminProviderStatus = () => {
  const viewModel = getAdminGovernanceViewModel({
    state: adminProviderState,
    selectedTranscriptionProvider: elements.adminProviderSelect.value,
    selectedSummaryProvider: elements.adminSummaryProviderSelect.value,
    transcriptionModelInput: elements.adminTranscriptionModelInput.value,
    summaryModelInput: elements.adminSummaryModelInput.value,
    pricingVersionInput: elements.adminPricingVersionInput.value,
    overrideSubmitterId: elements.adminOverrideSubmitterId.value,
    overrideQuotaInput: elements.adminOverrideQuotaInput.value
  });

  elements.adminProviderCurrent.textContent = viewModel.currentLabel;
  elements.adminProviderCopy.textContent = viewModel.copyText;
  elements.adminProviderStatus.textContent = viewModel.providerStatusText;
  elements.adminSummaryModelStatus.textContent = viewModel.overrideStatusText;
  elements.adminProviderStatusPill.textContent = viewModel.pillText;
  elements.adminProviderStatusPill.className = `provider-pill ${viewModel.pillTone}`;
  elements.adminProviderSubmit.disabled = viewModel.submitDisabled;
  elements.adminOverrideSubmit.disabled = viewModel.overrideDisabled;
  elements.adminSummaryModelInput.disabled = viewModel.summaryModelInputDisabled;
  elements.adminSummaryModelInput.placeholder = viewModel.summaryModelInputDisabled
    ? '地端 Codex 不需要輸入模型'
    : '例如 gpt-5.4-nano';
};

const renderAdminPanel = (payload, overrides = [], auditEntries = [], usageReport = null) => {
  adminProviderState = {
    ...payload,
    overrides,
    auditEntries,
    usageReport
  };
  elements.sessionEmail.textContent = currentOperatorEmail || '-';
  elements.adminProviderSelect.replaceChildren(
    ...payload.transcriptionOptions.map((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.ready
        ? formatProviderLabel(option.value)
        : `${formatProviderLabel(option.value)}（未就緒）`;
      node.disabled = !option.ready;
      node.selected = option.value === payload.transcriptionProvider;
      return node;
    })
  );
  elements.adminSummaryProviderSelect.replaceChildren(
    ...payload.summaryOptions.map((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.ready
        ? formatSummaryModeLabel(option.value)
        : `${formatSummaryModeLabel(option.value)}（未就緒）`;
      node.disabled = !option.ready;
      node.selected = option.value === payload.summaryProvider;
      return node;
    })
  );
  elements.adminTranscriptionModelInput.value = payload.transcriptionModel ?? '';
  elements.adminSummaryModelInput.value = payload.summaryModel ?? '';
  elements.adminPricingVersionInput.value = payload.pricingVersion ?? 'v1';
  elements.adminDefaultQuotaInput.value = payload.defaultDailyCloudQuotaUsd ?? 0;
  elements.adminLiveMeetingCapInput.value = payload.liveMeetingReservationCapUsd ?? 0;
  elements.adminLocalTranscriptionInput.value = payload.concurrencyPools?.localTranscription ?? 1;
  elements.adminCloudTranscriptionInput.value = payload.concurrencyPools?.cloudTranscription ?? 1;
  elements.adminLocalSummaryInput.value = payload.concurrencyPools?.localSummary ?? 1;
  elements.adminCloudSummaryInput.value = payload.concurrencyPools?.cloudSummary ?? 1;
  renderAuditEntries(auditEntries);
  renderUsageReport(usageReport);
  elements.adminContent.hidden = false;
  elements.adminDeniedPanel.hidden = true;
  updateAdminProviderStatus();
};

const fetchAdminPanel = async () => {
  const [policyResponse, overridesResponse, auditResponse, usageReportResponse] = await Promise.all([
    apiFetch('/api/admin/ai-policy'),
    apiFetch('/api/admin/cloud-quota/overrides'),
    apiFetch('/api/admin/audit-log'),
    apiFetch('/api/admin/cloud-usage/report')
  ]);

  if (policyResponse.status === 401) {
    resetAdminView();
    elements.authPanel.hidden = false;
    return;
  }

  if (policyResponse.status === 403) {
    resetAdminView();
    elements.authPanel.hidden = true;
    elements.adminDeniedPanel.hidden = false;
    return;
  }

  if (!policyResponse.ok || !overridesResponse.ok || !auditResponse.ok || !usageReportResponse.ok) {
    throw new Error('Failed to fetch admin governance settings.');
  }

  const policy = await policyResponse.json();
  const overridesPayload = await overridesResponse.json();
  const auditPayload = await auditResponse.json();
  const usageReportPayload = await usageReportResponse.json();

  elements.authPanel.hidden = true;
  renderAdminPanel(
    policy,
    overridesPayload.overrides || [],
    auditPayload.entries || [],
    usageReportPayload
  );
};

const setAuthenticatedView = (user) => {
  currentOperatorEmail = user?.email ?? null;
  pendingAuthEmail = user ? null : authClient.getPendingEmail();
  syncOtpUi();

  if (!user) {
    resetAdminView();
    elements.adminDeniedPanel.hidden = true;
  }
};

const initializeAuth = async () => {
  authClient = await createOperatorAuthClient();
  authEnabled = authClient.enabled;
  pendingAuthEmail = authClient.getPendingEmail();
  unsubscribeAuthState();
  unsubscribeAuthState = authClient.onAuthStateChange(async (user) => {
    setAuthenticatedView(user);

    if (user) {
      await fetchAdminPanel().catch((error) => {
        setBanner(error instanceof Error ? error.message : String(error));
      });
    }
  });

  const user = await authClient.getCurrentUser();
  setAuthenticatedView(user);
};

elements.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    elements.authSubmitButton.disabled = true;
    const email = elements.authEmail.value.trim();
    setBanner('正在寄送驗證碼...');
    await authClient.requestEmailOtp(email);
    pendingAuthEmail = email;
    syncOtpUi();
    setBanner(`驗證碼已寄到 ${email}。`);
  } finally {
    elements.authSubmitButton.disabled = false;
  }
});

elements.otpVerifyButton.addEventListener('click', async () => {
  try {
    elements.otpVerifyButton.disabled = true;
    const user = await authClient.verifyEmailOtp(elements.authOtp.value.trim());
    setAuthenticatedView(user);
    elements.authOtp.value = '';
    await fetchAdminPanel();
  } finally {
    elements.otpVerifyButton.disabled = false;
  }
});

[
  elements.adminProviderSelect,
  elements.adminSummaryProviderSelect,
  elements.adminTranscriptionModelInput,
  elements.adminSummaryModelInput,
  elements.adminPricingVersionInput,
  elements.adminDefaultQuotaInput,
  elements.adminLiveMeetingCapInput,
  elements.adminLocalTranscriptionInput,
  elements.adminCloudTranscriptionInput,
  elements.adminLocalSummaryInput,
  elements.adminCloudSummaryInput,
  elements.adminOverrideSubmitterId,
  elements.adminOverrideQuotaInput
].forEach((element) => {
  element?.addEventListener('input', () => updateAdminProviderStatus());
  element?.addEventListener('change', () => updateAdminProviderStatus());
});

elements.adminProviderForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!adminProviderState) {
    return;
  }

  const response = await apiFetch('/api/admin/ai-policy', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      transcriptionProvider: elements.adminProviderSelect.value,
      transcriptionModel: elements.adminTranscriptionModelInput.value.trim(),
      summaryProvider: elements.adminSummaryProviderSelect.value,
      summaryModel:
        elements.adminSummaryProviderSelect.value === 'local-codex'
          ? adminProviderState.summaryModel || 'gpt-5-mini'
          : elements.adminSummaryModelInput.value.trim(),
      pricingVersion: elements.adminPricingVersionInput.value.trim(),
      defaultDailyCloudQuotaUsd: Number(elements.adminDefaultQuotaInput.value),
      liveMeetingReservationCapUsd: Number(elements.adminLiveMeetingCapInput.value),
      concurrencyPools: {
        localTranscription: Number(elements.adminLocalTranscriptionInput.value),
        cloudTranscription: Number(elements.adminCloudTranscriptionInput.value),
        localSummary: Number(elements.adminLocalSummaryInput.value),
        cloudSummary: Number(elements.adminCloudSummaryInput.value)
      }
    })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `AI policy update failed: ${response.status}`);
  }

  await fetchAdminPanel();
});

elements.adminOverrideForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!adminProviderState) {
    return;
  }

  const response = await apiFetch('/api/admin/cloud-quota/overrides', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      submitterId: elements.adminOverrideSubmitterId.value.trim(),
      dailyQuotaUsd: Number(elements.adminOverrideQuotaInput.value)
    })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Quota override update failed: ${response.status}`);
  }

  await fetchAdminPanel();
});

elements.signOutButton.addEventListener('click', async () => {
  await authClient.signOut();
});

const boot = async () => {
  try {
    await initializeAuth();

    if (currentOperatorEmail) {
      await fetchAdminPanel();
      return;
    }

    elements.authPanel.hidden = false;
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error));
  }
};

boot();
