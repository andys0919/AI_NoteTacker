import { escapeHtml } from './escape-html.js';

const anonymousSpeakerCode = String.raw`Speaker\s+<?[A-Z0-9]>?(?:\/<?[A-Z0-9]>?)*`;
const anonymousSpeakerLabelPattern = new RegExp(
  String.raw`\b${anonymousSpeakerCode}(?![A-Za-z0-9])`,
  'gi'
);
const anonymousSpeakerPrefixPattern = new RegExp(
  String.raw`^${anonymousSpeakerCode}\s*[:：]\s*`,
  'i'
);

export const sanitizeAnonymousSpeakerLabels = (value) =>
  String(value || '').replace(anonymousSpeakerLabelPattern, '與會者');

const summaryTopicStatusLabels = {
  confirmed: '已確認',
  mixed: '部分確認',
  open: '待確認'
};

const summaryText = (value) => escapeHtml(sanitizeAnonymousSpeakerLabels(value));
let summaryNavigationMediaQuery;
let summaryNavigationListenerBound = false;

const stableContentIdentity = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableContentIdentity).sort().join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${key}:${stableContentIdentity(entry)}`)
      .join(',')}}`;
  }
  return sanitizeAnonymousSpeakerLabels(value).normalize('NFKC').trim().toLowerCase();
};

const stableAnchorPart = (label, identity = label) => {
  const normalized = String(label || '').normalize('NFKC').trim().toLowerCase();
  const normalizedIdentity = String(identity || label || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  const slug =
    normalized
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item';
  let hash = 2166136261;
  for (const character of normalizedIdentity) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  }
  return `${slug}-${(hash >>> 0).toString(36)}`;
};

export const renderStructuredSummaryMarkup = (
  structured,
  idPrefix,
  { headingLevel = 4, showTitle = true } = {}
) => {
  const safeIdPrefix = String(idPrefix || 'summary').replace(/[^a-zA-Z0-9_-]/g, '-');
  const sectionHeadingLevel = [2, 3, 4].includes(headingLevel) ? headingLevel : 4;
  const sectionHeading = `h${sectionHeadingLevel}`;
  const topicHeading = `h${sectionHeadingLevel + 1}`;
  const subtopicHeading = `h${sectionHeadingLevel + 2}`;
  const usedIds = new Set();
  const reserveId = (baseId) => {
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return id;
  };
  const topics = (Array.isArray(structured.topics) ? structured.topics : [])
    .map((topic) => {
      const status = summaryTopicStatusLabels[topic.status] ? topic.status : 'open';
      const points = Array.isArray(topic.points) ? topic.points.filter(Boolean) : [];
      const rawSubtopics = (Array.isArray(topic.subtopics) ? topic.subtopics : [])
        .map((subtopic) => ({
          title: subtopic?.title,
          details: Array.isArray(subtopic?.details) ? subtopic.details.filter(Boolean) : []
        }))
        .filter((subtopic) => subtopic.title && subtopic.details.length);

      if (!topic.title || (!rawSubtopics.length && !points.length) || !topic.conclusion) {
        return null;
      }

      const topicId = reserveId(
        `${safeIdPrefix}-topic-${stableAnchorPart(
          sanitizeAnonymousSpeakerLabels(topic.title),
          stableContentIdentity({
            title: topic.title,
            conclusion: topic.conclusion,
            points,
            subtopics: rawSubtopics
          })
        )}`
      );
      // ponytail: byte-identical duplicates share semantics; persist source IDs only if they later need distinct links.
      const subtopics = rawSubtopics.map((subtopic) => ({
        ...subtopic,
        id: reserveId(
          `${topicId}-subtopic-${stableAnchorPart(
            sanitizeAnonymousSpeakerLabels(subtopic.title),
            stableContentIdentity(subtopic)
          )}`
        )
      }));

      return {
        id: topicId,
        title: topic.title,
        subtopics,
        markup: `
          <article
            class="summary-topic-card"
            id="${topicId}"
            tabindex="-1"
            aria-labelledby="${topicId}-title"
          >
            <header class="summary-topic-header">
              <${topicHeading} class="summary-topic-title" id="${topicId}-title">${summaryText(topic.title)}</${topicHeading}>
              <span class="summary-topic-status summary-topic-status-${status}">
                ${summaryTopicStatusLabels[status]}
              </span>
            </header>
            ${
              subtopics.length
                ? `
                  <div class="summary-subtopic-list">
                    ${subtopics
                      .map(
                        (subtopic) => `
                          <section
                            class="summary-subtopic"
                            id="${subtopic.id}"
                            tabindex="-1"
                            aria-labelledby="${subtopic.id}-title"
                          >
                            <${subtopicHeading} class="summary-subtopic-title" id="${subtopic.id}-title">${summaryText(subtopic.title)}</${subtopicHeading}>
                            <ul>${subtopic.details
                              .map((detail) => `<li>${summaryText(detail)}</li>`)
                              .join('')}</ul>
                          </section>
                        `
                      )
                      .join('')}
                  </div>
                `
                : `<ul>${points.map((point) => `<li>${summaryText(point)}</li>`).join('')}</ul>`
            }
            <p class="summary-topic-conclusion">
              <strong>結論：</strong>${summaryText(topic.conclusion)}
            </p>
          </article>
        `
      };
    })
    .filter(Boolean);

  const followUpGroups = (Array.isArray(structured.followUpGroups)
    ? structured.followUpGroups
    : []
  )
    .map((group) => ({
      title: group?.title,
      items: Array.isArray(group?.items) ? group.items.filter(Boolean) : []
    }))
    .filter((group) => group.title && group.items.length)
    .map((group) => ({
      ...group,
      id: reserveId(
        `${safeIdPrefix}-follow-up-${stableAnchorPart(
          sanitizeAnonymousSpeakerLabels(group.title),
          stableContentIdentity(group)
        )}`
      )
    }));
  const listSections = [
    {
      key: 'key-points',
      title: '會議重點',
      items: topics.length ? [] : structured.keyPoints
    },
    {
      key: 'action-items',
      title: '後續安排',
      items: followUpGroups.length ? [] : structured.actionItems
    },
    { key: 'decisions', title: '已確認決議', items: structured.decisions },
    { key: 'risks', title: '風險與提醒', items: structured.risks },
    { key: 'open-questions', title: '待確認問題', items: structured.openQuestions },
    { key: 'analysis', title: 'AI 分析', items: structured.analysisNotes }
  ]
    .map((section) => ({
      ...section,
      items: Array.isArray(section.items) ? section.items.filter(Boolean) : []
    }))
    .filter((section) => section.items.length);
  const sections = [];

  if (structured.summary) {
    sections.push({
      key: 'summary',
      title: '會議摘要',
      className: 'summary-overview',
      body: `
        ${
          showTitle && structured.title
            ? `<p class="summary-document-title">${summaryText(structured.title)}</p>`
            : ''
        }
        <p>${summaryText(structured.summary)}</p>
      `
    });
  }

  if (topics.length) {
    sections.push({
      key: 'notes',
      title: '會議紀要',
      className: 'summary-topics',
      children: topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        children: topic.subtopics
      })),
      body: `<div class="summary-topic-list">${topics.map((topic) => topic.markup).join('')}</div>`
    });
  }

  if (followUpGroups.length) {
    sections.push({
      key: 'follow-ups',
      title: '後續安排',
      className: 'summary-follow-ups',
      children: followUpGroups.map((group) => ({
        id: group.id,
        title: group.title
      })),
      body: followUpGroups
        .map(
          (group) => `
            <section
              class="summary-follow-up-group"
              id="${group.id}"
              tabindex="-1"
              aria-labelledby="${group.id}-title"
            >
              <${topicHeading} class="summary-topic-title" id="${group.id}-title">${summaryText(group.title)}</${topicHeading}>
              <ul>${group.items.map((item) => `<li>${summaryText(item)}</li>`).join('')}</ul>
            </section>
          `
        )
        .join('')
    });
  }

  listSections.forEach(({ key, title, items }) => {
    sections.push({
      key,
      title,
      className: 'structured-section',
      body: `<ul>${items.map((item) => `<li>${summaryText(item)}</li>`).join('')}</ul>`
    });
  });

  const linkedSections = sections.map((section) => ({
    ...section,
    id: reserveId(`${safeIdPrefix}-section-${section.key}`)
  }));
  const renderTocItems = (items) => `
    <ol>
      ${items
        .map(
          (item) => `
            <li>
              <a href="#${item.id}">${summaryText(item.title)}</a>
              ${item.children?.length ? renderTocItems(item.children) : ''}
            </li>
          `
        )
        .join('')}
    </ol>
  `;
  const sectionMarkup = linkedSections
    .map(
      (section) => `
        <section
          class="summary-article-section ${section.className}"
          id="${section.id}"
          tabindex="-1"
          aria-labelledby="${section.id}-title"
        >
          <${sectionHeading} class="summary-section-title" id="${section.id}-title">${section.title}</${sectionHeading}>
          ${section.body}
        </section>
      `
    )
    .join('');

  return `
    <div class="summary-reader-layout">
      ${
        linkedSections.length > 1 || linkedSections[0]?.children?.length
          ? `
            <nav class="summary-toc" aria-label="摘要目錄">
              <details class="summary-toc-disclosure" open>
                <summary>本頁內容</summary>
                ${renderTocItems(linkedSections)}
              </details>
            </nav>
          `
          : ''
      }
      <article class="structured-summary">${sectionMarkup}</article>
    </div>
  `;
};

export const configureSummaryNavigation = (root, isNarrow) => {
  const mediaQuery =
    isNarrow === undefined && typeof window !== 'undefined'
      ? (summaryNavigationMediaQuery ??= window.matchMedia?.('(max-width: 920px)'))
      : null;
  root.querySelectorAll('.summary-toc-disclosure').forEach((disclosure) => {
    disclosure.open = !(isNarrow ?? mediaQuery?.matches ?? false);
  });

  if (mediaQuery && !summaryNavigationListenerBound) {
    summaryNavigationListenerBound = true;
    mediaQuery.addEventListener('change', ({ matches }) => {
      document.querySelectorAll('.summary-toc-disclosure').forEach((disclosure) => {
        disclosure.open = !matches;
      });
    });
  }
};

const formatTranscriptTime = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minuteAndSecond = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return hours ? `${hours}:${minuteAndSecond}` : minuteAndSecond;
};

export const wireArtifactTabs = (card) => {
  const tablist = card.querySelector('[data-artifact-tabs]');
  if (!tablist) {
    return;
  }

  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const activate = (activeTab, moveFocus = false) => {
    tabs.forEach((tab) => {
      const selected = tab === activeTab;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = card.querySelector(`#${tab.getAttribute('aria-controls')}`);
      if (panel) {
        panel.hidden = !selected;
      }
    });
    if (moveFocus) {
      activeTab.focus();
    }
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activate(tab));
  });

  tablist.addEventListener('keydown', (event) => {
    const currentIndex = tabs.indexOf(event.target);
    if (currentIndex < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    activate(tabs[nextIndex], true);
  });
};

export const getReadableTranscriptText = (segment) => {
  const displayText = String(segment.displayText || segment.text || '').trim();
  const speakerLabel = String(segment.speaker || '').trim();
  const speakerPrefix = speakerLabel
    ? [`${speakerLabel}：`, `${speakerLabel}:`].find((prefix) => displayText.startsWith(prefix))
    : '';

  return speakerPrefix
    ? displayText.slice(speakerPrefix.length).trim()
    : displayText.replace(anonymousSpeakerPrefixPattern, '').trim();
};

export const renderTranscriptMarkup = (segments) =>
  (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const readableText = getReadableTranscriptText(segment);

      if (!readableText) {
        return '';
      }

      return `
        <article class="transcript-segment">
          <div class="transcript-segment-context">
            <span class="transcript-time">${formatTranscriptTime(segment.startMs)}</span>
          </div>
          <div class="transcript-segment-body">
            <p class="transcript-segment-text">${escapeHtml(readableText)}</p>
          </div>
        </article>
      `;
    })
    .join('');
