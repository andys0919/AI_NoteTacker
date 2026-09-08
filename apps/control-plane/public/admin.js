import { formatJobTimestamp } from '/dashboard-copy.js';
import {
  applyTwdPricingReference,
  formatTwdInputFromUsd,
  getTwdPricingReferenceText,
  twdQuotaToUsd
} from '/currency-display.js';
import { escapeHtml } from '/escape-html.js';
import {
  formatProviderLabel,
  formatSummaryModeLabel,
  getAdminGovernanceViewModel,
  getCodexWeeklyUsageViewModel,
  getUsageHistoryCostViewModel,
  getUsageHistoryJobViewModels
} from '/governance-panel.js';
import { getRuntimeHealthViewModel } from '/runtime-health-panel.js';


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
  adminProviderCopy: document.querySelector('#admin-provider-copy'),
  adminProviderCurrent: document.querySelector('#admin-provider-current'),
  adminCodexUsageCard: document.querySelector('#admin-codex-usage-card'),
  adminCodexUsageHeadline: document.querySelector('#admin-codex-usage-headline'),
  adminCodexUsageStatus: document.querySelector('#admin-codex-usage-status'),
  adminCodexUsageProgress: document.querySelector('#admin-codex-usage-progress'),
  adminCodexUsageUsed: document.querySelector('#admin-codex-usage-used'),
  adminCodexUsageRemaining: document.querySelector('#admin-codex-usage-remaining'),
  adminCodexUsageReset: document.querySelector('#admin-codex-usage-reset'),
  adminCodexUsageChecked: document.querySelector('#admin-codex-usage-checked'),
  adminProviderForm: document.querySelector('#admin-provider-form'),
  adminRuntimeHealthCards: document.querySelector('#admin-runtime-health-cards'),
  adminRuntimeHealthList: document.querySelector('#admin-runtime-health-list'),
  adminRuntimeHealthPanel: document.querySelector('#admin-runtime-health-panel'),
  adminRuntimeHealthSummary: document.querySelector('#admin-runtime-health-summary'),
  adminProviderSelect: document.querySelector('#admin-provider-select'),
  adminTranscriptionModelInput: document.querySelector('#admin-transcription-model-input'),
  adminSummaryProviderValue: document.querySelector('#admin-summary-provider-value'),
  adminSummaryModelInput: document.querySelector('#admin-summary-model-input'),
  adminPricingVersionInput: document.querySelector('#admin-pricing-version-input'),
  adminDefaultQuotaInput: document.querySelector('#admin-default-quota-input'),
  adminLiveMeetingCapInput: document.querySelector('#admin-live-meeting-cap-input'),
  adminLocalTranscriptionInput: document.querySelector('#admin-local-transcription-input'),
  adminCloudTranscriptionInput: document.querySelector('#admin-cloud-transcription-input'),
  adminLocalSummaryInput: document.querySelector('#admin-local-summary-input'),
  adminProviderStatus: document.querySelector('#admin-provider-status'),
  adminProviderStatusPill: document.querySelector('#admin-provider-status-pill'),
  adminProviderSubmit: document.querySelector('#admin-provider-submit')
};

window.localStorage.removeItem(TOKEN_STORAGE_KEY);
let adminToken = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
let adminUsername = null;
let adminProviderState = null;
let codexUsageExpiryTimer;

const tokenFormatter = new Intl.NumberFormat('en-US');
const formatTokens = (value) => tokenFormatter.format(Math.round(Number(value) || 0));

const setToken = (token) => {
  adminToken = token;
  if (token) {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
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
  elements.signOutButton.hidden = true;
};

const showAdminView = () => {
  elements.sessionStatus.hidden = true;
  elements.skipLink.href = '#admin-content';
  elements.skipLink.textContent = '跳至治理內容';
  elements.loginOverlay.hidden = true;
  elements.adminShell.hidden = false;
  elements.signOutButton.hidden = false;
};

const renderUsageHistory = (payload) => {
  const totals = payload?.totals ?? {};
  const costViewModel = getUsageHistoryCostViewModel(payload);
  const jobs = getUsageHistoryJobViewModels(costViewModel.entries);
  const submitterEmails = payload?.submitterEmails ?? {};
  const jobResults = new Map((payload?.jobResults ?? []).map((job) => [job.id, job]));

  elements.usageHistoryTotalTokens.textContent = formatTokens(totals.totalTokens);
  elements.usageHistoryTotalCost.textContent = costViewModel.totalCostLabel;

  if (!jobs.length) {
    elements.usageHistorySummary.textContent = '尚無使用紀錄。';
    elements.usageHistoryByModel.replaceChildren();
    elements.usageHistoryRows.innerHTML =
      '<tr><td colspan="5" class="usage-history-empty">尚無使用紀錄。</td></tr>';
    return;
  }

  elements.usageHistorySummary.textContent =
    `共 ${formatTokens(jobs.length)} 個工作 / 輸入 ${formatTokens(totals.inputTokens)} tokens / ` +
    `輸出 ${formatTokens(totals.outputTokens)} tokens / 合計 ${formatTokens(totals.totalTokens)} tokens / ` +
    `${formatTokens(totals.providerRequestCount)} 次 provider request / ` +
    `計費音訊 ${formatTokens(Math.round((totals.billedAudioMs || 0) / 1000))} 秒 / ` +
    costViewModel.totalCostSummary;

  const byModel = costViewModel.byModel;
  elements.usageHistoryByModel.replaceChildren(
    ...byModel.map((row) => {
      const node = document.createElement('article');
      node.className = 'runtime-health-card runtime-health-card-info';
      node.innerHTML = `
        <span class="meta-label">${escapeHtml(row.model)}（${escapeHtml(row.stageLabel)}）</span>
        <strong>${escapeHtml(row.costLabel)}</strong>
        <small>輸入 ${escapeHtml(formatTokens(row.inputTokens))} / Cache write ${escapeHtml(formatTokens(row.cacheWritePromptTokens))} / 輸出 ${escapeHtml(formatTokens(row.outputTokens))} / ${escapeHtml(formatTokens(row.providerRequestCount))} requests${
          row.unpricedCountLabel ? ` / ${escapeHtml(row.unpricedCountLabel)}` : ''
        }</small>
      `;
      return node;
    })
  );

  elements.usageHistoryRows.replaceChildren(
    ...jobs.map((job) => {
      const row = document.createElement('tr');
      const identity = submitterEmails[job.submitterId] || job.submitterId;
      const result = jobResults.get(job.jobId);
      const action = document.createElement(result?.resultAvailable ? 'a' : 'span');
      if (result?.resultAvailable) {
        action.textContent = '查看結果';
        action.href = `/admin/result?jobId=${encodeURIComponent(job.jobId)}`;
        action.className = 'mini-button';
        action.setAttribute('aria-label', `查看結果：${result.title}`);
      } else {
        action.textContent = !result ? '結果已移除'
          : result.state === 'completed' ? '沒有結果'
            : result.state === 'failed' ? '處理失敗' : '處理中';
      }
      const cells = [
        { text: formatJobTimestamp(job.createdAt) },
        { text: result?.title || job.jobId, title: job.jobId },
        { text: job.costLabel, cls: 'usage-num' },
        { text: identity, title: job.submitterId },
        { node: action }
      ];

      for (const cell of cells) {
        const td = document.createElement('td');
        if (cell.node) {
          td.append(cell.node);
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

      return row;
    })
  );
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

const renderCodexWeeklyUsage = (payload) => {
  clearTimeout(codexUsageExpiryTimer);
  const viewModel = getCodexWeeklyUsageViewModel(payload, formatJobTimestamp);
  if (viewModel.available) {
    codexUsageExpiryTimer = setTimeout(() => renderCodexWeeklyUsage(payload), viewModel.expiresInMs + 1);
  }
  elements.adminCodexUsageCard.classList.toggle('is-unavailable', !viewModel.available);
  elements.adminCodexUsageHeadline.textContent = viewModel.headline;
  elements.adminCodexUsageStatus.textContent = viewModel.statusText;
  elements.adminCodexUsageStatus.className = `provider-pill ${
    viewModel.available && viewModel.remainingText !== '0%' ? 'ready' : 'blocked'
  }`;
  elements.adminCodexUsageProgress.hidden = !viewModel.available;
  if (viewModel.available) {
    elements.adminCodexUsageProgress.value = viewModel.usedPercent;
    elements.adminCodexUsageProgress.textContent = viewModel.usedText;
    elements.adminCodexUsageProgress.setAttribute(
      'aria-valuetext',
      `已用 ${viewModel.usedText}，剩餘 ${viewModel.remainingText}`
    );
  } else {
    elements.adminCodexUsageProgress.removeAttribute('aria-valuetext');
  }
  elements.adminCodexUsageUsed.textContent = viewModel.usedText;
  elements.adminCodexUsageRemaining.textContent = viewModel.remainingText;
  elements.adminCodexUsageReset.textContent = viewModel.resetText;
  elements.adminCodexUsageChecked.textContent = viewModel.checkedText;
};

const updateAdminProviderStatus = () => {
  const viewModel = getAdminGovernanceViewModel({
    state: adminProviderState,
    selectedTranscriptionProvider: elements.adminProviderSelect.value,
    selectedSummaryProvider: adminProviderState?.summaryProvider ?? 'local-codex',
    transcriptionModelInput: elements.adminTranscriptionModelInput.value,
    summaryModelInput: elements.adminSummaryModelInput.value,
    pricingVersionInput: elements.adminPricingVersionInput.value,
    overrideSubmitterId: '',
    overrideQuotaInput: ''
  });

  elements.adminProviderCurrent.textContent = viewModel.currentLabel;
  elements.adminProviderCopy.textContent = viewModel.copyText;
  elements.adminProviderStatus.textContent = viewModel.providerStatusText;
  elements.adminProviderStatusPill.textContent = viewModel.pillText;
  elements.adminProviderStatusPill.className = `provider-pill ${viewModel.pillTone}`;
  elements.adminProviderSubmit.disabled = viewModel.submitDisabled;
  elements.adminSummaryModelInput.disabled = viewModel.summaryModelInputDisabled;
  elements.adminSummaryModelInput.placeholder = '例如 gpt-5.6-luna';
};

const renderAdminPanel = (
  payload,
  runtimeHealth = null,
  usageHistory = null,
  codexUsage = null
) => {
  adminProviderState = {
    ...payload,
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
  elements.adminSummaryProviderValue.textContent = formatSummaryModeLabel(payload.summaryProvider);
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
  renderRuntimeHealth(runtimeHealth);
  renderUsageHistory(usageHistory);
  renderCodexWeeklyUsage(codexUsage);
  updateAdminProviderStatus();
};

const getHistoryLimit = () => Number(elements.usageHistoryLimit?.value) || 100;

const fetchUsageHistory = async () => {
  const url = new URL('/api/admin/usage/history', window.location.origin);
  url.searchParams.set('limit', String(getHistoryLimit()));
  const response = await apiFetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch usage history: ${response.status}`);
  }

  renderUsageHistory(await response.json());
};

const fetchAdminPanel = async (pricingReady = Promise.resolve()) => {
  const responses = await Promise.all([
    apiFetch('/api/admin/ai-policy'),
    apiFetch('/api/admin/runtime-health'),
    apiFetch(`/api/admin/usage/history?limit=${getHistoryLimit()}`),
    apiFetch('/api/admin/codex-usage')
  ]);
  await pricingReady;
  if (responses.some((response) => response.status === 401)) {
    setToken(null);
    showLoginView();
    return;
  }
  if (responses.some((response) => !response.ok)) {
    throw new Error('Failed to fetch admin governance settings.');
  }
  renderAdminPanel(...await Promise.all(responses.map((response) => response.json())));
};

const refreshCodexWeeklyUsage = async () => {
  if (!adminToken) return;
  try {
    const response = await apiFetch('/api/admin/codex-usage', { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Usage unavailable');
    renderCodexWeeklyUsage(await response.json());
  } catch {
    renderCodexWeeklyUsage({ status: 'unavailable' });
  }
};
setInterval(refreshCodexWeeklyUsage, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshCodexWeeklyUsage();
});

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
    showAdminView();
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

[
  elements.adminProviderSelect,
  elements.adminTranscriptionModelInput,
  elements.adminSummaryModelInput,
  elements.adminPricingVersionInput,
  elements.adminDefaultQuotaInput,
  elements.adminLiveMeetingCapInput,
  elements.adminLocalTranscriptionInput,
  elements.adminCloudTranscriptionInput,
  elements.adminLocalSummaryInput
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
        summaryProvider: adminProviderState.summaryProvider,
        summaryModel: elements.adminSummaryModelInput.value.trim(),
        pricingVersion: elements.adminPricingVersionInput.value.trim(),
        defaultDailyCloudQuotaUsd: twdQuotaToUsd(elements.adminDefaultQuotaInput.value),
        liveMeetingReservationCapUsd: twdQuotaToUsd(
          elements.adminLiveMeetingCapInput.value
        ),
        concurrencyPools: {
          localTranscription: Number(elements.adminLocalTranscriptionInput.value),
          cloudTranscription: Number(elements.adminCloudTranscriptionInput.value),
          localSummary: Number(elements.adminLocalSummaryInput.value),
          cloudSummary: adminProviderState.concurrencyPools?.cloudSummary ?? 1
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

elements.signOutButton.addEventListener('click', () => {
  setToken(null);
  adminUsername = null;
  adminProviderState = null;
  showLoginView();
  setLoginStatus('已登出。');
});

const fetchPricingReference = async () => {
  try {
    const pricingResponse = await fetch('/api/operator/config');
    if (pricingResponse.ok) {
      applyTwdPricingReference((await pricingResponse.json()).pricingReference);
    }
  } catch {
    // Keep the verified bundled fallback when the reference endpoint is unavailable.
  }
  elements.currencyReference.textContent = getTwdPricingReferenceText();
};

const boot = async () => {
  const pricingPromise = fetchPricingReference();

  if (!adminToken) {
    showLoginView();
    await pricingPromise;
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
    showAdminView();
    await fetchAdminPanel(pricingPromise);
  } catch (error) {
    setLoginStatus(error instanceof Error ? error.message : String(error));
    showLoginView();
  }
};

boot();
