import {
  renderArtifactReader,
  restoreReaderState,
  wireArtifactReader
} from './artifact-reader.js';

const content = document.querySelector('#shared-meeting-content');
const status = document.querySelector('#shared-meeting-status');
const notice = document.querySelector('#shared-notice');
const title = document.querySelector('#shared-title');
const meta = document.querySelector('#shared-meta');
const readerSection = document.querySelector('#shared-reader');
let activeToken = '';
let loadGeneration = 0;
// Reader state captured before an edit-triggered reload, consumed by the next render.
let pendingReaderState = null;
const copyShareButton = document.querySelector('#copy-shared-meeting');
let sharedRecordingAbortController = null;
let sharedRecordingObjectUrl = '';
const adminJobId = window.location.pathname === '/admin/result'
  ? new URLSearchParams(window.location.search).get('jobId') : null;
// The owner note page is THIS page too: same shell, same header, same reader. The
// only visible difference is the back action, and the routes carry the operator's
// own identity instead of the admin session.
const ownerJobId = (() => {
  const match = window.location.pathname.match(/^\/notes\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
})();
const operatorId = ownerJobId
  ? window.localStorage.getItem('solomon-notetaker-operator-id') || ''
  : '';
const detailJobId = adminJobId || ownerJobId;
if (detailJobId) {
  // Result pages: going back is the primary action; the shared shell owns the action button.
  const print = document.querySelector('#print-shared-meeting');
  const back = document.createElement('a');
  back.href = adminJobId ? '/admin' : '/';
  back.className = 'mini-button';
  back.textContent = adminJobId ? '回後台' : '回工作台';
  print.replaceWith(back);
  if (copyShareButton) {
    copyShareButton.hidden = true;
  }
} else if (copyShareButton) {
  copyShareButton.hidden = false;
}

const formatDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const readShareLocation = () => {
  if (adminJobId) {
    return { token: window.localStorage.getItem('solomon-notetaker-admin-token')
        || window.sessionStorage.getItem('solomon-notetaker-admin-token')
        || '',
      targetId: window.location.hash.slice(1) };
  }
  if (ownerJobId) {
    // The operator id plays the token's role: it gates the fetch and is never shown.
    return { token: operatorId, targetId: window.location.hash.slice(1) };
  }
  const [encodedToken = '', encodedTarget = ''] = window.location.hash.slice(1).split('::', 2);
  try {
    return {
      token: decodeURIComponent(encodedToken),
      targetId: decodeURIComponent(encodedTarget)
    };
  } catch {
    return { token: '', targetId: '' };
  }
};

const scrollToShareTarget = (targetId) => {
  const target = targetId ? document.getElementById(targetId) : null;
  if (!target) {
    return;
  }

  document
    .querySelector('.summary-deep-link-target')
    ?.classList.remove('summary-deep-link-target');
  target.classList.add('summary-deep-link-target');
  target.scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
};

const prepareShareTargetLinks = (token) => {
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    const targetId = link.dataset.shareTarget || decodeURIComponent(link.hash.slice(1));
    link.dataset.shareTarget = targetId;
    // Only the public share page carries its auth in the hash; both result pages
    // (admin session, owner identity) authenticate elsewhere, so they keep a plain
    // hash and never write the token — the operator id especially — into an href.
    link.setAttribute(
      'href',
      detailJobId ? `#${targetId}` : `#${encodeURIComponent(token)}::${encodeURIComponent(targetId)}`
    );
  });
};

// The admin session is stored per device, so a new tab reuses it; the most common
// "unavailable" cause is therefore not being logged in on this machine at all.
const adminLoginUrl = () =>
  `/admin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;

const showUnavailable = (reason = 'unknown') => {
  content.hidden = true;
  status.hidden = false;
  if (ownerJobId) {
    status.replaceChildren();
    const message = document.createElement('p');
    message.textContent =
      reason === 'processing'
        ? '這場會議還在處理中，完成後這一頁就會顯示摘要與逐字稿。'
        : '這份筆記目前無法查看，可能還在處理中，或不屬於這台裝置的使用者。';
    const back = document.createElement('a');
    back.className = 'mini-button primary';
    back.href = '/';
    back.textContent = '回工作台查看進度';
    status.append(message, back);
    return;
  }
  if (!adminJobId) {
    status.textContent = '這份共享會議紀錄目前無法查看。';
    return;
  }
  status.replaceChildren();
  const message = document.createElement('p');
  message.textContent =
    reason === 'unauthorized'
      ? '這個分頁沒有管理者登入狀態（登入只在原本的分頁有效）。'
      : '這份結果目前無法查看，請確認管理者登入狀態及工作是否已完成。';
  const login = document.createElement('a');
  login.className = 'mini-button primary';
  login.href = adminLoginUrl();
  login.textContent = '登入後台並回到這份結果';
  status.append(message, login);
};

const showNotice = (message, kind = 'info') => {
  if (!notice) {
    return;
  }
  notice.hidden = false;
  notice.textContent = message;
  notice.dataset.kind = kind;
};

const copyTextToClipboard = async (value) => {
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
  if (!document.execCommand('copy')) {
    input.remove();
    throw new Error('瀏覽器不允許複製分享網址。');
  }
  input.remove();
};

const updateOwnerShareButton = (job) => {
  if (!copyShareButton || !ownerJobId) {
    return;
  }
  const eligible = job?.share?.eligible === true;
  copyShareButton.hidden = !eligible;
  if (!eligible) {
    return;
  }
  const label = job.share.status === 'active' ? '複製分享網址' : '發布並複製分享網址';
  copyShareButton.title = label;
  copyShareButton.querySelector('span')?.replaceChildren(label);
  copyShareButton.setAttribute('aria-label', label);
};

const publishOwnerShare = async () => {
  if (!copyShareButton || !ownerJobId || !operatorId) {
    return;
  }

  copyShareButton.disabled = true;
  try {
    const response = await fetch(
      '/api/operator/jobs/' + encodeURIComponent(ownerJobId) + '/share',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submitterId: operatorId })
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.token) {
      throw new Error(payload.error?.message || '無法建立分享網址。');
    }
    await copyTextToClipboard(window.location.origin + '/share#' + payload.token);
    copyShareButton.title = '複製分享網址';
    copyShareButton.querySelector('span')?.replaceChildren('複製分享網址');
    copyShareButton.setAttribute('aria-label', '複製分享網址');
    showNotice(
      '分享網址已複製；持有網址的人可以查看並轉寄。效期至 ' +
        new Date(payload.expiresAt).toLocaleString('zh-TW') +
        '。'
    );
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    copyShareButton.disabled = false;
  }
};

copyShareButton?.addEventListener('click', async () => {
  if (ownerJobId) {
    await publishOwnerShare();
    return;
  }
  try {
    await copyTextToClipboard(window.location.href);
    showNotice('分享網址已複製；持有網址的人可以查看並轉寄。');
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error), 'error');
  }
});

const setHeading = (pageTitle, createdAt, durationMs) => {
  title.textContent = pageTitle;
  document.title = `${pageTitle}｜${adminJobId ? '後台結果' : ownerJobId ? '會議筆記' : '共享會議紀錄'}`;
  meta.textContent = [
    new Intl.DateTimeFormat('zh-TW', {
      dateStyle: 'long',
      timeStyle: 'short'
    }).format(new Date(createdAt)),
    typeof durationMs === 'number' ? `長度 ${formatDuration(durationMs)}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
};

const releaseSharedRecording = () => {
  sharedRecordingAbortController?.abort();
  sharedRecordingAbortController = null;
  if (sharedRecordingObjectUrl) {
    window.URL.revokeObjectURL(sharedRecordingObjectUrl);
    sharedRecordingObjectUrl = '';
  }
};

const markSharedRecordingUnavailable = (root) => {
  const audio = root.querySelector('.transcript-audio');
  if (!audio) {
    return;
  }
  const message = document.createElement('p');
  message.className = 'transcript-audio-unavailable';
  message.setAttribute('role', 'status');
  message.textContent = '錄音檔已不存在，無法播放。逐字稿仍可閱讀。';
  audio.replaceWith(message);
  root.querySelectorAll('.transcript-play').forEach((button) => {
    button.disabled = true;
    button.title = '錄音檔已不存在';
  });
};

const loadSharedRecording = async (root, token, generation) => {
  const audio = root.querySelector('.transcript-audio');
  if (!audio) {
    return;
  }
  const controller = new AbortController();
  sharedRecordingAbortController?.abort();
  sharedRecordingAbortController = controller;
  try {
    const response = await fetch('/api/shared-meeting/media', {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`錄音檔載入失敗：${response.status}`);
    }
    const objectUrl = window.URL.createObjectURL(await response.blob());
    if (
      controller.signal.aborted ||
      generation !== loadGeneration ||
      token !== activeToken ||
      root !== readerSection
    ) {
      window.URL.revokeObjectURL(objectUrl);
      return;
    }
    if (root.querySelector('.transcript-audio') !== audio) {
      window.URL.revokeObjectURL(objectUrl);
      return;
    }
    if (sharedRecordingObjectUrl) {
      window.URL.revokeObjectURL(sharedRecordingObjectUrl);
    }
    sharedRecordingObjectUrl = objectUrl;
    audio.src = objectUrl;
  } catch {
    if (
      controller.signal.aborted ||
      generation !== loadGeneration ||
      token !== activeToken ||
      root !== readerSection
    ) {
      return;
    }
    markSharedRecordingUnavailable(root);
  } finally {
    if (sharedRecordingAbortController === controller) {
      sharedRecordingAbortController = null;
    }
  }
};

const renderSharedMeeting = (meeting, targetId) => {
  releaseSharedRecording();
  readerSection.hidden = true;
  readerSection.replaceChildren();
  setHeading(meeting.title, meeting.createdAt, meeting.durationMs);

  const readerJob = {
    id: 'shared-meeting',
    createdAt: meeting.createdAt,
    summaryArtifact: meeting.summary
      ? {
          text: meeting.summary.text || '',
          structured: meeting.summary.structured
        }
      : undefined,
    transcriptArtifact: meeting.transcript
      ? {
          segments: meeting.transcript.segments.map((segment) => ({
            ...segment,
            ...(segment.speaker ? { speakerSource: 'public-resolved' } : {})
          }))
        }
      : undefined
  };
  const markup = renderArtifactReader(readerJob, {
    detailLayout: true,
    playable: meeting.recordingAvailable === true,
    exportable: true,
    readerId: 'shared'
  });
  if (markup) {
    readerSection.innerHTML = markup;
    readerSection.hidden = false;
    wireArtifactReader(readerSection, readerJob, {
      fetchExport: async (part) => {
        const response = await fetch(
          `/api/shared-meeting/export?part=${encodeURIComponent(part)}`,
          { headers: { Authorization: `Bearer ${activeToken}` } }
        );
        if (!response.ok) {
          throw new Error(`匯出失敗：${response.status}`);
        }
        return response;
      },
      notify: showNotice
    });
    if (meeting.recordingAvailable === true) {
      void loadSharedRecording(readerSection, activeToken, loadGeneration);
    }
  }

  prepareShareTargetLinks(activeToken);
  status.hidden = true;
  content.hidden = false;
  scrollToShareTarget(targetId);
};

// One renderer for both result pages. Only the routes behind playback, speaker
// edits and exports differ: the admin session on /admin/result, the operator's own
// identity on /notes.
const detailRoutes = (jobId, token) =>
  adminJobId
    ? {
        media: `/api/admin/jobs/${encodeURIComponent(jobId)}/media?token=${encodeURIComponent(token)}`,
        speakers: `/api/admin/jobs/${encodeURIComponent(jobId)}/speakers`,
        exportPart: (part) =>
          `/api/admin/jobs/${encodeURIComponent(jobId)}/export?format=markdown&part=${encodeURIComponent(part)}`,
        headers: { Authorization: `Bearer ${token}` },
        body: (body) => body
      }
    : {
        media: `/api/operator/jobs/${encodeURIComponent(jobId)}/media?submitterId=${encodeURIComponent(operatorId)}`,
        speakers: `/api/operator/jobs/${encodeURIComponent(jobId)}/speakers`,
        exportPart: (part) =>
          `/api/operator/jobs/${encodeURIComponent(jobId)}/export?format=markdown&part=${encodeURIComponent(part)}&submitterId=${encodeURIComponent(operatorId)}`,
        headers: {},
        body: (body) => ({ submitterId: operatorId, ...body })
      };

const renderDetailJob = (job, token, targetId) => {
  const segments = job.transcriptArtifact?.segments ?? [];
  const durationMs = segments.length
    ? Math.max(...segments.map((segment) => segment.endMs)) -
      Math.min(...segments.map((segment) => segment.startMs))
    : undefined;
  setHeading(
    job.summaryArtifact?.structured?.title || job.uploadedFileName || '會議紀錄',
    job.createdAt,
    durationMs
  );
  updateOwnerShareButton(job);

  const routes = detailRoutes(job.id, token);
  const markup = renderArtifactReader(job, {
    detailLayout: true,
    // <audio> cannot send headers, so the media routes also accept the identity in
    // the query string.
    mediaUrl: job.recordingArtifact ? routes.media : '',
    editable: true,
    exportable: true,
    selectedTab: pendingReaderState?.tab || ''
  });
  if (!markup) {
    // The job exists but has no readable artifacts yet: it is still being processed.
    showUnavailable('processing');
    return;
  }
  readerSection.innerHTML = markup;
  readerSection.hidden = false;
  const readerState = pendingReaderState;
  pendingReaderState = null;
  wireArtifactReader(readerSection, job, {
    save: async (body) => {
      const response = await fetch(routes.speakers, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...routes.headers },
        body: JSON.stringify(routes.body(body))
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error?.message || '無法儲存說話者變更。');
      }
    },
    onSaved: async (state) => {
      pendingReaderState = state;
      await boot();
    },
    fetchExport: async (part) => {
      const response = await fetch(routes.exportPart(part), { headers: routes.headers });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error?.message || `匯出失敗：${response.status}`);
      }
      return response;
    },
    notify: showNotice
  });
  restoreReaderState(readerSection, readerState);

  prepareShareTargetLinks(activeToken);
  status.hidden = true;
  content.hidden = false;
  scrollToShareTarget(targetId);
};

const boot = async () => {
  if (!detailJobId) {
    releaseSharedRecording();
  }
  const requestGeneration = ++loadGeneration;
  const { token } = readShareLocation();
  activeToken = token;
  if (!token) {
    showUnavailable(adminJobId ? 'unauthorized' : 'unknown');
    return;
  }

  prepareShareTargetLinks(token);
  if (content.hidden) {
    status.hidden = false;
    status.textContent = '正在載入共享會議紀錄…';
  }

  try {
    const response = await fetch(
      adminJobId
        ? `/api/admin/jobs/${encodeURIComponent(adminJobId)}`
        : ownerJobId
          ? `/api/operator/jobs/${encodeURIComponent(ownerJobId)}?submitterId=${encodeURIComponent(operatorId)}`
          : '/api/shared-meeting',
      ownerJobId ? undefined : { headers: { Authorization: `Bearer ${token}` } }
    );
    if (requestGeneration !== loadGeneration) {
      return;
    }
    if (!response.ok) {
      showUnavailable(response.status === 401 || response.status === 403 ? 'unauthorized' : 'unknown');
      return;
    }

    const payload = await response.json();
    if (requestGeneration !== loadGeneration) {
      return;
    }
    if (detailJobId) {
      renderDetailJob(payload, token, readShareLocation().targetId);
    } else {
      renderSharedMeeting(payload, readShareLocation().targetId);
    }
  } catch {
    if (requestGeneration === loadGeneration) {
      showUnavailable();
    }
  }
};

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-share-target]');
  if (!link || !activeToken) {
    return;
  }

  const targetId = link.dataset.shareTarget;
  if (!document.getElementById(targetId)) {
    return;
  }

  event.preventDefault();
  const nextHash = detailJobId ? `#${targetId}`
    : `#${encodeURIComponent(activeToken)}::${encodeURIComponent(targetId)}`;
  if (window.location.hash === nextHash) {
    scrollToShareTarget(targetId);
  } else {
    window.location.hash = nextHash;
  }
});

window.addEventListener('hashchange', () => {
  const { token, targetId } = readShareLocation();
  if (token === activeToken) {
    scrollToShareTarget(targetId);
    return;
  }
  boot();
});

window.addEventListener('pagehide', releaseSharedRecording);
document.querySelector('#print-shared-meeting')?.addEventListener('click', () => window.print());
boot();
