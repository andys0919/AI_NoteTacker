import { escapeHtml } from '/escape-html.js';
import {
  getEmptyStateMessage,
  getJobCardViewModel,
  renderOptionalMarkup
} from '/dashboard-copy.js';
import { getDashboardPrefill } from '/dashboard-query.js';
import {
  getArchivePageState,
  getJobActionSet
} from '/dashboard-workflows.js';
import {
  configureSummaryNavigation,
  renderStructuredSummaryMarkup,
  renderTranscriptMarkup,
  sanitizeAnonymousSpeakerLabels,
  wireArtifactTabs
} from '/artifact-reader.js';
import { applyTwdPricingReference } from '/currency-display.js';

const DEFAULT_OPERATOR_ID_KEY = 'solomon-notetaker-operator-id';
const PROGRESS_POLL_INTERVAL_MS = 5000;
const meetingDetailJobId = (() => {
  const match = window.location.pathname.match(/^\/notes\/([^/]+)$/);
  if (!match) return '';

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
})();
if (meetingDetailJobId) {
  document.body.classList.add('meeting-detail-page');
}
const elements = {
  joinName: document.querySelector('#join-name'),
  meetingForm: document.querySelector('#meeting-form'),
  meetingSubmitButton: document.querySelector('#meeting-submit-button'),
  meetingFormStatus: document.querySelector('#meeting-form-status'),
  uploadForm: document.querySelector('#upload-form'),
  uploadSubmitButton: document.querySelector('#upload-submit-button'),
  uploadFormStatus: document.querySelector('#upload-form-status'),
  audioFile: document.querySelector('#audio-file'),
  uploadSubtitle: document.querySelector('#upload-subtitle'),
  uploadTitle: document.querySelector('#upload-title'),
  jobList: document.querySelector('#job-list'),
  statusBanner: document.querySelector('#status-banner'),
  activeCount: document.querySelector('#active-count'),
  queuedCount: document.querySelector('#queued-count'),
  completedCount: document.querySelector('#completed-count'),
  clearHistoryButton: document.querySelector('#clear-history-button'),
  archiveControls: document.querySelector('#archive-controls'),
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

let currentSubmitterId = getOrCreateSubmitterId();
let uploadInFlight = false;
let operatorConfig = {
  defaultJoinName: 'Solomon - NoteTaker'
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
let progressPollInFlight = false;
let jobsRequestGeneration = 0;

const applyDefaultJoinNameToForm = () => {
  elements.joinName.value = operatorConfig.defaultJoinName;
};

const setQuickFilter = (filterId) => {
  currentQuickFilter = filterId;
  elements.jobFilters
    ?.querySelectorAll('[data-filter]')
    .forEach((button) => {
      const selected = button.dataset.filter === filterId;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
};

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const focusSharedJobIfNeeded = () => {
  if (!pendingSharedJobId) {
    return;
  }

  const card = elements.jobList.querySelector(`[data-job-id="${pendingSharedJobId}"]`);

  if (!card) {
    return;
  }

  card.classList.add('job-card-highlight');
  const scrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  card.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
  window.setTimeout(() => {
    card.classList.remove('job-card-highlight');
  }, 2200);
  pendingSharedJobId = '';
};

const setFormBusy = (form, submitButton, busy) => {
  form.setAttribute('aria-busy', String(busy));
  submitButton.disabled = busy;
};

const setFormStatus = (status, message, kind = 'info') => {
  if (!message) {
    status.hidden = true;
    return;
  }

  status.textContent = message;
  status.className = `form-status ${kind}`;
  status.hidden = false;
};

const apiFetch = async (input, init) => fetch(input, init);

const setBanner = (message, kind = 'info') => {
  if (!message) {
    elements.statusBanner.hidden = true;
    return;
  }

  elements.statusBanner.textContent = message;
  elements.statusBanner.className = `status-banner ${kind}`;
  elements.statusBanner.hidden = false;
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

  return payload.artifactCleanup ?? { status: 'completed', objectCount: 0 };
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

  return {
    deletedCount: payload.deletedCount ?? 0,
    artifactCleanup: payload.artifactCleanup ?? { status: 'completed', objectCount: 0 }
  };
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
  url.searchParams.set('submitterId', currentSubmitterId);

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
  const actions = meetingDetailJobId
    ? []
    : [
        `<a class="mini-button primary job-detail-link" href="/notes/${encodeURIComponent(job.id)}" target="_blank" rel="noopener">開啟完整內容（新分頁）</a>`
      ];
  actions.push(...actionSet.map((action) => {
    if (action === 'stop-current') {
      return '<button class="mini-button danger" type="button" data-action="stop-current">離開會議</button>';
    }

    if (action === 'interrupt-job') {
      return '<button class="mini-button danger" type="button" data-action="interrupt-job">停止處理</button>';
    }

    if (action === 'delete-history') {
      return '<button class="mini-button history" type="button" data-action="delete-history">刪除紀錄</button>';
    }

    return '<button class="mini-button export" type="button" data-action="export-markdown">下載 MD</button>';
  }));

  const canShare = Boolean(meetingDetailJobId) && job.share?.eligible === true;
  let shareStatus = '';
  if (canShare) {
    const isActiveShare = job.share?.status === 'active';
    const statusLabel = {
      active: '分享中',
      expired: '已到期',
      revoked: '已撤銷',
      none: '尚未建立'
    }[job.share?.status || 'none'];
    const expiryText = job.share?.expiresAt
      ? ` · 到期時間 ${new Date(job.share.expiresAt).toLocaleString('zh-TW')}`
      : '';
    shareStatus = `
      <div class="share-management" aria-live="polite">
        <strong>公開分享</strong>
        <span>${escapeHtml(statusLabel)}${escapeHtml(expiryText)}</span>
        <p>持有此網址的人可以查看並轉寄；網址 30 天後到期，也可隨時更換或撤銷。</p>
      </div>
    `;
    actions.push(
      `<button class="mini-button export" type="button" data-action="share-job">${isActiveShare ? '複製分享網址' : '建立並複製分享網址'}</button>`
    );
    if (isActiveShare) {
      actions.push(
        '<button class="mini-button history" type="button" data-action="rotate-share">更換分享網址</button>',
        '<button class="mini-button danger" type="button" data-action="revoke-share">撤銷分享</button>'
      );
    }
  } else if (meetingDetailJobId) {
    shareStatus = `
      <div class="share-management" aria-live="polite">
        <strong>公開分享</strong>
        <span>尚不可用</span>
        <p>只有已完成且有摘要或逐字稿內容的會議可以建立分享網址。</p>
      </div>
    `;
  }

  if (actions.length === 0) {
    return '';
  }

  return `${shareStatus}<div class="job-actions">${actions.join('')}</div>`;
};

const requestJobShare = async (jobId, action = '') => {
  const response = await apiFetch(
    `/api/operator/jobs/${encodeURIComponent(jobId)}/share${action}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ submitterId: currentSubmitterId })
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Share failed: ${response.status}`);
  }

  return payload;
};

const revokeJobShare = async (jobId) => {
  const response = await apiFetch(`/api/operator/jobs/${encodeURIComponent(jobId)}/share`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ submitterId: currentSubmitterId })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message ?? `Revoke failed: ${response.status}`);
  }
};

const copyText = async (value) => {
  if (window.navigator.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  input.remove();
};

const copyShareUrl = async (jobId, action = '') => {
  const payload = await requestJobShare(jobId, action);
  await copyText(`${window.location.origin}/share#${payload.token}`);
  return payload.expiresAt;
};

const toDomId = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '-');

const scrollToOwnerDeepLink = () => {
  if (!meetingDetailJobId || !window.location.hash) {
    return;
  }

  try {
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    document
      .querySelector('.summary-deep-link-target')
      ?.classList.remove('summary-deep-link-target');
    target?.classList.add('summary-deep-link-target');
    target?.scrollIntoView({ block: 'start' });
    target?.focus({ preventScroll: true });
  } catch {
    // Ignore malformed fragments and keep the meeting readable.
  }
};

if (meetingDetailJobId) {
  window.addEventListener('hashchange', scrollToOwnerDeepLink);
}

const createArtifactReader = (job) => {
  const hasSummary = Boolean(job.summaryArtifact);
  const hasTranscript = Boolean(job.transcriptArtifact);

  if (!hasSummary && !hasTranscript) {
    return '';
  }

  const readerId = `artifact-${toDomId(job.id)}`;
  const selectedKind = hasSummary ? 'summary' : 'transcript';
  const panelHeading = meetingDetailJobId ? 'h2' : 'h4';
  const tabs = [];
  const panels = [];

  if (hasSummary) {
    const tabId = `${readerId}-summary-tab`;
    const panelId = `${readerId}-summary-panel`;
    tabs.push(`
      <button
        class="artifact-tab${selectedKind === 'summary' ? ' active' : ''}"
        id="${tabId}"
        type="button"
        role="tab"
        aria-controls="${panelId}"
        aria-selected="${selectedKind === 'summary'}"
        tabindex="${selectedKind === 'summary' ? '0' : '-1'}"
        data-artifact-tab="summary"
      >摘要</button>
    `);
    panels.push(`
      <section
        class="artifact-panel"
        id="${panelId}"
        role="tabpanel"
        aria-labelledby="${tabId}"
        data-artifact-panel="summary"
        ${selectedKind === 'summary' ? '' : 'hidden'}
      >
        ${
          meetingDetailJobId && job.summaryArtifact.structured
            ? ''
            : `
              <header class="artifact-panel-heading">
                <div>
                  <${panelHeading}>會議摘要</${panelHeading}>
                </div>
                <p>依逐字稿整理，只顯示有內容的段落。</p>
              </header>
            `
        }
        ${
          job.summaryArtifact.structured
            ? renderStructuredSummaryMarkup(
                job.summaryArtifact.structured,
                `${readerId}-summary`,
                {
                  headingLevel: meetingDetailJobId ? 2 : 4,
                  showTitle: !meetingDetailJobId
                }
              )
            : `<pre class="summary-text">${escapeHtml(sanitizeAnonymousSpeakerLabels(job.summaryArtifact.text))}</pre>`
        }
      </section>
    `);
  }

  if (hasTranscript) {
    const tabId = `${readerId}-transcript-tab`;
    const panelId = `${readerId}-transcript-panel`;
    const transcriptMarkup = renderTranscriptMarkup(job.transcriptArtifact.segments);
    tabs.push(`
      <button
        class="artifact-tab${selectedKind === 'transcript' ? ' active' : ''}"
        id="${tabId}"
        type="button"
        role="tab"
        aria-controls="${panelId}"
        aria-selected="${selectedKind === 'transcript'}"
        tabindex="${selectedKind === 'transcript' ? '0' : '-1'}"
        data-artifact-tab="transcript"
      >逐字稿</button>
    `);
    panels.push(`
      <section
        class="artifact-panel"
        id="${panelId}"
        role="tabpanel"
        aria-labelledby="${tabId}"
        data-artifact-panel="transcript"
        ${selectedKind === 'transcript' ? '' : 'hidden'}
      >
        <header class="artifact-panel-heading">
          <div>
            <${panelHeading}>逐字稿</${panelHeading}>
          </div>
          <p>${job.transcriptArtifact.segments.length} 段 · 保留時間與逐字內容</p>
        </header>
        <div
          class="transcript-reader"
          role="region"
          aria-label="完整逐字稿，可上下捲動"
          tabindex="0"
        >${transcriptMarkup}</div>
      </section>
    `);
  }

  return `
    <section class="artifact-reader" aria-label="會議內容閱讀器">
      <div class="artifact-tablist" role="tablist" aria-label="選擇會議內容" data-artifact-tabs>
        ${tabs.join('')}
      </div>
      ${panels.join('')}
    </section>
  `;
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
  const artifactReader = createArtifactReader(job);
  if (artifactReader) {
    card.classList.add('job-card-expanded');
  }

  const progressBlock =
    viewModel.showProgress &&
    `
      <div class="artifact-block progress-block">
        <div class="artifact-heading">
          <h3>目前進度</h3>
        </div>
        <div class="progress-shell">
          <div class="progress-meta">
            <span class="progress-label">${escapeHtml(viewModel.progressLabel)}</span>
            <strong class="progress-percent">${viewModel.progressPercent}%</strong>
          </div>
          ${progressDuration ? `<p class="progress-duration">${progressDuration}</p>` : ''}
          <div
            class="progress-bar ${viewModel.progressTone}"
            role="progressbar"
            aria-label="工作處理進度"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${viewModel.progressPercent}"
            aria-valuetext="${escapeHtml(viewModel.progressLabel)} ${viewModel.progressPercent}%"
          >
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
          <p>${escapeHtml(viewModel.statusSummary)}</p>
        </div>
        ${job.failureCode ? `<p class="artifact-note">錯誤代碼：${escapeHtml(job.failureCode)}</p>` : ''}
      </div>
    `;

  const actionBlock = createActionBlock(job, viewModel.badgeTone);
  const jobHeaderMarkup = `
    <div class="job-head">
      <div>
        <h3 class="job-title">${viewModel.title}</h3>
        <p class="job-status-summary">${escapeHtml(viewModel.statusSummary)}</p>
      </div>
      <span class="badge ${escapeHtml(activeBadge)}">${escapeHtml(viewModel.badgeLabel)}</span>
    </div>
  `;
  const jobMetadataMarkup = `
    <div class="job-meta-grid">
      <div class="job-meta-item">
        <span>${viewModel.sourceLabel}</span>
        <strong>${escapeHtml(viewModel.sourceValue)}</strong>
      </div>
      ${
        viewModel.joinNameLabel
          ? `
            <div class="job-meta-item">
              <span>${viewModel.joinNameLabel}</span>
              <strong>${escapeHtml(viewModel.joinNameValue)}</strong>
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
        <strong data-job-updated-at>${viewModel.updatedAtText}</strong>
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
      ${viewModel.costItems
        .map(
          (item) => `
            <div class="job-meta-item">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `
        )
        .join('')}
    </div>
  `;
  const operationalMarkup = `
    ${jobHeaderMarkup}
    ${jobMetadataMarkup}
    ${actionBlock}
    ${renderOptionalMarkup(failureBlock)}
    ${renderOptionalMarkup(progressBlock)}
  `;

  card.innerHTML =
    meetingDetailJobId && artifactReader
      ? `
      <details class="meeting-detail-controls">
        <summary>工作資訊與分享</summary>
        <div class="meeting-detail-controls-body">${operationalMarkup}</div>
      </details>
      ${artifactReader}
    `
      : `${operationalMarkup}${artifactReader}`;

  configureSummaryNavigation(card);
  wireArtifactTabs(card);

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
        await refreshJobsView(job.id);
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }

  const deleteButton = card.querySelector('[data-action="delete-history"]');
  if (deleteButton) {
    deleteButton.addEventListener('click', async () => {
      const confirmed = window.confirm(
        '要刪除這筆歷史紀錄與錄音物件嗎？逐字稿與摘要仍會保留供管理稽核。'
      );
      if (!confirmed) {
        return;
      }

      try {
        setBanner('正在刪除紀錄...');
        const cleanup = await deleteJob(job.id);
        if (meetingDetailJobId) {
          window.location.assign('/');
          return;
        }
        setBanner(`紀錄已刪除，已清除 ${cleanup.objectCount} 個儲存物件。`);
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
        await refreshJobsView(job.id);
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

  const shareButton = card.querySelector('[data-action="share-job"]');
  const shareActionButtons = [
    shareButton,
    card.querySelector('[data-action="rotate-share"]'),
    card.querySelector('[data-action="revoke-share"]')
  ].filter(Boolean);
  const setShareActionsBusy = (busy) => {
    shareActionButtons.forEach((button) => {
      button.disabled = busy;
    });
  };
  shareButton?.addEventListener('click', async () => {
    setShareActionsBusy(true);
    try {
      setBanner('正在建立分享網址...');
      const expiresAt = await copyShareUrl(job.id);
      await refreshJobsView(job.id);
      setBanner(`分享網址已複製；持有網址的人可以查看並轉寄。效期至 ${new Date(expiresAt).toLocaleString('zh-TW')}。`);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setShareActionsBusy(false);
    }
  });

  const rotateShareButton = card.querySelector('[data-action="rotate-share"]');
  rotateShareButton?.addEventListener('click', async () => {
    if (!window.confirm('更換後，舊分享網址會立即失效。確定繼續嗎？')) {
      return;
    }

    setShareActionsBusy(true);
    try {
      setBanner('正在更換分享網址...');
      const expiresAt = await copyShareUrl(job.id, '/rotate');
      await refreshJobsView(job.id);
      setBanner(`新分享網址已複製，舊網址已失效；持有網址的人可以查看並轉寄。效期至 ${new Date(expiresAt).toLocaleString('zh-TW')}。`);
    } catch (error) {
      setBanner(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setShareActionsBusy(false);
    }
  });

  const revokeShareButton = card.querySelector('[data-action="revoke-share"]');
  revokeShareButton?.addEventListener('click', async () => {
    if (!window.confirm('確定要讓目前的分享網址立即失效嗎？')) {
      return;
    }

    setShareActionsBusy(true);
    try {
      setBanner('正在撤銷分享網址...');
      await revokeJobShare(job.id);
      await refreshJobsView(job.id);
      setBanner('分享網址已撤銷。');
    } catch (error) {
      setBanner(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setShareActionsBusy(false);
    }
  });

  return card;
};

const renderJobStats = (jobs) => {
  const activeCount = currentJobStats?.activeCount ?? jobs.filter((job) => activeStates.has(job.state)).length;
  const queuedCount = currentJobStats?.queuedCount ?? jobs.filter((job) => job.state === 'queued').length;
  const completedCount = currentJobStats?.completedCount ?? jobs.filter((job) => job.state === 'completed').length;
  const terminalCount =
    currentJobStats
      ? (currentJobStats.completedCount || 0) + (currentJobStats.failedCount || 0)
      : jobs.filter((job) => isTerminalJob(job)).length;

  elements.activeCount.textContent = String(activeCount);
  elements.queuedCount.textContent = String(queuedCount);
  elements.completedCount.textContent = String(completedCount);
  elements.clearHistoryButton.disabled = terminalCount === 0;
  elements.clearHistoryButton.hidden = terminalCount === 0;
  const showArchiveControls =
    (currentJobStats?.totalCount ?? jobs.length) > 0 ||
    Boolean(elements.archiveSearch?.value.trim());
  elements.archiveControls.hidden = !showArchiveControls;
  elements.jobFilters.hidden = !showArchiveControls;
};

const renderJobs = (jobs) => {
  currentJobs = jobs;
  const activeSearch = elements.archiveSearch?.value.trim() ?? '';
  let pageState = getArchivePageState(
    jobs,
    currentQuickFilter,
    currentJobsPageInfo.hasMore,
    activeSearch
  );

  if (
    pendingSharedJobId &&
    jobs.some((job) => job.id === pendingSharedJobId) &&
    !pageState.visibleJobs.some((job) => job.id === pendingSharedJobId)
  ) {
    setQuickFilter('all');
    pageState = getArchivePageState(
      jobs,
      currentQuickFilter,
      currentJobsPageInfo.hasMore,
      activeSearch
    );
  }

  renderJobStats(jobs);

  const nodes = pageState.visibleJobs.map(createJobCard);
  if (nodes.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `<p>${escapeHtml(
      activeSearch || currentQuickFilter === 'all'
        ? getEmptyStateMessage(activeSearch)
        : pageState.canLoadMore
          ? '目前載入的紀錄沒有符合項目，可繼續載入更多。'
          : '目前沒有符合這個篩選條件的工作。'
    )}</p>`;
    nodes.push(emptyState);
  }

  if (pageState.canLoadMore) {
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

  const replaceJobs = () => elements.jobList.replaceChildren(...nodes);
  const finishRender = () => {
    focusSharedJobIfNeeded();
    elements.jobList.setAttribute('aria-busy', 'false');
  };
  if (typeof document.startViewTransition === 'function' && !prefersReducedMotion()) {
    const transition = document.startViewTransition(replaceJobs);
    return transition.updateCallbackDone.then(finishRender);
  }

  replaceJobs();
  finishRender();
  return Promise.resolve();
};

const fetchConfig = async () => {
  const response = await apiFetch('/api/operator/config');
  if (!response.ok) {
    throw new Error(`無法載入操作設定 (HTTP ${response.status})`);
  }
  const payload = await response.json();
  operatorConfig = payload;
  applyTwdPricingReference(payload.pricingReference);
  applyDefaultJoinNameToForm();
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

const fetchJobsPayload = async ({ append = false, pageSize } = {}) => {
  const url = new URL('/api/operator/jobs', window.location.origin);
  url.searchParams.set('submitterId', currentSubmitterId);
  const searchQuery = elements.archiveSearch?.value.trim();

  if (searchQuery) {
    url.searchParams.set('q', searchQuery);
  } else {
    url.searchParams.set('pageSize', String(pageSize || currentJobsPageInfo.pageSize || 25));
    if (append && currentJobsPageInfo.nextCursor) {
      url.searchParams.set('cursor', currentJobsPageInfo.nextCursor);
    }
  }

  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch jobs: ${response.status}`);
  }

  return response.json();
};

const fetchJobs = async ({ append = false, ready = Promise.resolve() } = {}) => {
  const requestGeneration = ++jobsRequestGeneration;
  elements.jobList.setAttribute('aria-busy', 'true');

  try {
    const [payload] = await Promise.all([fetchJobsPayload({ append }), ready]);
    if (requestGeneration !== jobsRequestGeneration) {
      return;
    }

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
    await renderJobs(currentJobs);
  } catch (error) {
    if (requestGeneration === jobsRequestGeneration) {
      throw error;
    }
  } finally {
    if (requestGeneration === jobsRequestGeneration) {
      elements.jobList.setAttribute('aria-busy', 'false');
    }
  }
};

const fetchJobSnapshot = async (jobId) => {
  const url = new URL(`/api/operator/jobs/${jobId}`, window.location.origin);
  url.searchParams.set('submitterId', currentSubmitterId);

  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch job details: ${response.status}`);
  }

  return response.json();
};

const refreshJobsView = async (jobId) => {
  if (!meetingDetailJobId) {
    await fetchJobs();
    return;
  }

  const payload = await fetchJobSnapshot(jobId);
  const meetingTitle = sanitizeAnonymousSpeakerLabels(
    payload.summaryArtifact?.structured?.title ||
      payload.uploadedFileName ||
      '會議紀錄'
  );
  document.title = `${meetingTitle}｜Solomon NoteTaker`;
  document.querySelector('#dashboard-title').textContent = meetingTitle;
  document.querySelector('.dashboard-topbar-text').textContent = payload.uploadedFileName
    ? `${payload.uploadedFileName} · 完整摘要與逐字稿`
    : '完整摘要與逐字稿';
  currentJobs = [payload];
  currentJobStats = {
    totalCount: 1,
    activeCount: activeStates.has(payload.state) ? 1 : 0,
    queuedCount: payload.state === 'queued' ? 1 : 0,
    completedCount: payload.state === 'completed' ? 1 : 0,
    failedCount: payload.state === 'failed' ? 1 : 0
  };
  await renderJobs(currentJobs);
};

const updateJobCardProgress = (job) => {
  const card = elements.jobList.querySelector(`[data-job-id="${job.id}"]`);
  const progressBlock = card?.querySelector('.progress-block');

  if (!card || !progressBlock) {
    return false;
  }

  const viewModel = getJobCardViewModel(job);
  const progressDuration =
    typeof viewModel.progressProcessedMs === 'number' && typeof viewModel.progressTotalMs === 'number'
      ? `${formatDuration(viewModel.progressProcessedMs)} / ${formatDuration(viewModel.progressTotalMs)}`
      : '';
  const badge = card.querySelector('.badge');
  const progressBar = progressBlock.querySelector('.progress-bar');
  const progressMeta = progressBlock.querySelector('.progress-meta');
  let duration = progressBlock.querySelector('.progress-duration');

  card.querySelector('.job-status-summary').textContent = viewModel.statusSummary;
  card.querySelector('[data-job-updated-at]').textContent = viewModel.updatedAtText;
  progressBlock.querySelector('.progress-label').textContent = viewModel.progressLabel;
  progressBlock.querySelector('.progress-percent').textContent = `${viewModel.progressPercent}%`;
  badge.textContent = viewModel.badgeLabel;
  badge.className = `badge ${statusClass(viewModel.badgeTone)}`;
  progressBar.className = `progress-bar ${viewModel.progressTone}`;
  progressBar.setAttribute('aria-valuenow', String(viewModel.progressPercent));
  progressBar.setAttribute('aria-valuetext', `${viewModel.progressLabel} ${viewModel.progressPercent}%`);
  progressBar.firstElementChild.style.width = `${viewModel.progressPercent}%`;

  if (progressDuration) {
    if (!duration) {
      duration = document.createElement('p');
      duration.className = 'progress-duration';
      progressMeta.after(duration);
    }
    duration.textContent = progressDuration;
  } else {
    duration?.remove();
  }

  return true;
};

const applyPolledJob = (snapshot) => {
  const index = currentJobs.findIndex((job) => job.id === snapshot.id);
  if (index < 0) {
    return;
  }

  const previous = currentJobs[index];
  const job = {
    ...snapshot,
    transcriptArtifact: previous.transcriptArtifact,
    summaryArtifact: previous.summaryArtifact
  };
  const previousViewModel = getJobCardViewModel(previous);
  const nextViewModel = getJobCardViewModel(job);
  const cardMetadataChanged =
    previousViewModel.durationValue !== nextViewModel.durationValue ||
    JSON.stringify(previousViewModel.costItems) !== JSON.stringify(nextViewModel.costItems);
  const artifactAvailabilityChanged =
    previous.hasTranscript !== job.hasTranscript ||
    previous.hasSummary !== job.hasSummary;
  currentJobs[index] = job;

  if (
    previous.state !== job.state ||
    previous.displayState !== job.displayState ||
    cardMetadataChanged ||
    artifactAvailabilityChanged ||
    !updateJobCardProgress(job)
  ) {
    const card = elements.jobList.querySelector(`[data-job-id="${job.id}"]`);
    card?.replaceWith(createJobCard(job));
  }
};

const refreshJobProgress = async () => {
  if (
    document.hidden ||
    progressPollInFlight ||
    elements.jobList.getAttribute('aria-busy') === 'true'
  ) {
    return;
  }

  const pendingJobIds = new Set(
    currentJobs.filter((job) => !isTerminalJob(job)).map((job) => job.id)
  );
  if (pendingJobIds.size === 0) {
    return;
  }

  progressPollInFlight = true;
  try {
    if (meetingDetailJobId) {
      await refreshJobsView(meetingDetailJobId);
      return;
    }

    const requestGeneration = jobsRequestGeneration;
    const payload = await fetchJobsPayload({
      pageSize: Math.min(100, Math.max(currentJobsPageInfo.pageSize || 25, currentJobs.length))
    });
    if (requestGeneration !== jobsRequestGeneration) {
      return;
    }
    payload.jobs
      .filter((job) => pendingJobIds.has(job.id))
      .forEach(applyPolledJob);
    currentJobStats = payload.stats || currentJobStats;
    renderJobStats(currentJobs);
  } catch {
    // Keep the current view stable; the next poll will retry the transient read.
  } finally {
    progressPollInFlight = false;
  }
};

const submitMeetingJob = async (event) => {
  event?.preventDefault?.();
  if (elements.meetingForm.getAttribute('aria-busy') === 'true') {
    return;
  }

  setFormBusy(elements.meetingForm, elements.meetingSubmitButton, true);
  setFormStatus(elements.meetingFormStatus, '正在送出會議...');

  try {
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
        meetingPasscode: formData.get('meetingPasscode'),
        submissionTemplateId: selectedTemplateId
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? `Meeting submission failed: ${response.status}`);
    }

    setFormStatus(elements.meetingFormStatus, '會議已加入整理流程。');
    elements.meetingForm.reset();
    applyDefaultJoinNameToForm();
    await fetchJobs();
  } finally {
    setFormBusy(elements.meetingForm, elements.meetingSubmitButton, false);
  }
};

const applyQueryPrefill = () => {
  const prefill = getDashboardPrefill(window.location.href, operatorConfig.defaultJoinName);
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
    setFormStatus(elements.uploadFormStatus, '請先選擇音訊或影片檔。', 'error');
    return;
  }

  uploadInFlight = true;
  setFormBusy(elements.uploadForm, elements.uploadSubmitButton, true);
  setFormStatus(elements.uploadFormStatus, '正在上傳錄音檔...');

  try {
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
      throw new Error(payload?.error?.message ?? `Upload failed: ${response.status}`);
    }

    setFormStatus(elements.uploadFormStatus, '錄音檔已加入整理流程。');
    elements.uploadForm.reset();
    resetUploadSelectionUi();
    await fetchJobs();
  } finally {
    uploadInFlight = false;
    setFormBusy(elements.uploadForm, elements.uploadSubmitButton, false);
  }
};

const boot = async () => {
  try {
    const configPromise = fetchConfig();

    if (meetingDetailJobId) {
      await configPromise;
      document.querySelector('#dashboard-title').textContent = '完整會議紀錄';
      document.querySelector('.dashboard-topbar-text').textContent =
        '查看這筆工作的完整摘要、逐字稿與分享設定。';
      document.querySelector('.queue-header h2').textContent = '會議內容';
      document.querySelector('.queue-copy').textContent = '此頁只顯示目前這筆會議紀錄。';
      const adminLink = document.querySelector('#admin-entry-link');
      adminLink.href = '/';
      adminLink.querySelector('span').textContent = '回到工作台';
      await refreshJobsView(meetingDetailJobId);
      scrollToOwnerDeepLink();
      setBanner('');
      return;
    }

    const shouldAutoQueue = Boolean(
      new URL(window.location.href).searchParams.get('meetingUrl')?.trim()
    );
    if (!shouldAutoQueue) {
      await fetchJobs({ ready: configPromise });
      applyQueryPrefill();
      focusSharedJobIfNeeded();
      setBanner('');
      return;
    }

    await configPromise;
    const prefill = applyQueryPrefill();
    if (prefill.shouldAutoQueue) {
      await submitMeetingJob();
      window.history.replaceState({}, document.title, window.location.pathname);
      setBanner('已依照網址參數自動送出會議。');
      return;
    }
  } catch (error) {
    elements.jobList.setAttribute('aria-busy', 'false');
    elements.jobList.innerHTML =
      '<div class="empty-state"><p>無法載入會議筆記。請稍後重新整理頁面。</p></div>';
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  }
};

elements.meetingForm.addEventListener('submit', async (event) => {
  try {
    await submitMeetingJob(event);
  } catch (error) {
    setFormStatus(
      elements.meetingFormStatus,
      error instanceof Error ? error.message : String(error),
      'error'
    );
  }
});

elements.uploadForm.addEventListener('submit', async (event) => {
  try {
    await submitUploadJob(event);
  } catch (error) {
    setFormStatus(
      elements.uploadFormStatus,
      error instanceof Error ? error.message : String(error),
      'error'
    );
  }
});

elements.audioFile.addEventListener('change', async () => {
  const file = elements.audioFile.files?.[0];

  if (!file) {
    resetUploadSelectionUi();
    return;
  }

  showSelectedUploadFile(file);
  setFormStatus(elements.uploadFormStatus, '');
});

elements.clearHistoryButton.addEventListener('click', async () => {
  if (elements.clearHistoryButton.disabled) {
    return;
  }

  const confirmed = window.confirm(
    '要清除所有已完成與失敗的歷史紀錄及錄音物件嗎？逐字稿與摘要仍會保留供管理稽核。'
  );
  if (!confirmed) {
    return;
  }

  try {
    setBanner('正在清除歷史紀錄...');
    const result = await clearHistory();
    setBanner(
      `已清除 ${result.deletedCount} 筆歷史紀錄與 ${result.artifactCleanup.objectCount} 個儲存物件。`
    );
    await fetchJobs();
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  }
});

let archiveSearchDebounceTimer;
elements.archiveSearch?.addEventListener('input', () => {
  // Debounce keystrokes so a fast typist doesn't fire one /api/operator/jobs request
  // per character (which also race: the last response to arrive wins regardless of order).
  clearTimeout(archiveSearchDebounceTimer);
  archiveSearchDebounceTimer = setTimeout(() => {
    fetchJobs().catch((error) => {
      setBanner(error instanceof Error ? error.message : String(error), 'error');
    });
  }, 300);
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
  renderJobs(currentJobs);
});

window.setInterval(() => {
  void refreshJobProgress();
}, PROGRESS_POLL_INTERVAL_MS);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    void refreshJobProgress();
  }
});

boot();
