import {
  configureSummaryNavigation,
  renderStructuredSummaryMarkup,
  renderTranscriptMarkup
} from './artifact-reader.js';

const content = document.querySelector('#shared-meeting-content');
const status = document.querySelector('#shared-meeting-status');
const title = document.querySelector('#shared-title');
const meta = document.querySelector('#shared-meta');
const summarySection = document.querySelector('#shared-summary');
const summaryContent = document.querySelector('#shared-summary-content');
const transcriptSection = document.querySelector('#shared-transcript');
const transcriptContent = document.querySelector('#shared-transcript-content');
let activeToken = '';
let loadGeneration = 0;

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
    link.setAttribute(
      'href',
      `#${encodeURIComponent(token)}::${encodeURIComponent(targetId)}`
    );
  });
};

const showUnavailable = () => {
  content.hidden = true;
  status.hidden = false;
  status.textContent = '這份共享會議紀錄目前無法查看。';
};

const renderSharedMeeting = (meeting, targetId) => {
  summarySection.hidden = true;
  transcriptSection.hidden = true;
  summaryContent.replaceChildren();
  transcriptContent.replaceChildren();
  title.textContent = meeting.title;
  document.title = `${meeting.title}｜共享會議紀錄`;
  meta.textContent = [
    new Intl.DateTimeFormat('zh-TW', {
      dateStyle: 'long',
      timeStyle: 'short'
    }).format(new Date(meeting.createdAt)),
    typeof meeting.durationMs === 'number' ? `長度 ${formatDuration(meeting.durationMs)}` : ''
  ]
    .filter(Boolean)
    .join(' · ');

  if (meeting.summary) {
    summarySection.hidden = false;
    if (meeting.summary.structured) {
      summaryContent.innerHTML = renderStructuredSummaryMarkup(
        meeting.summary.structured,
        'shared-summary',
        { headingLevel: 3 }
      );
      configureSummaryNavigation(summaryContent);
    } else {
      const paragraph = document.createElement('p');
      paragraph.className = 'shared-summary-overview';
      paragraph.textContent = meeting.summary.text;
      summaryContent.replaceChildren(paragraph);
    }
  }

  if (meeting.transcript?.segments?.length) {
    transcriptSection.hidden = false;
    transcriptContent.innerHTML = renderTranscriptMarkup(meeting.transcript.segments);
  }

  prepareShareTargetLinks(activeToken);
  status.hidden = true;
  content.hidden = false;
  scrollToShareTarget(targetId);
};

const boot = async () => {
  const requestGeneration = ++loadGeneration;
  const { token } = readShareLocation();
  activeToken = token;
  if (!token) {
    showUnavailable();
    return;
  }

  prepareShareTargetLinks(token);
  content.hidden = true;
  status.hidden = false;
  status.textContent = '正在載入共享會議紀錄…';

  try {
    const response = await fetch('/api/shared-meeting', {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (requestGeneration !== loadGeneration) {
      return;
    }
    if (!response.ok) {
      showUnavailable();
      return;
    }

    const meeting = await response.json();
    if (requestGeneration !== loadGeneration) {
      return;
    }
    renderSharedMeeting(meeting, readShareLocation().targetId);
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
  const nextHash = `#${encodeURIComponent(activeToken)}::${encodeURIComponent(targetId)}`;
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

document.querySelector('#print-shared-meeting').addEventListener('click', () => window.print());
boot();
