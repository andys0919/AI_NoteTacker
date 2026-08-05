import { formatJobTimestamp } from '/dashboard-copy.js';
import {
  applyTwdPricingReference,
  formatTwdFromUsd,
  formatTwdInputFromUsd,
  getTwdPricingReferenceText,
  twdQuotaToUsd
} from '/currency-display.js';
import { escapeHtml } from '/escape-html.js';
import {
  formatProviderLabel,
  formatSummaryModeLabel,
  formatUsageStageLabel,
  getAdminGovernanceViewModel,
  getAuditEntryViewModels,
  getCloudCostDisplayModel,
  getUsageHistoryCostViewModel,
  getUsageReportRowViewModels
} from '/governance-panel.js';
import { getRuntimeHealthViewModel } from '/runtime-health-panel.js';
import {
  getReadableTranscriptText,
  sanitizeAnonymousSpeakerLabels
} from '/artifact-reader.js';

const TOKEN_STORAGE_KEY = 'solomon-notetaker-admin-token';

const elements = {
  skipLink: document.querySelector('#admin-skip-link'),
  sessionStatus: document.querySelector('#admin-session-status'),
  loginOverlay: document.querySelector('#admin-login-overlay'),
  adminShell: document.querySelector('#admin-shell'),
  loginForm: document.querySelector('#admin-login-form'),
  loginUsername: document.querySelector('#admin-login-username'),
  loginPassword: document.querySelector('#admin-login-password'),
  loginPasswordToggle: document.querySelector('#admin-login-password-toggle'),
  loginStatus: document.querySelector('#admin-login-status'),
  adminContent: document.querySelector('#admin-content'),
  sessionEmail: document.querySelector('#session-email'),
  signOutButton: document.querySelector('#sign-out-button'),
  usageHistoryForm: document.querySelector('#admin-usage-history-form'),
  usageHistoryLimit: document.querySelector('#admin-usage-history-limit'),
  usageHistorySummary: document.querySelector('#admin-usage-history-summary'),
  usageHistoryByModel: document.querySelector('#admin-usage-history-by-model'),
  usageHistoryRows: document.querySelector('#admin-usage-history-rows'),
  usageHistoryTotalTokens: document.querySelector('#admin-usage-history-total-tokens'),
  usageHistoryTotalCost: document.querySelector('#admin-usage-history-total-cost'),
  currencyReference: document.querySelector('#admin-currency-reference'),
  jobModal: document.querySelector('#admin-job-modal'),
  jobModalCard: document.querySelector('#admin-job-modal-card'),
  jobModalTitle: document.querySelector('#admin-job-modal-title'),
  jobModalBody: document.querySelector('#admin-job-modal-body'),
  jobModalClose: document.querySelector('#admin-job-modal-close'),
  adminAuditList: document.querySelector('#admin-audit-list'),
  adminUsageReportList: document.querySelector('#admin-usage-report-list'),
  adminUsageReportSummary: document.querySelector('#admin-usage-report-summary'),
  adminProviderCopy: document.querySelector('#admin-provider-copy'),
  adminProviderCurrent: document.querySelector('#admin-provider-current'),
  adminProviderForm: document.querySelector('#admin-provider-form'),
  adminRuntimeHealthCards: document.querySelector('#admin-runtime-health-cards'),
  adminRuntimeHealthList: document.querySelector('#admin-runtime-health-list'),
  adminRuntimeHealthPanel: document.querySelector('#admin-runtime-health-panel'),
  adminRuntimeHealthSummary: document.querySelector('#admin-runtime-health-summary'),
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
  adminProviderSubmit: document.querySelector('#admin-provider-submit')
};

let adminToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
let adminUsername = null;
let adminProviderState = null;
let modalReturnFocus = null;

const tokenFormatter = new Intl.NumberFormat('en-US');
const formatTokens = (value) => tokenFormatter.format(Math.round(Number(value) || 0));

const setToken = (token) => {
  adminToken = token;
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
};

const apiFetch = async (input, init = {}) => {
  const headers = new Headers(init.headers ?? {});
  if (adminToken) {
    headers.set('authorization', `Bearer ${adminToken}`);
    headers.set('x-admin-console-token', adminToken);
  }
  return fetch(input, { ...init, headers });
};

const setLoginStatus = (message, tone) => {
  if (!elements.loginStatus) {
    return;
  }
  elements.loginStatus.textContent = message ?? '';
  elements.loginStatus.classList.remove('is-error', 'is-loading');
  if (tone === 'error') {
    elements.loginStatus.classList.add('is-error');
  } else if (tone === 'loading') {
    elements.loginStatus.classList.add('is-loading');
  }
};

const setFormBusy = (form, busy) => {
  form.setAttribute('aria-busy', String(busy));
  const submitButton = form.querySelector('button[type="submit"]');

  if (!submitButton) {
    return;
  }

  if (busy) {
    submitButton.dataset.disabledBeforeBusy = String(submitButton.disabled);
    submitButton.disabled = true;
    return;
  }

  submitButton.disabled = submitButton.dataset.disabledBeforeBusy === 'true';
  delete submitButton.dataset.disabledBeforeBusy;
};

const setBanner = (message) => {
  if (elements.adminProviderStatus) {
    elements.adminProviderStatus.textContent = message ?? '';
  }
};

const showLoginView = () => {
  elements.sessionStatus.hidden = true;
  elements.skipLink.href = '#auth-panel';
  elements.skipLink.textContent = '跳至登入';
  elements.loginOverlay.hidden = false;
  elements.adminShell.hidden = true;
  elements.adminContent.hidden = true;
  elements.signOutButton.hidden = true;
};

const showAdminView = () => {
  elements.sessionStatus.hidden = true;
  elements.skipLink.href = '#admin-content';
  elements.skipLink.textContent = '跳至治理內容';
  elements.loginOverlay.hidden = true;
  elements.adminShell.hidden = false;
  elements.adminContent.hidden = false;
  elements.signOutButton.hidden = false;
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
        <strong>${escapeHtml(entry.action)}</strong>
        <span>${escapeHtml(entry.target)}</span>
        <small>${escapeHtml(entry.timestampText)}</small>
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

  const consumed = getCloudCostDisplayModel({
    totalCostUsd: payload.totals.consumedUsd,
    pricedCostUsd: payload.totals.pricedConsumedUsd ?? payload.totals.consumedUsd,
    hasUnpricedUsage: payload.totals.hasUnpricedUsage === true
  });
  const unpricedCountText = payload.totals.unpricedEntryCount
    ? ` / 未定價 ${formatTokens(payload.totals.unpricedEntryCount)} 筆`
    : '';
  elements.adminUsageReportSummary.textContent = `${payload.quotaDayKey} / ${
    payload.totals.hasUnpricedUsage ? consumed.label : '已用'
  } ${consumed.value}${unpricedCountText} / 保留 ${formatTwdFromUsd(payload.totals.reservedUsd)}`;
  elements.adminUsageReportList.replaceChildren(
    ...getUsageReportRowViewModels(payload.rows).map((row) => {
      const node = document.createElement('article');
      node.className = 'admin-audit-entry';
      node.innerHTML = `
        <strong>${escapeHtml(row.identityLabel)}</strong>
        <span>${escapeHtml(row.submitterId)}</span>
        <small>${row.consumedTitle} ${row.consumedLabel} / 保留 ${row.reservedLabel} / 剩餘 ${row.remainingLabel} / 總額 ${row.dailyQuotaLabel} / ${row.entryCountLabel}</small>
      `;
      return node;
    })
  );
};

const renderUsageHistory = (payload) => {
  const totals = payload?.totals ?? {};
  const costViewModel = getUsageHistoryCostViewModel(payload);
  const entries = costViewModel.entries;
  const submitterEmails = payload?.submitterEmails ?? {};

  elements.usageHistoryTotalTokens.textContent = formatTokens(totals.totalTokens);
  elements.usageHistoryTotalCost.textContent = costViewModel.totalCostLabel;

  if (!entries.length) {
    elements.usageHistorySummary.textContent = '尚無使用紀錄。';
    elements.usageHistoryByModel.replaceChildren();
    elements.usageHistoryRows.innerHTML =
      '<tr><td colspan="10" class="usage-history-empty">尚無使用紀錄。</td></tr>';
    return;
  }

  elements.usageHistorySummary.textContent =
    `共 ${formatTokens(totals.entryCount)} 筆紀錄 / 輸入 ${formatTokens(totals.inputTokens)} tokens / ` +
    `輸出 ${formatTokens(totals.outputTokens)} tokens / 合計 ${formatTokens(totals.totalTokens)} tokens / ` +
    costViewModel.totalCostSummary;

  const byModel = costViewModel.byModel;
  elements.usageHistoryByModel.replaceChildren(
    ...byModel.map((row) => {
      const node = document.createElement('article');
      node.className = 'runtime-health-card runtime-health-card-info';
      node.innerHTML = `
        <span class="meta-label">${escapeHtml(row.model)}（${escapeHtml(row.stageLabel)}）</span>
        <strong>${escapeHtml(row.costLabel)}</strong>
        <small>輸入 ${escapeHtml(formatTokens(row.inputTokens))} / 輸出 ${escapeHtml(formatTokens(row.outputTokens))} / ${escapeHtml(formatTokens(row.entryCount))} 筆${
          row.unpricedCountLabel ? ` / ${escapeHtml(row.unpricedCountLabel)}` : ''
        }</small>
      `;
      return node;
    })
  );

  elements.usageHistoryRows.replaceChildren(
    ...entries.map((entry) => {
      const row = document.createElement('tr');
      const identity = submitterEmails[entry.submitterId] || entry.submitterId;
      const cells = [
        { text: formatJobTimestamp(entry.createdAt) },
        { text: entry.stageLabel },
        { text: formatProviderLabel(entry.provider) },
        { text: entry.model || '-' },
        { text: entry.stage !== 'transcription' ? formatTokens(entry.inputTokens) : '—', cls: 'usage-num' },
        { text: entry.stage !== 'transcription' ? formatTokens(entry.outputTokens) : '—', cls: 'usage-num' },
        {
          text:
            entry.stage === 'transcription'
              ? `${formatTokens(Math.round((entry.audioMs || 0) / 1000))} 秒音訊`
              : formatTokens(entry.totalTokens),
          cls: 'usage-num'
        },
        { text: entry.costLabel, cls: 'usage-num' },
        { text: identity, title: entry.submitterId },
        { text: entry.jobId, title: entry.jobId, jobId: entry.jobId }
      ];

      for (const cell of cells) {
        const td = document.createElement('td');
        if (cell.jobId) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'usage-jobid-button';
          button.textContent = cell.text;
          button.dataset.jobId = cell.jobId;
          button.title = `${cell.title}（點擊查看內容）`;
          td.append(button);
        } else {
          td.textContent = cell.text;
          if (cell.cls) {
            td.className = cell.cls;
          }
          if (cell.title) {
            td.title = cell.title;
          }
        }
        row.append(td);
      }

      if (entry.entryType !== 'actual') {
        row.classList.add('usage-history-estimate');
      }

      return row;
    })
  );
};

const closeJobModal = () => {
  if (elements.jobModal.open) {
    elements.jobModal.close();
  }
  elements.jobModalBody.replaceChildren();
  modalReturnFocus?.focus();
  modalReturnFocus = null;
};

const buildModalSection = (title, contentNode) => {
  const section = document.createElement('div');
  section.className = 'admin-job-modal-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading, contentNode);
  return section;
};

const renderJobModal = (job) => {
  elements.jobModalTitle.textContent = job.uploadedFileName || job.meetingUrl || `工作 ${job.id}`;

  const children = [];

  const meta = document.createElement('div');
  meta.className = 'admin-job-modal-meta';
  const metaItems = [
    ['工作 ID', job.id],
    ['狀態', job.displayState || job.state],
    ['提交者', job.submitterEmail || job.submitterId],
    ['轉寫模型', job.transcriptionModel || '-'],
    ['摘要模型', job.summaryModel || '-'],
    ['建立時間', formatJobTimestamp(job.createdAt)]
  ];
  for (const [label, value] of metaItems) {
    const card = document.createElement('div');
    card.className = 'meta-card';
    const labelNode = document.createElement('span');
    labelNode.className = 'meta-label';
    labelNode.textContent = label;
    const valueNode = document.createElement('span');
    valueNode.textContent = value ?? '-';
    card.append(labelNode, valueNode);
    meta.append(card);
  }
  children.push(meta);

  if (job.ledgerEntries?.length) {
    const list = document.createElement('ul');
    for (const entry of job.ledgerEntries) {
      const item = document.createElement('li');
      const tokenPart =
        entry.stage !== 'transcription'
          ? `輸入 ${formatTokens(entry.inputTokens)} / 輸出 ${formatTokens(entry.outputTokens)} tokens`
          : `${formatTokens(Math.round((entry.audioMs || 0) / 1000))} 秒音訊`;
      const costLabel =
        entry.pricingStatus === 'unpriced'
          ? typeof entry.costUsd === 'number' && entry.costUsd > 0
            ? `${formatTwdFromUsd(entry.costUsd)}（含未定價用量）`
            : '未定價'
          : formatTwdFromUsd(entry.costUsd);
      item.textContent = `${formatUsageStageLabel(entry.stage)}（${entry.model}）：${tokenPart}，費用 ${costLabel}`;
      list.append(item);
    }
    children.push(buildModalSection('Token / 費用明細', list));
  }

  if (job.summaryArtifact?.text) {
    const pre = document.createElement('pre');
    pre.textContent = sanitizeAnonymousSpeakerLabels(job.summaryArtifact.text);
    children.push(buildModalSection('AI 摘要（輸出內容）', pre));

    const structured = job.summaryArtifact.structured;
    if (structured) {
      const groups = [
        ['重點', structured.keyPoints],
        ['待辦事項', structured.actionItems],
        ['決策重點', structured.decisions],
        ['風險提醒', structured.risks],
        ['待確認問題', structured.openQuestions]
      ];
      for (const [title, items] of groups) {
        if (items?.length) {
          const list = document.createElement('ul');
          for (const value of items) {
            const item = document.createElement('li');
            item.textContent = sanitizeAnonymousSpeakerLabels(value);
            list.append(item);
          }
          children.push(buildModalSection(title, list));
        }
      }
    }
  }

  if (job.transcriptArtifact?.segments?.length) {
    const pre = document.createElement('pre');
    pre.textContent = job.transcriptArtifact.segments
      .map(getReadableTranscriptText)
      .join('\n');
    children.push(buildModalSection('逐字稿（輸入內容）', pre));
  }

  if (!job.summaryArtifact?.text && !job.transcriptArtifact?.segments?.length) {
    const note = document.createElement('p');
    note.className = 'admin-provider-status';
    note.textContent = '這筆工作目前沒有可顯示的逐字稿或摘要內容。';
    children.push(note);
  }

  elements.jobModalBody.replaceChildren(...children);
};

const openJobModal = async (jobId, trigger) => {
  modalReturnFocus = trigger;
  if (!elements.jobModal.open) {
    elements.jobModal.showModal();
  }
  elements.jobModalTitle.textContent = '工作內容';
  const loading = document.createElement('p');
  loading.className = 'admin-provider-status';
  loading.textContent = '正在載入...';
  elements.jobModalBody.replaceChildren(loading);
  elements.jobModalCard.focus();

  try {
    const response = await apiFetch(`/api/admin/jobs/${encodeURIComponent(jobId)}`);

    if (response.status === 404) {
      const note = document.createElement('p');
      note.className = 'admin-provider-status';
      note.textContent = '這筆工作的逐字稿與摘要內容已被清除（歷史紀錄已刪除），僅保留用量統計。';
      elements.jobModalBody.replaceChildren(note);
      return;
    }

    if (!response.ok) {
      throw new Error(`載入失敗：${response.status}`);
    }

    renderJobModal(await response.json());
  } catch (error) {
    const note = document.createElement('p');
    note.className = 'admin-provider-status';
    note.textContent = error instanceof Error ? error.message : String(error);
    elements.jobModalBody.replaceChildren(note);
  }
};

const renderRuntimeHealth = (payload) => {
  if (!elements.adminRuntimeHealthPanel) {
    return;
  }

  const viewModel = getRuntimeHealthViewModel(payload);
  elements.adminRuntimeHealthSummary.textContent = viewModel.summaryText;
  elements.adminRuntimeHealthCards.replaceChildren(
    ...viewModel.queueCards.map((card) => {
      const node = document.createElement('article');
      node.className = `runtime-health-card runtime-health-card-${card.tone}`;
      node.innerHTML = `
        <span class="meta-label">${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(card.valueText)}</strong>
        <small>${escapeHtml(card.capacityText)}</small>
      `;
      return node;
    })
  );

  const entries = [
    {
      title: viewModel.leaseHeadline,
      detail: viewModel.failureText,
      meta: viewModel.cleanupText
    },
    ...viewModel.leaseRows.map((row) => ({
      title: row.stageLabel,
      detail: row.detailText,
      meta: row.heartbeatText
    }))
  ];

  elements.adminRuntimeHealthList.replaceChildren(
    ...entries.map((entry) => {
      const node = document.createElement('article');
      node.className = 'admin-audit-entry';
      node.innerHTML = `
        <strong>${escapeHtml(entry.title)}</strong>
        <span>${escapeHtml(entry.detail)}</span>
        <small>${escapeHtml(entry.meta)}</small>
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

const renderAdminPanel = (
  payload,
  overrides = [],
  auditEntries = [],
  usageReport = null,
  runtimeHealth = null,
  usageHistory = null
) => {
  adminProviderState = {
    ...payload,
    overrides,
    auditEntries,
    usageReport,
    runtimeHealth
  };
  elements.sessionEmail.textContent = adminUsername || '-';
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
  elements.adminDefaultQuotaInput.value = formatTwdInputFromUsd(
    payload.defaultDailyCloudQuotaUsd ?? 0
  );
  elements.adminLiveMeetingCapInput.value = formatTwdInputFromUsd(
    payload.liveMeetingReservationCapUsd ?? 0
  );
  elements.adminLocalTranscriptionInput.value = payload.concurrencyPools?.localTranscription ?? 1;
  elements.adminCloudTranscriptionInput.value = payload.concurrencyPools?.cloudTranscription ?? 1;
  elements.adminLocalSummaryInput.value = payload.concurrencyPools?.localSummary ?? 1;
  elements.adminCloudSummaryInput.value = payload.concurrencyPools?.cloudSummary ?? 1;
  renderAuditEntries(auditEntries);
  renderUsageReport(usageReport);
  renderRuntimeHealth(runtimeHealth);
  renderUsageHistory(usageHistory);
  updateAdminProviderStatus();
};

const getHistoryLimit = () => Number(elements.usageHistoryLimit?.value) || 500;

const fetchUsageHistory = async () => {
  const url = new URL('/api/admin/usage/history', window.location.origin);
  url.searchParams.set('limit', String(getHistoryLimit()));
  const response = await apiFetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch usage history: ${response.status}`);
  }

  renderUsageHistory(await response.json());
};

const fetchAdminPanel = async () => {
  const [
    policyResponse,
    overridesResponse,
    auditResponse,
    usageReportResponse,
    runtimeHealthResponse,
    usageHistoryResponse
  ] = await Promise.all([
    apiFetch('/api/admin/ai-policy'),
    apiFetch('/api/admin/cloud-quota/overrides'),
    apiFetch('/api/admin/audit-log'),
    apiFetch('/api/admin/cloud-usage/report'),
    apiFetch('/api/admin/runtime-health'),
    (() => {
      const url = new URL('/api/admin/usage/history', window.location.origin);
      url.searchParams.set('limit', String(getHistoryLimit()));
      return apiFetch(url);
    })()
  ]);

  if (
    policyResponse.status === 401 ||
    policyResponse.status === 403 ||
    usageHistoryResponse.status === 401
  ) {
    setToken(null);
    showLoginView();
    setLoginStatus('登入已過期，請重新登入。');
    return;
  }

  if (
    !policyResponse.ok ||
    !overridesResponse.ok ||
    !auditResponse.ok ||
    !usageReportResponse.ok ||
    !runtimeHealthResponse.ok ||
    !usageHistoryResponse.ok
  ) {
    throw new Error('Failed to fetch admin governance settings.');
  }

  const policy = await policyResponse.json();
  const overridesPayload = await overridesResponse.json();
  const auditPayload = await auditResponse.json();
  const usageReportPayload = await usageReportResponse.json();
  const runtimeHealthPayload = await runtimeHealthResponse.json();
  const usageHistoryPayload = await usageHistoryResponse.json();

  showAdminView();
  renderAdminPanel(
    policy,
    overridesPayload.overrides || [],
    auditPayload.entries || [],
    usageReportPayload,
    runtimeHealthPayload,
    usageHistoryPayload
  );
};

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    setFormBusy(elements.loginForm, true);
    setLoginStatus('正在登入...', 'loading');
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: elements.loginUsername.value.trim(),
        password: elements.loginPassword.value
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? `登入失敗：${response.status}`);
    }

    setToken(payload.token);
    adminUsername = payload.username ?? elements.loginUsername.value.trim();
    elements.loginPassword.value = '';
    setLoginStatus('');
    await fetchAdminPanel();
  } catch (error) {
    setLoginStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    setFormBusy(elements.loginForm, false);
  }
});

elements.loginPasswordToggle?.addEventListener('click', () => {
  const input = elements.loginPassword;
  if (!input) {
    return;
  }
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  elements.loginPasswordToggle.classList.toggle('is-visible', reveal);
  elements.loginPasswordToggle.setAttribute('aria-pressed', String(reveal));
  elements.loginPasswordToggle.setAttribute('aria-label', reveal ? '隱藏密碼' : '顯示密碼');
  input.focus();
});

elements.usageHistoryForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    setFormBusy(elements.usageHistoryForm, true);
    elements.usageHistorySummary.textContent = '正在讀取歷史使用紀錄...';
    await fetchUsageHistory();
  } catch (error) {
    elements.usageHistorySummary.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    setFormBusy(elements.usageHistoryForm, false);
  }
});

elements.usageHistoryRows?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-job-id]');
  if (button?.dataset.jobId) {
    openJobModal(button.dataset.jobId, button);
  }
});

elements.jobModal?.addEventListener('click', (event) => {
  if (event.target === elements.jobModal) {
    closeJobModal();
  }
});

elements.jobModalClose?.addEventListener('click', closeJobModal);

elements.jobModal?.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeJobModal();
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

  try {
    setFormBusy(elements.adminProviderForm, true);
    setBanner('正在更新模型與治理設定...');
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
        defaultDailyCloudQuotaUsd: twdQuotaToUsd(elements.adminDefaultQuotaInput.value),
        liveMeetingReservationCapUsd: twdQuotaToUsd(
          elements.adminLiveMeetingCapInput.value
        ),
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
    setBanner('模型與治理設定已更新。');
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error));
  } finally {
    setFormBusy(elements.adminProviderForm, false);
  }
});

elements.adminOverrideForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!adminProviderState) {
    return;
  }

  try {
    setFormBusy(elements.adminOverrideForm, true);
    elements.adminSummaryModelStatus.textContent = '正在更新個人額度...';
    const response = await apiFetch('/api/admin/cloud-quota/overrides', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        submitterId: elements.adminOverrideSubmitterId.value.trim(),
        dailyQuotaUsd: twdQuotaToUsd(elements.adminOverrideQuotaInput.value)
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? `Quota override update failed: ${response.status}`);
    }

    await fetchAdminPanel();
    elements.adminSummaryModelStatus.textContent = '個人額度已更新。';
  } catch (error) {
    elements.adminSummaryModelStatus.textContent =
      error instanceof Error ? error.message : String(error);
  } finally {
    setFormBusy(elements.adminOverrideForm, false);
  }
});

elements.signOutButton.addEventListener('click', () => {
  setToken(null);
  adminUsername = null;
  adminProviderState = null;
  showLoginView();
  setLoginStatus('已登出。');
});

const boot = async () => {
  try {
    const pricingResponse = await fetch('/api/operator/config');
    if (pricingResponse.ok) {
      applyTwdPricingReference((await pricingResponse.json()).pricingReference);
    }
  } catch {
    // Keep the verified bundled fallback when the reference endpoint is unavailable.
  }
  elements.currencyReference.textContent = getTwdPricingReferenceText();

  if (!adminToken) {
    showLoginView();
    return;
  }

  try {
    const sessionResponse = await apiFetch('/api/admin/session');

    if (!sessionResponse.ok) {
      setToken(null);
      showLoginView();
      return;
    }

    const session = await sessionResponse.json();
    adminUsername = session.username ?? null;
    await fetchAdminPanel();
  } catch (error) {
    setLoginStatus(error instanceof Error ? error.message : String(error));
    showLoginView();
  }
};

boot();
