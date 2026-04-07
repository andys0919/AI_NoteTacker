import { createOperatorAuthClient } from '/auth-client.js';
import { getDashboardPrefill } from '/dashboard-query.js';
import { getJobProgressModel } from '/job-progress.js';
import { getMeetingBotStatusCopy } from '/job-runtime-state.js';

const DEFAULT_OPERATOR_ID_KEY = 'solomon-notetaker-operator-id';

const elements = {
  authCopy: document.querySelector('#auth-copy'),
  authEmail: document.querySelector('#auth-email'),
  authForm: document.querySelector('#auth-form'),
  authOtp: document.querySelector('#auth-otp'),
  authPanel: document.querySelector('#auth-panel'),
  authSubmitButton: document.querySelector('#auth-submit-button'),
  dashboardGrid: document.querySelector('.dashboard-grid'),
  otpField: document.querySelector('#otp-field'),
  otpVerifyButton: document.querySelector('#otp-verify-button'),
  sessionCard: document.querySelector('#session-card'),
  sessionEmail: document.querySelector('#session-email'),
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
  clearHistoryButton: document.querySelector('#clear-history-button'),
  archiveSearch: document.querySelector('#archive-search')
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

const updateIdentityDisplay = () => {
  elements.submitterId.textContent = currentOperatorEmail || currentSubmitterId;
  elements.submitterIdLabel.textContent = authEnabled ? 'Operator Email' : 'Workspace ID';
  elements.sessionCard.hidden = !authEnabled || !currentOperatorEmail;
  elements.sessionEmail.textContent = currentOperatorEmail || '-';
};

const setAuthMode = (enabled) => {
  authEnabled = enabled;
  elements.authPanel.hidden = !enabled;
};

const syncOtpUi = () => {
  const hasPendingOtp = Boolean(authEnabled && !currentOperatorEmail && pendingAuthEmail);
  elements.otpField.hidden = !hasPendingOtp;
  elements.otpVerifyButton.hidden = !hasPendingOtp;
  elements.authSubmitButton.textContent = hasPendingOtp ? 'Resend Code' : 'Send Code';
  elements.authSubmitButton.formNoValidate = hasPendingOtp;
  elements.authEmail.value = pendingAuthEmail ?? elements.authEmail.value;
  elements.authEmail.disabled = hasPendingOtp;
  elements.authOtp.required = hasPendingOtp;
  elements.authCopy.textContent = hasPendingOtp
    ? `驗證碼已寄到 ${pendingAuthEmail}。請輸入信中的驗證碼完成登入。`
    : '輸入 email 後，系統會寄一組驗證碼到你的信箱。輸入驗證碼後，瀏覽器會記住登入狀態。';
};

const setDashboardInteractionEnabled = (enabled) => {
  const interactiveElements = [
    ...elements.meetingForm.querySelectorAll('input, button'),
    ...elements.uploadForm.querySelectorAll('input, button'),
    elements.clearHistoryButton,
    elements.archiveSearch
  ];

  interactiveElements.forEach((element) => {
    if (element) {
      element.disabled = !enabled;
    }
  });
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
  elements.uploadTitle.textContent = 'Drop audio here or click to browse';
  elements.uploadSubtitle.textContent = '支援音訊或錄音檔，會直接進 Whisper + Codex 流程。';
};

const formatFileSize = (bytes) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const showSelectedUploadFile = (file) => {
  elements.uploadTitle.textContent = file.name;
  elements.uploadSubtitle.textContent = `已選擇 ${formatFileSize(file.size)}，會立即開始上傳與轉錄。`;
};

const statusClass = (value) => value.toLowerCase();
const isTerminalJob = (job) => terminalStates.has(job.state);

const prettifySource = (job) =>
  job.inputSource === 'uploaded-audio' ? `Uploaded Audio: ${job.uploadedFileName}` : job.meetingUrl;

const prettifyProcessingStage = (value) =>
  (value || 'queued')
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

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
  const actions = [];

  if (job.inputSource === 'meeting-link' && (runtimeState === 'joining' || runtimeState === 'recording')) {
    actions.push(
      '<button class="mini-button danger" type="button" data-action="stop-current">Exit Meeting</button>'
    );
  }

  if ((job.state === 'queued' || job.state === 'transcribing') && !(job.inputSource === 'meeting-link' && (runtimeState === 'joining' || runtimeState === 'recording'))) {
    actions.push(
      '<button class="mini-button danger" type="button" data-action="interrupt-job">Interrupt Job</button>'
    );
  }

  if (isTerminalJob(job)) {
    actions.push(
      '<button class="mini-button history" type="button" data-action="delete-history">Delete History</button>'
    );
  }

  if (job.transcriptArtifact || job.summaryArtifact) {
    actions.push(
      '<button class="mini-button export" type="button" data-action="export-markdown">Export MD</button>'
    );
    actions.push(
      '<button class="mini-button export" type="button" data-action="export-txt">Export TXT</button>'
    );
    actions.push(
      '<button class="mini-button export" type="button" data-action="export-srt">Export SRT</button>'
    );
    actions.push(
      '<button class="mini-button export" type="button" data-action="export-json">Export JSON</button>'
    );
  }

  if (actions.length === 0) {
    return '';
  }

  return `<div class="job-actions">${actions.join('')}</div>`;
};

const createJobCard = (job) => {
  const card = document.createElement('article');
  card.className = 'job-card';

  const runtimeState = job.displayState || job.state;
  const activeBadge = statusClass(runtimeState);
  const progress = getJobProgressModel({
    inputSource: job.inputSource,
    state: job.state,
    displayState: runtimeState,
    processingStage: job.processingStage,
    progressPercent: job.progressPercent,
    progressProcessedMs: job.progressProcessedMs,
    progressTotalMs: job.progressTotalMs
  });
  const progressDuration =
    typeof progress.processedMs === 'number' && typeof progress.totalMs === 'number'
      ? `${formatDuration(progress.processedMs)} / ${formatDuration(progress.totalMs)}`
      : '';
  const summaryBlock = job.summaryArtifact
    ? `
      <details open>
        <summary>Codex Summary</summary>
        <pre class="summary-text">${job.summaryArtifact.text}</pre>
        ${
          job.summaryArtifact.structured
            ? `
              <div class="structured-summary">
                ${[
                  ['Action Items', job.summaryArtifact.structured.actionItems],
                  ['Decisions', job.summaryArtifact.structured.decisions],
                  ['Risks', job.summaryArtifact.structured.risks],
                  ['Open Questions', job.summaryArtifact.structured.openQuestions]
                ]
                  .map(
                    ([title, items]) => `
                      <div class="structured-section">
                        <h4>${title}</h4>
                        ${
                          items.length
                            ? `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`
                            : '<p>None.</p>'
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

  const transcriptPreview = job.transcriptArtifact
    ? `
      <details>
        <summary>Full Transcript</summary>
        <pre class="transcript-preview">${job.transcriptArtifact.segments
          .map((segment) => segment.text)
          .join('\n')}</pre>
      </details>
    `
    : '';

  const progressBlock =
    job.processingStage &&
    `
      <div class="artifact-block">
        <h3>Pipeline Progress</h3>
        <div class="progress-shell">
          <div class="progress-meta">
            <span>${progress.label}</span>
            <strong>${progress.percent}%</strong>
          </div>
          ${progressDuration ? `<p class="progress-duration">${progressDuration}</p>` : ''}
          <div class="progress-bar ${progress.tone}">
            <span style="width: ${progress.percent}%"></span>
          </div>
        </div>
        <p class="summary-text">${prettifyProcessingStage(job.processingStage)}${job.processingMessage ? `: ${job.processingMessage}` : ''}</p>
      </div>
    `;

  const failureBlock =
    job.failureMessage &&
    `
      <div class="artifact-block">
        <h3>Failure</h3>
        <p class="summary-text">${job.failureCode}: ${job.failureMessage}</p>
      </div>
    `;

  const botStatusCopy = getMeetingBotStatusCopy(job);
  const botStatusBlock =
    botStatusCopy &&
    `
      <div class="artifact-block bot-status-block">
        <h3>AI Bot</h3>
        <p class="summary-text">${botStatusCopy}</p>
      </div>
    `;

  const historyBlock =
    job.jobHistory?.length &&
    `
      <details class="timeline-block">
        <summary>Job Timeline (${job.jobHistory.length})</summary>
        <ol class="history-timeline">
          ${job.jobHistory
            .map(
              (entry) => `
                <li class="history-entry">
                  <div class="history-heading">
                    <strong>${prettifyProcessingStage(entry.stage)}</strong>
                    <span class="history-at">${new Date(entry.at).toLocaleString()}</span>
                  </div>
                  <p class="history-message">${entry.message}</p>
                </li>
              `
            )
            .join('')}
        </ol>
      </details>
    `;

  const actionBlock = createActionBlock(job, runtimeState);

  card.innerHTML = `
    <div class="job-head">
      <div>
        <h3 class="job-title">${job.inputSource === 'uploaded-audio' ? 'Audio Queue Job' : 'Meeting Queue Job'}</h3>
        <p class="job-meta">
          ${prettifySource(job)}<br />
          Join Name: ${job.requestedJoinName}<br />
          Created: ${new Date(job.createdAt).toLocaleString()}<br />
          Updated: ${new Date(job.updatedAt).toLocaleString()}
        </p>
      </div>
      <span class="badge ${activeBadge}">${runtimeState}</span>
    </div>
    ${actionBlock}
    ${botStatusBlock ?? ''}
    ${failureBlock ?? ''}
    ${progressBlock ?? ''}
    ${historyBlock ?? ''}
    ${summaryBlock}
    ${transcriptPreview}
  `;

  const stopButton = card.querySelector('[data-action="stop-current"]');
  if (stopButton) {
    stopButton.addEventListener('click', async () => {
      try {
        setBanner('Stopping current meeting bot...');
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
        setBanner('Current meeting bot stopped.');
        await fetchJobs();
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }

  const deleteButton = card.querySelector('[data-action="delete-history"]');
  if (deleteButton) {
    deleteButton.addEventListener('click', async () => {
      const confirmed = window.confirm('Delete this completed or failed job from your history?');
      if (!confirmed) {
        return;
      }

      try {
        setBanner('Deleting job history...');
        await deleteJob(job.id);
        setBanner('Job history deleted.');
        await fetchJobs();
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }

  const interruptButton = card.querySelector('[data-action="interrupt-job"]');
  if (interruptButton) {
    interruptButton.addEventListener('click', async () => {
      const confirmed = window.confirm('Interrupt this job now?');
      if (!confirmed) {
        return;
      }

      try {
        setBanner('Interrupting job...');
        await interruptJob(job.id);
        setBanner('Job interrupted.');
        await fetchJobs();
      } catch (error) {
        setBanner(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  }

  const exportFormats = {
    'export-markdown': 'markdown',
    'export-txt': 'txt',
    'export-srt': 'srt',
    'export-json': 'json'
  };

  Object.entries(exportFormats).forEach(([action, format]) => {
    const button = card.querySelector(`[data-action="${action}"]`);

    if (!button) {
      return;
    }

    button.addEventListener('click', async () => {
      try {
        setBanner(`Exporting ${format.toUpperCase()}...`);
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
  const activeCount = jobs.filter((job) => activeStates.has(job.state)).length;
  const queuedCount = jobs.filter((job) => job.state === 'queued').length;
  const terminalCount = jobs.filter((job) => isTerminalJob(job)).length;
  const activeSearch = elements.archiveSearch?.value.trim() ?? '';

  elements.activeCount.textContent = String(activeCount);
  elements.queuedCount.textContent = String(queuedCount);
  elements.clearHistoryButton.disabled = terminalCount === 0;

  if (jobs.length === 0) {
    elements.jobList.innerHTML = `
      <div class="empty-state">
        <p>${activeSearch ? `找不到符合「${activeSearch}」的工作。` : '目前還沒有工作。送出會議連結或上傳錄音後，狀態會顯示在這裡。'}</p>
      </div>
    `;
    return;
  }

  elements.jobList.replaceChildren(...jobs.map(createJobCard));
};

const fetchConfig = async () => {
  const response = await apiFetch('/api/operator/config');
  const payload = await response.json();
  elements.defaultJoinName.textContent = payload.defaultJoinName;
  elements.joinName.value = payload.defaultJoinName;
};

const fetchJobs = async () => {
  if (authEnabled && !currentOperatorEmail) {
    renderJobs([]);
    return;
  }

  const url = new URL('/api/operator/jobs', window.location.origin);
  url.searchParams.set('submitterId', currentSubmitterId);
  const searchQuery = elements.archiveSearch?.value.trim();

  if (searchQuery) {
    url.searchParams.set('q', searchQuery);
  }

  const response = await apiFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch jobs: ${response.status}`);
  }

  const payload = await response.json();
  renderJobs(payload.jobs);
};

const submitMeetingJob = async (event) => {
  event?.preventDefault?.();
  setBanner('Submitting meeting job...');

  const formData = new FormData(elements.meetingForm);
  const response = await apiFetch('/api/operator/jobs/meetings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      submitterId: currentSubmitterId,
      meetingUrl: formData.get('meetingUrl'),
      requestedJoinName: formData.get('requestedJoinName')
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Meeting submission failed: ${response.status}`);
  }

  setBanner('Meeting job queued.');
  elements.meetingForm.reset();
  elements.joinName.value = elements.defaultJoinName.textContent;
  await fetchJobs();
};

const applyQueryPrefill = () => {
  const prefill = getDashboardPrefill(window.location.href, elements.defaultJoinName.textContent);

  if (prefill.meetingUrl) {
    elements.meetingForm.elements.meetingUrl.value = prefill.meetingUrl;
  }

  if (prefill.requestedJoinName) {
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
    setBanner('Please choose an audio file first.', 'error');
    return;
  }

  uploadInFlight = true;
  setBanner('Uploading audio file...');

  const formData = new FormData();
  formData.set('submitterId', currentSubmitterId);
  formData.set('audio', elements.audioFile.files[0]);

  const response = await apiFetch('/api/operator/jobs/uploads', {
    method: 'POST',
    body: formData
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    uploadInFlight = false;
    throw new Error(payload?.error?.message ?? `Upload failed: ${response.status}`);
  }

  setBanner('Audio job queued.');
  elements.uploadForm.reset();
  resetUploadSelectionUi();
  uploadInFlight = false;
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

    if (authEnabled && !currentOperatorEmail) {
      setBanner('Please sign in with your email OTP before uploading or queueing jobs.');
      return;
    }

    const prefill = applyQueryPrefill();
    if (prefill.shouldAutoQueue) {
      await submitMeetingJob();
      window.history.replaceState({}, document.title, window.location.pathname);
      setBanner('Meeting job queued from URL parameters.');
      return;
    }
    await fetchJobs();
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
    setBanner('Sending verification code...');
    await authClient.requestEmailOtp(email);
    pendingAuthEmail = email;
    syncOtpUi();
    setBanner(`Verification code sent to ${email}.`, 'info');
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    elements.authSubmitButton.disabled = false;
  }
});

elements.otpVerifyButton.addEventListener('click', async () => {
  try {
    elements.otpVerifyButton.disabled = true;
    setBanner('Verifying code...');
    const user = await authClient.verifyEmailOtp(elements.authOtp.value.trim());
    setAuthenticatedView(user);
    elements.authOtp.value = '';
    setBanner('Signed in.');
    await fetchJobs();
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    elements.otpVerifyButton.disabled = false;
  }
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
    setBanner('Signed out.');
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

  try {
    await submitUploadJob(new Event('submit'));
  } catch (error) {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
    uploadInFlight = false;
  }
});

elements.clearHistoryButton.addEventListener('click', async () => {
  if (elements.clearHistoryButton.disabled) {
    return;
  }

  const confirmed = window.confirm('Clear all completed and failed jobs from your history?');
  if (!confirmed) {
    return;
  }

  try {
    setBanner('Clearing terminal job history...');
    const deletedCount = await clearHistory();
    setBanner(`Cleared ${deletedCount} historical job${deletedCount === 1 ? '' : 's'}.`);
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

boot();
window.setInterval(() => {
  if (authEnabled && !currentOperatorEmail) {
    return;
  }

  fetchJobs().catch((error) => {
    setBanner(error instanceof Error ? error.message : String(error), 'error');
  });
}, 5000);
