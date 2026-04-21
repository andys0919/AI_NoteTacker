import { createOperatorAuthClient } from '/auth-client.js';
import { getAuthEntryViewModel } from '/auth-entry.js';
import {
  formatJobTimestamp,
  getEmptyStateMessage,
  getHistoryStageLabel,
  getJobCardViewModel,
  renderOptionalMarkup
} from '/dashboard-copy.js';
import { getDashboardPrefill } from '/dashboard-query.js';
import {
  filterJobsByQuickFilter,
  getJobActionSet
} from '/dashboard-workflows.js';
import {
  formatProviderLabel,
  formatSummaryModeLabel,
  formatUsd,
  getAdminGovernanceViewModel,
  getAuditEntryViewModels,
  getQuotaDisplayModel,
  getUsageReportRowViewModels
} from '/governance-panel.js';

const DEFAULT_OPERATOR_ID_KEY = 'solomon-notetaker-operator-id';
const elements = {
  adminAuditList: document.querySelector('#admin-audit-list'),
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
  dashboardGrid: document.querySelector('.dashboard-grid'),
  otpField: document.querySelector('#otp-field'),
  otpVerifyButton: document.querySelector('#otp-verify-button'),
  quotaCard: document.querySelector('#quota-card'),
  quotaRemaining: document.querySelector('#quota-remaining'),
  quotaBreakdown: document.querySelector('#quota-breakdown'),
  sessionCard: document.querySelector('#session-card'),
  sessionEmail: document.querySelector('#session-email'),
  signInButton: document.querySelector('#sign-in-button'),
  signInCard: document.querySelector('#sign-in-card'),
  signInHint: document.querySelector('#sign-in-hint'),
  signOutButton: document.querySelector('#sign-out-button'),
  submitterId: document.querySelector('#submitter-id'),
  submitterIdLabel: document.querySelector('#submitter-id-label'),
  defaultJoinName: document.querySelector('#default-join-name'),
  joinName: document.querySelector('#join-name'),
  meetingForm: document.querySelector('#meeting-form'),
  uploadForm: document.querySelector('#upload-form'),
  audioFile: document.querySelector('#audio-file'),
  uploadSubtitle: document.querySelector('#upload-subtitle'),
  uploadTitle: document.querySelector('#upload-title'),
  jobList: document.querySelector('#job-list'),
  statusBanner: document.querySelector('#status-banner'),
  activeCount: document.querySelector('#active-count'),
  queuedCount: document.querySelector('#queued-count'),
  completedCount: document.querySelector('#completed-count'),
  clearHistoryButton: document.querySelector('#clear-history-button'),
  archiveSearch: document.querySelector('#archive-search'),
  jobFilters: document.querySelector('#job-filters')
};

const activeStates = new Set(['joining', 'recording', 'transcribing']);
const terminalStates = new Set(['completed', 'failed']);

const createAnonymousOperatorId = () => {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `operator-${window.crypto.randomUUID()}`;
  }

  const randomPart = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `operator-${randomPart}`;
};

const getOrCreateSubmitterId = () => {
  const existing = window.localStorage.getItem(DEFAULT_OPERATOR_ID_KEY);
  if (existing) return existing;

  const created = createAnonymousOperatorId();
  window.localStorage.setItem(DEFAULT_OPERATOR_ID_KEY, created);
  return created;
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
let currentSubmitterId = getOrCreateSubmitterId();
let pendingAuthEmail = null;
let unsubscribeAuthState = () => {};
let uploadInFlight = false;
let adminProviderState = null;
let operatorConfig = {
  defaultJoinName: 'Solomon - NoteTaker',
  submissionTemplates: []
};
let selectedTemplateId = 'general';
let currentQuickFilter = 'all';
let pendingSharedJobId = '';
let currentJobs = [];
let currentJobStats = null;
let currentJobsPageInfo = {
  pageSize: 25,
  hasMore: false,
  nextCursor: null
};

const updateIdentityDisplay = () => {
  const authEntryViewModel = getAuthEntryViewModel({
    authEnabled,
    currentOperatorEmail,
    pendingAuthEmail
  });

  elements.submitterId.textContent = authEnabled
    ? currentOperatorEmail || '待登入'
    : '訪客模式';
  elements.submitterId.title = authEnabled ? currentOperatorEmail || '' : currentSubmitterId;
  elements.submitterIdLabel.textContent = authEnabled ? '目前身分' : '使用模式';
  elements.signInCard.hidden = authEntryViewModel.hidden;
  elements.signInButton.disabled = authEntryViewModel.disabled;
  elements.signInButton.textContent = authEntryViewModel.buttonText;
  elements.signInHint.textContent = authEntryViewModel.hintText;
  elements.sessionCard.hidden = !authEnabled || !currentOperatorEmail;
  elements.sessionEmail.textContent = currentOperatorEmail || '-';
};

const applyDefaultJoinNameToForm = () => {
  elements.defaultJoinName.textContent = operatorConfig.defaultJoinName;
  elements.joinName.value = operatorConfig.defaultJoinName;
};

const setQuickFilter = (filterId) => {
  currentQuickFilter = filterId;
  elements.jobFilters
    ?.querySelectorAll('[data-filter]')
    .forEach((button) => button.classList.toggle('active', button.dataset.filter === filterId));
};

const focusSharedJobIfNeeded = () => {
  if (!pendingSharedJobId) {
    return;
  }

  const card = elements.jobList.querySelector(`[data-job-id="${pendingSharedJobId}"]`);

  if (!card) {
    return;
  }

  card.classList.add('job-card-highlight');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    card.classList.remove('job-card-highlight');
  }, 2200);
  pendingSharedJobId = '';
};

const setAuthMode = (enabled) => {
  authEnabled = enabled;
  elements.authPanel.hidden = !enabled;
};

const syncOtpUi = () => {
  const hasPendingOtp = Boolean(authEnabled && !currentOperatorEmail && pendingAuthEmail);
  elements.otpField.hidden = !hasPendingOtp;
  elements.otpVerifyButton.hidden = !hasPendingOtp;
  elements.authSubmitButton.textContent = hasPendingOtp ? '重新寄送驗證碼' : '寄送驗證碼';
  elements.authSubmitButton.formNoValidate = hasPendingOtp;
  elements.authEmail.value = pendingAuthEmail ?? elements.authEmail.value;
  elements.authEmail.disabled = hasPendingOtp;
  elements.authOtp.required = hasPendingOtp;
  elements.authCopy.textContent = hasPendingOtp
    ? `驗證碼已寄到 ${pendingAuthEmail}。請輸入信中的驗證碼完成登入。`
    : '輸入公司 email 後，系統會寄出一次性驗證碼。驗證完成後，瀏覽器會記住你的登入狀態。';
  updateIdentityDisplay();
};

const collectFormElements = (root, selector) => (root ? [...root.querySelectorAll(selector)] : []);

const setDashboardInteractionEnabled = (enabled) => {
  const interactiveElements = [
    ...collectFormElements(elements.adminProviderForm, 'select, input, button'),
    ...collectFormElements(elements.adminOverrideForm, 'input, button'),
    ...elements.meetingForm.querySelectorAll('input, button'),
    ...elements.uploadForm.querySelectorAll('input, button'),
    elements.clearHistoryButton,
    elements.archiveSearch,
    ...elements.jobFilters.querySelectorAll('button')
  ];

  interactiveElements.forEach((element) => {
    if (element) {
      element.disabled = !enabled;
    }
  });
};

const setAdminPanelVisible = (visible) => {
  if (!elements.adminProviderPanel) {
    return;
  }

  elements.adminProviderPanel.hidden = !visible;
};

const setQuotaVisible = (visible) => {
  elements.quotaCard.hidden = !visible;
};

const resetAdminProviderPanel = () => {
  if (!elements.adminProviderPanel) {
    return;
  }

  adminProviderState = null;
  elements.adminProviderSelect.replaceChildren();
  elements.adminSummaryProviderSelect.replaceChildren();
  elements.adminProviderCurrent.textContent = '目前不可用';
  elements.adminProviderCopy.textContent = '管理員治理設定目前不可用。';
  elements.adminProviderStatus.textContent = '';
  elements.adminTranscriptionModelInput.value = '';
  elements.adminSummaryModelInput.value = '';
  elements.adminPricingVersionInput.value = '';
  elements.adminDefaultQuotaInput.value = '';
  elements.adminLiveMeetingCapInput.value = '';
  elements.adminLocalTranscriptionInput.value = '';
  elements.adminCloudTranscriptionInput.value = '';
  elements.adminLocalSummaryInput.value = '';
  elements.adminCloudSummaryInput.value = '';
  elements.adminOverrideSubmitterId.value = '';
  elements.adminOverrideQuotaInput.value = '';
  elements.adminSummaryModelStatus.textContent = '';
  elements.adminAuditList.innerHTML = '<p class="admin-provider-status">尚無治理異動紀錄。</p>';
  elements.adminUsageReportSummary.textContent = '尚無 cloud usage 資料。';
  elements.adminUsageReportList.innerHTML = '<p class="admin-provider-status">尚無 cloud usage 資料。</p>';
  elements.adminProviderStatusPill.textContent = '隱藏';
  elements.adminProviderStatusPill.className = 'provider-pill blocked';
  elements.adminProviderSubmit.disabled = true;
  elements.adminOverrideSubmit.disabled = true;
  setAdminPanelVisible(false);
};

const updateAdminProviderStatus = () => {
  if (!elements.adminProviderPanel) {
    return;
  }

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

const renderAuditEntries = (entries = []) => {
  if (!elements.adminAuditList) {
    return;
  }

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
  if (!elements.adminUsageReportList || !elements.adminUsageReportSummary) {
    return;
  }

  if (!payload?.rows?.length) {
    elements.adminUsageReportSummary.textContent = '尚無 cloud usage 資料。';
    elements.adminUsageReportList.innerHTML = '<p class="admin-provider-status">尚無 cloud usage 資料。</p>';
    return;
  }

  elements.adminUsageReportSummary.textContent = `日期 ${payload.quotaDayKey} / 使用者 ${payload.totals.operatorCount} / 已用 ${formatUsd(payload.totals.consumedUsd)} / 保留 ${formatUsd(payload.totals.reservedUsd)}`;
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

const renderAdminProviderPanel = (payload, overrides = [], auditEntries = [], usageReport = null) => {
  if (!elements.adminProviderPanel) {
    return;
  }

  adminProviderState = {
    ...payload,
    overrides,
    auditEntries,
    usageReport
  };
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
  setAdminPanelVisible(true);
  updateAdminProviderStatus();
};

const renderOperatorQuota = (payload) => {
  const viewModel = getQuotaDisplayModel(payload);
  setQuotaVisible(!viewModel.hidden);
  elements.quotaRemaining.textContent = viewModel.remainingLabel;
  elements.quotaBreakdown.textContent = viewModel.breakdownText;
};

const setAuthenticatedView = (user) => {
  currentOperatorEmail = user?.email ?? null;
  currentSubmitterId = user?.id ?? getOrCreateSubmitterId();
  pendingAuthEmail = user ? null : authClient.getPendingEmail();
  elements.dashboardGrid.hidden = authEnabled && !user;
  elements.authPanel.hidden = !authEnabled || Boolean(user);
  setDashboardInteractionEnabled(!authEnabled || Boolean(user));
  syncOtpUi();
  updateIdentityDisplay();

  if (!user) {
    resetAdminProviderPanel();
    renderOperatorQuota(null);
  }
};

const apiFetch = async (input, init) => authClient.authorizedFetch(input, init);

const setBanner = (message, kind = 'info') => {
  if (!message) {
    elements.statusBanner.hidden = true;
    elements.statusBanner.textContent = '';
    elements.statusBanner.className = 'status-banner';
    return;
  }

  elements.statusBanner.hidden = false;
  elements.statusBanner.textContent = message;
  elements.statusBanner.className = `status-banner ${kind}`;
};

const resetUploadSelectionUi = () => {
  elements.uploadTitle.textContent = '拖曳檔案到這裡，或點擊選擇';
  elements.uploadSubtitle.textContent = '送出後會自動產生逐字稿與摘要。';
};

const formatFileSize = (bytes) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const showSelectedUploadFile = (file) => {
  elements.uploadTitle.textContent = file.name;
  elements.uploadSubtitle.textContent = `已選擇 ${formatFileSize(file.size)}，按下「上傳並開始整理」後就會開始處理。`;
};

const statusClass = (value) => value.toLowerCase();
const isTerminalJob = (job) => terminalStates.has(job.state);

const formatDuration = (milliseconds) => {
  if (typeof milliseconds !== 'number' || milliseconds < 0) {
    return null;
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const deleteJob = async (jobId) => {
  const response = await apiFetch(`/api/operator/jobs/${jobId}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ submitterId: currentSubmitterId })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Delete failed: ${response.status}`);
  }
};

const clearHistory = async () => {
  const response = await apiFetch('/api/operator/jobs/clear-history', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ submitterId: currentSubmitterId })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Clear history failed: ${response.status}`);
  }

  return payload.deletedCount ?? 0;
};

const interruptJob = async (jobId) => {
  const response = await apiFetch(`/api/operator/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ submitterId: currentSubmitterId })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Interrupt failed: ${response.status}`);
  }

  return payload;
};

const extractDownloadFilename = (response, fallback) => {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/i);
  return match?.[1] || fallback;
};

const downloadJobExport = async (jobId, format) => {
  const url = new URL(`/api/operator/jobs/${jobId}/export`, window.location.origin);
  url.searchParams.set('format', format);

  if (!authEnabled) {
    url.searchParams.set('submitterId', currentSubmitterId);
  }

  const response = await apiFetch(url);

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message ?? `Export failed: ${response.status}`);
  }

  const blob = await response.blob();
  const fallbackName = `${jobId}.${format === 'markdown' ? 'md' : format}`;
  const downloadName = extractDownloadFilename(response, fallbackName);
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = downloadName;
  document.body.append(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
};

const createActionBlock = (job, runtimeState) => {
  const actionSet = getJobActionSet(job, runtimeState);
  const actions = actionSet.map((action) => {
    if (action === 'stop-current') {
      return '<button class="mini-button danger" type="button" data-action="stop-current">離開會議</button>';
    }

    if (action === 'interrupt-job') {
      return '<button class="mini-button danger" type="button" data-action="interrupt-job">停止處理</button>';
    }

    if (action === 'delete-history') {
      return '<button class="mini-button history" type="button" data-action="delete-history">刪除紀錄</button>';
    }

    if (action === 'view-details') {
      return '<button class="mini-button export" type="button" data-action="view-details">查看內容</button>';
    }

    return '<button class="mini-button export" type="button" data-action="export-markdown">下載 MD</button>';
  });

  if (actions.length === 0) {
    return '';
  }

  return `<div class="job-actions">${actions.join('')}</div>`;
};

const createJobCard = (job) => {
  const card = document.createElement('article');
  card.className = 'job-card';
  card.dataset.jobId = job.id;
  card.id = `job-${job.id}`;

  const viewModel = getJobCardViewModel(job);
  const activeBadge = statusClass(viewModel.badgeTone);
  const progressDuration =
    typeof viewModel.progressProcessedMs === 'number' && typeof viewModel.progressTotalMs === 'number'
      ? `${formatDuration(viewModel.progressProcessedMs)} / ${formatDuration(viewModel.progressTotalMs)}`
      : '';
  const summaryBlock = job.summaryArtifact || job.summaryPreview
    ? `
      <details open>
        <summary>AI 摘要${job.summaryArtifact ? '' : '（預覽）'}</summary>
        <pre class="summary-text">${job.summaryArtifact?.text ?? job.summaryPreview}</pre>
        ${
          job.summaryArtifact?.structured
            ? `
              <div class="structured-summary">
                ${[
                  ['待辦事項', job.summaryArtifact.structured.actionItems],
                  ['決策重點', job.summaryArtifact.structured.decisions],
                  ['風險提醒', job.summaryArtifact.structured.risks],
                  ['待確認問題', job.summaryArtifact.structured.openQuestions]
                ]
                  .map(
                    ([title, items]) => `
                      <div class="structured-section">
                        <h4>${title}</h4>
                        ${
                          items.length
                            ? `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`
                            : '<p>目前沒有。</p>'
                        }
                      </div>
                    `
                  )
                  .join('')}
              </div>
            `
            : ''
        }
      </details>
    `
    : '';

  const transcriptPreview = job.transcriptArtifact || job.transcriptPreview
    ? `
      <details>
        <summary>逐字稿${job.transcriptArtifact ? '' : '（預覽）'}</summary>
        <pre class="transcript-preview">${job.transcriptArtifact
          ? job.transcriptArtifact.segments.map((segment) => segment.text).join('\n')
          : job.transcriptPreview}</pre>
      </details>
    `
    : '';

  const progressBlock =
    viewModel.showProgress &&
    `
      <div class="artifact-block progress-block">
        <div class="artifact-heading">
          <h3>目前進度</h3>
          <p>${viewModel.statusSummary}</p>
        </div>
        <div class="progress-shell">
          <div class="progress-meta">
            <span>${viewModel.progressLabel}</span>
            <strong>${viewModel.progressPercent}%</strong>
          </div>
          ${progressDuration ? `<p class="progress-duration">${progressDuration}</p>` : ''}
          <div class="progress-bar ${viewModel.progressTone}">
            <span style="width: ${viewModel.progressPercent}%"></span>
          </div>
        </div>
      </div>
    `;

  const failureBlock =
    job.failureMessage &&
    `
      <div class="artifact-block failure-block">
        <div class="artifact-heading">
          <h3>需要處理</h3>
          <p>${viewModel.statusSummary}</p>
        </div>
        ${job.failureCode ? `<p class="artifact-note">錯誤代碼：${job.failureCode}</p>` : ''}
      </div>
    `;

  const actionBlock = createActionBlock(job, viewModel.badgeTone);

  card.innerHTML = `
    <div class="job-head">
      <div>
        <p class="job-kicker">${viewModel.sourceLabel}</p>
        <h3 class="job-title">${viewModel.title}</h3>
        <p class="job-status-summary">${viewModel.statusSummary}</p>
      </div>
      <span class="badge ${activeBadge}">${viewModel.badgeLabel}</span>
    </div>
    <div class="job-meta-grid">
      <div class="job-meta-item">
        <span>${viewModel.sourceLabel}</span>
        <strong>${viewModel.sourceValue}</strong>
      </div>
      ${
        viewModel.joinNameLabel
          ? `
            <div class="job-meta-item">
              <span>${viewModel.joinNameLabel}</span>
              <strong>${viewModel.joinNameValue}</strong>
            </div>
          `
          : ''
      }
      <div class="job-meta-item">
        <span>${viewModel.createdLabel}</span>
        <strong>${viewModel.createdAtText}</strong>
      </div>
      <div class="job-meta-item">
        <span>${viewModel.updatedLabel}</span>
        <strong>${viewModel.updatedAtText}</strong>
      </div>
      ${
        viewModel.durationLabel
          ? `
            <div class="job-meta-item">
              <span>${viewModel.durationLabel}</span>
              <strong>${viewModel.durationValue}</strong>
            </div>
          `
          : ''
      }
      ${
        viewModel.transcriptionCostLabel
          ? `
            <div class="job-meta-item">
              <span>${viewModel.transcriptionCostLabel}</span>
              <strong>${viewModel.transcriptionCostValue}</strong>
            </div>
          `
          : ''
      }
      ${
        viewModel.summaryCostLabel
          ? `
            <div class="job-meta-item">
              <span>${viewModel.summaryCostLabel}</span>
              <strong>${viewModel.summaryCostValue}</strong>
            </div>
          `
          : ''
      }
      ${
        viewModel.totalCostLabel
          ? `
            <div class="job-meta-item">
              <span>${viewModel.totalCostLabel}</span>
              <strong>${viewModel.totalCostValue}</strong>
            </div>
          `
          : ''
      }
    </div>
    ${actionBlock}
    ${renderOptionalMarkup(failureBlock)}
    ${renderOptionalMarkup(progressBlock)}
    ${summaryBlock}
    ${transcriptPreview}
  `;

  const stopButton = card.querySelector('[data-action="stop-current"]');
  if (stopButton) {
    stopButton.addEventListener('click', async () => {
      try {
        setBanner('正在停止目前會議...');
        const response = await apiFetch('/api/operator/stop-current', {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({ submitterId: currentSubmitterId })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? `Stop failed: ${response.status}`);
        }
        setBanner('目前會議已停止。');
        await fetchJobs();
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }

  const deleteButton = card.querySelector('[data-action="delete-history"]');
  if (deleteButton) {
    deleteButton.addEventListener('click', async () => {
      const confirmed = window.confirm('要從歷史紀錄中刪除這筆工作嗎？');
      if (!confirmed) {
        return;
      }

      try {
        setBanner('正在刪除紀錄...');
        await deleteJob(job.id);
        setBanner('紀錄已刪除。');
        await fetchJobs();
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }

  const interruptButton = card.querySelector('[data-action="interrupt-job"]');
  if (interruptButton) {
    interruptButton.addEventListener('click', async () => {
      const confirmed = window.confirm('要立即停止這筆工作嗎？');
      if (!confirmed) {
        return;
      }

      try {
        setBanner('正在停止工作...');
        await interruptJob(job.id);
        setBanner('工作已停止。');
        await fetchJobs();
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }

  const detailsButton = card.querySelector('[data-action="view-details"]');
  if (detailsButton) {
    detailsButton.addEventListener('click', async () => {
      try {
        setBanner('正在載入完整內容...');
        await fetchJobDetails(job.id);
        setBanner('');
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }

  const exportFormats = {
    'export-markdown': 'markdown'
  };

  Object.entries(exportFormats).forEach(([action, format]) => {
    const button = card.querySelector(`[data-action="${action}"]`);

    if (!button) {
      return;
    }

    button.addEventListener('click', async () => {
      try {
        setBanner(`正在準備 ${format.toUpperCase()} 匯出檔...`);
        await downloadJobExport(job.id, format);
        setBanner('');
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  });

  return card;
};

const renderJobs = (jobs) => {
  currentJobs = jobs;
  const activeCount = currentJobStats?.activeCount ?? jobs.filter((job) => activeStates.has(job.state)).length;
  const queuedCount = currentJobStats?.queuedCount ?? jobs.filter((job) => job.state === 'queued').length;
  const completedCount = currentJobStats?.completedCount ?? jobs.filter((job) => job.state === 'completed').length;
  const terminalCount =
    currentJobStats
      ? (currentJobStats.completedCount || 0) + (currentJobStats.failedCount || 0)
      : jobs.filter((job) => isTerminalJob(job)).length;
  const activeSearch = elements.archiveSearch?.value.trim() ?? '';
  let visibleJobs = filterJobsByQuickFilter(jobs, currentQuickFilter);

  if (
    pendingSharedJobId &&
    jobs.some((job) => job.id === pendingSharedJobId) &&
    !visibleJobs.some((job) => job.id === pendingSharedJobId)
  ) {
    setQuickFilter('all');
    visibleJobs = filterJobsByQuickFilter(jobs, currentQuickFilter);
  }

  elements.activeCount.textContent = String(activeCount);
  elements.queuedCount.textContent = String(queuedCount);
  elements.completedCount.textContent = String(completedCount);
  elements.clearHistoryButton.disabled = terminalCount === 0;

  if (visibleJobs.length === 0) {
    elements.jobList.innerHTML = `
      <div class="empty-state">
        <p>${
          activeSearch || currentQuickFilter === 'all'
            ? getEmptyStateMessage(activeSearch)
            : '目前沒有符合這個篩選條件的工作。'
        }</p>
      </div>
    `;
    return;
  }

  const nodes = visibleJobs.map(createJobCard);

  if (currentJobsPageInfo.hasMore && !activeSearch) {
    const loadMore = document.createElement('div');
    loadMore.className = 'empty-state';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-button export';
    button.textContent = '載入更多';
    button.addEventListener('click', async () => {
      try {
        button.disabled = true;
        setBanner('正在載入更多紀錄...');
        await fetchJobs({ append: true });
        setBanner('');
      } catch (error) {
        button.disabled = false;
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
    loadMore.append(button);
    nodes.push(loadMore);
  }

  elements.jobList.replaceChildren(...nodes);
  focusSharedJobIfNeeded();
};

const fetchConfig = async () => {
  const response = await apiFetch('/api/operator/config');
  const payload = await response.json();
  operatorConfig = payload;
  applyDefaultJoinNameToForm();
  setDashboardInteractionEnabled(!authEnabled || Boolean(currentOperatorEmail));
};

const fetchOperatorQuota = async () => {
  if (authEnabled && !currentOperatorEmail) {
    renderOperatorQuota(null);
    return;
  }

  const url = new URL('/api/operator/quota', window.location.origin);
  url.searchParams.set('submitterId', currentSubmitterId);
  const response = await apiFetch(url);

  if (response.status === 401) {
    renderOperatorQuota(null);
    return;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch quota: ${response.status}`);
  }

  renderOperatorQuota(await response.json());
};

const fetchAdminProviderPanel = async () => {
  if (!elements.adminProviderPanel) {
    return;
  }

  if (!authEnabled || !currentOperatorEmail) {
    resetAdminProviderPanel();
    return;
  }

  const [policyResponse, overridesResponse, auditResponse, usageReportResponse] = await Promise.all([
    apiFetch('/api/admin/ai-policy'),
    apiFetch('/api/admin/cloud-quota/overrides'),
    apiFetch('/api/admin/audit-log'),
    apiFetch('/api/admin/cloud-usage/report')
  ]);

  if (policyResponse.status === 401 || policyResponse.status === 403) {
    resetAdminProviderPanel();
    return;
  }

  if (!policyResponse.ok || !overridesResponse.ok || !auditResponse.ok || !usageReportResponse.ok) {
    throw new Error('Failed to fetch admin governance settings.');
  }

  const policy = await policyResponse.json();
  const overridesPayload = await overridesResponse.json();
  const auditPayload = await auditResponse.json();
  const usageReportPayload = await usageReportResponse.json();
  renderAdminProviderPanel(
    policy,
    overridesPayload.overrides || [],
    auditPayload.entries || [],
    usageReportPayload
  );
};

const mergeJobsById = (existingJobs, incomingJobs) => {
  const nextById = new Map(existingJobs.map((job) => [job.id, job]));
  incomingJobs.forEach((job) => {
    nextById.set(job.id, job);
  });

  return [...nextById.values()].sort((left, right) => {
    if (left.createdAt === right.createdAt) {
      return right.id.localeCompare(left.id);
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
};

const fetchJobs = async ({ append = false } = {}) => {
  if (authEnabled && !currentOperatorEmail) {
    currentJobStats = null;
    currentJobsPageInfo = {
      pageSize: 25,
      hasMore: false,
      nextCursor: null
    };
    renderJobs([]);
    return;
  }

  const url = new URL('/api/operator/jobs', window.location.origin);
  url.searchParams.set('submitterId', currentSubmitterId);
  const searchQuery = elements.archiveSearch?.value.trim();

  if (searchQuery) {
    url.searchParams.set('q', searchQuery);
  } else {
    url.searchParams.set('pageSize', String(currentJobsPageInfo.pageSize || 25));
    if (append && currentJobsPageInfo.nextCursor) {
      url.searchParams.set('cursor', currentJobsPageInfo.nextCursor);
    }
  }

  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch jobs: ${response.status}`);
  }

  const payload = await response.json();
  currentJobStats = payload.stats || null;
  currentJobsPageInfo = payload.pageInfo
    ? {
        pageSize: payload.pageInfo.pageSize || 25,
        hasMore: Boolean(payload.pageInfo.hasMore),
        nextCursor: payload.pageInfo.nextCursor || null
      }
    : {
        pageSize: 25,
        hasMore: false,
        nextCursor: null
      };
  currentJobs = append ? mergeJobsById(currentJobs, payload.jobs) : payload.jobs;
  renderJobs(currentJobs);
};

const fetchJobDetails = async (jobId) => {
  const url = new URL(`/api/operator/jobs/${jobId}`, window.location.origin);

  if (!authEnabled) {
    url.searchParams.set('submitterId', currentSubmitterId);
  }

  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch job details: ${response.status}`);
  }

  const payload = await response.json();
  currentJobs = currentJobs.map((job) => (job.id === jobId ? payload : job));
  renderJobs(currentJobs);
};

const submitMeetingJob = async (event) => {
  event?.preventDefault?.();
  setBanner('正在送出會議...');

  const formData = new FormData(elements.meetingForm);
  const response = await apiFetch('/api/operator/jobs/meetings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      submitterId: currentSubmitterId,
      meetingUrl: formData.get('meetingUrl'),
      requestedJoinName: formData.get('requestedJoinName'),
      submissionTemplateId: selectedTemplateId
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Meeting submission failed: ${response.status}`);
  }

  setBanner('會議已加入整理流程。');
  elements.meetingForm.reset();
  applyDefaultJoinNameToForm();
  await fetchOperatorQuota();
  await fetchJobs();
};

const applyQueryPrefill = () => {
  const prefill = getDashboardPrefill(window.location.href, elements.defaultJoinName.textContent);
  pendingSharedJobId = prefill.jobId;

  if (prefill.meetingUrl) {
    elements.meetingForm.elements.meetingUrl.value = prefill.meetingUrl;
    elements.joinName.value = prefill.requestedJoinName;
  }

  return prefill;
};

const submitUploadJob = async (event) => {
  event.preventDefault();
  if (uploadInFlight) {
    return;
  }

  if (!elements.audioFile.files?.length) {
    setBanner('請先選擇音訊或影片檔。', 'error');
    return;
  }

  uploadInFlight = true;
  setBanner('正在上傳錄音檔...');

  const formData = new FormData();
  formData.set('submitterId', currentSubmitterId);
  formData.set('audio', elements.audioFile.files[0]);
  formData.set('submissionTemplateId', selectedTemplateId);

  const response = await apiFetch('/api/operator/jobs/uploads', {
    method: 'POST',
    body: formData
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    uploadInFlight = false;
    throw new Error(payload?.error?.message ?? `Upload failed: ${response.status}`);
  }

  setBanner('錄音檔已加入整理流程。');
  elements.uploadForm.reset();
  resetUploadSelectionUi();
  uploadInFlight = false;
  await fetchOperatorQuota();
  await fetchJobs();
};

const initializeAuth = async () => {
  authClient = await createOperatorAuthClient();
  setAuthMode(authClient.enabled);
  pendingAuthEmail = authClient.getPendingEmail();
  unsubscribeAuthState();
  unsubscribeAuthState = authClient.onAuthStateChange(async (user) => {
    setAuthenticatedView(user);

    if (user) {
      await fetchAdminProviderPanel().catch((error) => {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      });
      await fetchOperatorQuota().catch((error) => {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      });
      await fetchJobs().catch((error) => {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      });
      return;
    }

    renderJobs([]);
  });

  const user = await authClient.getCurrentUser();
  setAuthenticatedView(user);
};

const boot = async () => {
  try {
    await initializeAuth();
    await fetchConfig();
    await fetchAdminProviderPanel();
    await fetchOperatorQuota();

    if (authEnabled && !currentOperatorEmail) {
      setBanner('請先完成 Email 驗證登入，再送出會議或上傳錄音。');
      return;
    }

    const prefill = applyQueryPrefill();
    if (prefill.shouldAutoQueue) {
      await submitMeetingJob();
      window.history.replaceState({}, document.title, window.location.pathname);
      setBanner('已依照網址參數自動送出會議。');
      return;
    }
    await fetchJobs();
    focusSharedJobIfNeeded();
    setBanner('');
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  }
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
    setBanner(`驗證碼已寄到 ${email}。`, 'info');
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    elements.authSubmitButton.disabled = false;
  }
});

elements.otpVerifyButton.addEventListener('click', async () => {
  try {
    elements.otpVerifyButton.disabled = true;
    setBanner('正在驗證登入...');
    const user = await authClient.verifyEmailOtp(elements.authOtp.value.trim());
    setAuthenticatedView(user);
    elements.authOtp.value = '';
    setBanner('登入完成。');
    await fetchJobs();
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    elements.otpVerifyButton.disabled = false;
  }
});

elements.signInButton.addEventListener('click', () => {
  if (!authEnabled) {
    setBanner('登入尚未啟用。請先設定 SUPABASE_URL 與 SUPABASE_PUBLISHABLE_KEY。', 'error');
    return;
  }

  if (elements.authPanel.hidden) {
    return;
  }

  elements.authPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const focusTarget = elements.otpField.hidden ? elements.authEmail : elements.authOtp;
  focusTarget?.focus();
});

elements.meetingForm.addEventListener('submit', async (event) => {
  try {
    await submitMeetingJob(event);
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  }
});

elements.signOutButton.addEventListener('click', async () => {
  try {
    await authClient.signOut();
    setBanner('已登出。');
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  }
});

elements.uploadForm.addEventListener('submit', async (event) => {
  try {
    await submitUploadJob(event);
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
    uploadInFlight = false;
  }
});

elements.adminProviderSelect?.addEventListener('change', () => {
  updateAdminProviderStatus();
});

elements.adminSummaryProviderSelect?.addEventListener('change', () => {
  updateAdminProviderStatus();
});

[
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
  element?.addEventListener('input', () => {
    updateAdminProviderStatus();
  });
});

elements.adminProviderForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!adminProviderState) {
    return;
  }

  try {
    elements.adminProviderSubmit.disabled = true;
    setBanner('正在更新治理設定...');
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

    setBanner('治理設定已更新。');
    await fetchAdminProviderPanel();
    await fetchOperatorQuota();
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    updateAdminProviderStatus();
  }
});

elements.adminOverrideForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!adminProviderState) {
    return;
  }

  try {
    elements.adminOverrideSubmit.disabled = true;
    setBanner('正在更新個人 quota override...');
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

    setBanner(`個人 quota override 已更新為 ${formatUsd(payload.dailyQuotaUsd)}。`);
    await fetchAdminProviderPanel();
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    updateAdminProviderStatus();
  }
});

elements.audioFile.addEventListener('change', async () => {
  const file = elements.audioFile.files?.[0];

  if (!file) {
    resetUploadSelectionUi();
    return;
  }

  showSelectedUploadFile(file);
  setBanner('');
});

elements.clearHistoryButton.addEventListener('click', async () => {
  if (elements.clearHistoryButton.disabled) {
    return;
  }

  const confirmed = window.confirm('要清除所有已完成與失敗的歷史紀錄嗎？');
  if (!confirmed) {
    return;
  }

  try {
    setBanner('正在清除歷史紀錄...');
    const deletedCount = await clearHistory();
    setBanner(`已清除 ${deletedCount} 筆歷史紀錄。`);
    await fetchJobs();
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  }
});

elements.archiveSearch?.addEventListener('input', () => {
  fetchJobs().catch((error) => {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  });
});

elements.jobFilters?.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest('[data-filter]');
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  setQuickFilter(button.dataset.filter || 'all');
  fetchJobs().catch((error) => {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  });
});

boot();
window.setInterval(() => {
  if (authEnabled && !currentOperatorEmail) {
    return;
  }

  fetchJobs().catch((error) => {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  });
}, 5000);
