import { escapeHtml } from '/escape-html.js';
import {
  getEmptyStateMessage,
  getJobCardViewModel,
  renderOptionalMarkup
} from '/dashboard-copy.js';
import { getDashboardPrefill } from '/dashboard-query.js';
import {
  filterJobsByQuickFilter,
  getJobActionSet
} from '/dashboard-workflows.js';
import { renderTranscriptReviewMarkup } from '/transcript-review.js';

const DEFAULT_OPERATOR_ID_KEY = 'solomon-notetaker-operator-id';
const elements = {
  dashboardGrid: document.querySelector('.dashboard-grid'),
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

// 主頁以訪客模式運作（Email 登入已移除，管理功能改在 /admin）。
// 這兩個常數保留以維持下方工作流程的判斷式語意。
const authEnabled = false;
const currentOperatorEmail = null;
let currentSubmitterId = getOrCreateSubmitterId();
let uploadInFlight = false;
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
  elements.submitterId.textContent = '訪客模式';
  elements.submitterId.title = currentSubmitterId;
  elements.submitterIdLabel.textContent = '使用模式';
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

const setDashboardInteractionEnabled = (enabled) => {
  const interactiveElements = [
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

const apiFetch = async (input, init) => fetch(input, init);

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
        <pre class="summary-text">${escapeHtml(job.summaryArtifact?.text ?? job.summaryPreview)}</pre>
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
                            ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
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
        ${job.transcriptArtifact
          ? `<div class="transcript-preview">${renderTranscriptReviewMarkup(job.transcriptArtifact.segments)}</div>`
          : `<pre class="transcript-preview">${escapeHtml(job.transcriptPreview)}</pre>`}
      </details>
    `
    : '';

  const progressBlock =
    viewModel.showProgress &&
    `
      <div class="artifact-block progress-block">
        <div class="artifact-heading">
          <h3>目前進度</h3>
          <p>${escapeHtml(viewModel.statusSummary)}</p>
        </div>
        <div class="progress-shell">
          <div class="progress-meta">
            <span>${escapeHtml(viewModel.progressLabel)}</span>
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
          <p>${escapeHtml(viewModel.statusSummary)}</p>
        </div>
        ${job.failureCode ? `<p class="artifact-note">錯誤代碼：${escapeHtml(job.failureCode)}</p>` : ''}
      </div>
    `;

  const actionBlock = createActionBlock(job, viewModel.badgeTone);

  card.innerHTML = `
    <div class="job-head">
      <div>
        <p class="job-kicker">${viewModel.sourceLabel}</p>
        <h3 class="job-title">${viewModel.title}</h3>
        <p class="job-status-summary">${escapeHtml(viewModel.statusSummary)}</p>
      </div>
      <span class="badge ${escapeHtml(activeBadge)}">${escapeHtml(viewModel.badgeLabel)}</span>
    </div>
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
        <p>${escapeHtml(
          activeSearch || currentQuickFilter === 'all'
            ? getEmptyStateMessage(activeSearch)
            : '目前沒有符合這個篩選條件的工作。'
        )}</p>
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
  if (!response.ok) {
    throw new Error(`無法載入操作設定 (HTTP ${response.status})`);
  }
  const payload = await response.json();
  operatorConfig = payload;
  applyDefaultJoinNameToForm();
  setDashboardInteractionEnabled(!authEnabled || Boolean(currentOperatorEmail));
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
      meetingPasscode: formData.get('meetingPasscode'),
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
  await fetchJobs();
};

const boot = async () => {
  try {
    updateIdentityDisplay();
    await fetchConfig();

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

elements.meetingForm.addEventListener('submit', async (event) => {
  try {
    await submitMeetingJob(event);
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
  fetchJobs().catch((error) => {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  });
});

// 自動輪詢已移除：原本每 5 秒呼叫 fetchJobs() 會整個 replaceChildren 重畫卡片，
// 導致「查看內容」展開的完整內容被收合、還原成預覽。工作進度改為在送出、上傳、
// 刪除、搜尋、篩選等操作後主動刷新；要看最新進度時重新整理頁面即可。
boot();
