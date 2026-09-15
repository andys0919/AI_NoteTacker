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

  // Detail pages show both panels side by side on wide screens; the tabs then only
  // matter once the viewport is narrow again. Toggling `hidden` here (not in CSS)
  // keeps the hidden-panel transition styles from leaving a blank column.
  // The reader carries its own split marker, so this works before the card is even
  // attached to the page. (Asking the ancestors used to fail exactly there: the owner
  // page wires the card first and appends it after, `closest` saw no page class, and
  // the wide layout never switched on - the transcript panel simply stayed hidden.)
  const splitQuery =
    tablist.closest?.('.artifact-reader--split') && typeof window !== 'undefined'
      ? window.matchMedia?.('(min-width: 1280px)')
      : null;
  const applySplit = () => {
    if (!splitQuery) {
      return;
    }
    if (splitQuery.matches) {
      tabs.forEach((tab) => {
        const panel = card.querySelector(`#${tab.getAttribute('aria-controls')}`);
        if (panel) {
          panel.hidden = false;
        }
      });
      tablist.hidden = true;
    } else {
      tablist.hidden = false;
      activate(tabs.find((tab) => tab.classList.contains('active')) ?? tabs[0]);
    }
  };
  applySplit();
  splitQuery?.addEventListener('change', applySplit);

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

// Only diarized transcripts (provider per-phrase labels, the worker's whole-recording pass,
// or the public projection's resolved labels) show a speaker. Older artifacts carry labels from the retired alignment-gated
// pipeline, which covered too few segments to be readable.
// An operator reassignment (by segment index) replaces the diarization label.
const readableSpeaker = (segment, index, segmentSpeakers) => {
  if (
    !segment ||
    segment.speakerSource !== 'provider-diarization' &&
    segment.speakerSource !== 'local-diarization' && segment.speakerSource !== 'public-resolved' ||
    !segment.speaker
  ) {
    return '';
  }
  const override = String(segmentSpeakers?.[String(index)] || '').trim();
  return override || String(segment.speaker).trim();
};

export const hasReadableSpeakers = (segments) =>
  (Array.isArray(segments) ? segments : []).some((segment) => readableSpeaker(segment));

// Speakers are numbered by first appearance so the chip tone and the summary strip
// agree; the number also cycles the monochrome tone variants defined in CSS.
const SPEAKER_TONE_COUNT = 6;

// `label` is the provider id ("Speaker 1") and stays the key for tones and renames;
// `name` is what the reader shows once an operator has named that voice.
export const listTranscriptSpeakers = (segments, speakerNames = {}, segmentSpeakers = {}) => {
  const speakers = new Map();
  (Array.isArray(segments) ? segments : []).forEach((segment, index) => {
    const label = readableSpeaker(segment, index, segmentSpeakers);
    // A segment the transcript will not render must not be counted either, or a chip
    // promises more lines than selecting it can show. Two deliberate consequences:
    // a voice is numbered and toned from its first VISIBLE line, so the strip follows
    // reading order, and talk time counts only speech the reader can actually see.
    if (!label || !getReadableTranscriptText(segment)) {
      return;
    }
    const entry = speakers.get(label) ?? {
      label,
      name: String(speakerNames?.[label] || '').trim() || label,
      index: speakers.size + 1,
      tone: (speakers.size % SPEAKER_TONE_COUNT) + 1,
      talkMs: 0,
      segmentCount: 0
    };
    entry.talkMs += Math.max(0, Number(segment.endMs) - Number(segment.startMs)) || 0;
    entry.segmentCount += 1;
    speakers.set(label, entry);
  });
  return [...speakers.values()];
};

// In editable mode the chip is a button: click it anywhere (legend or a turn) to
// rename that voice everywhere. Read-only pages get a plain span.
const renderSpeakerChip = (name, tone, editableLabel = '') =>
  editableLabel
    ? `<button type="button" class="transcript-speaker transcript-speaker--editable" data-speaker-tone="${tone}" data-rename-label="${escapeHtml(editableLabel)}" title="點一下改名">${escapeHtml(name)}</button>`
    : `<span class="transcript-speaker" data-speaker-tone="${tone}">${escapeHtml(name)}</span>`;

// Per-segment playback: the button carries the span in seconds; the owner and public
// pages wire it to one native <audio> element when authenticated media is available.
const renderPlayButton = (startMs, endMs) =>
  `<button
      type="button"
      class="transcript-play"
      data-play-start="${(Number(startMs) || 0) / 1000}"
      data-play-end="${(Number(endMs) || 0) / 1000}"
      aria-label="播放此段 ${formatTranscriptTime(startMs)}"
      aria-pressed="false"
    ><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg></button>`;

const renderLegacyTranscript = (segments, playable) =>
  segments
    .map((segment) => {
      const readableText = getReadableTranscriptText(segment);

      if (!readableText) {
        return '';
      }

      return `
        <article class="transcript-segment">
          <div class="transcript-segment-context">
            <span class="transcript-time">${formatTranscriptTime(segment.startMs)}</span>
            ${playable ? renderPlayButton(segment.startMs, segment.endMs) : ''}
          </div>
          <div class="transcript-segment-body">
            <p class="transcript-segment-text">${escapeHtml(readableText)}</p>
          </div>
        </article>
      `;
    })
    .join('');

// Consecutive lines from one speaker form one turn: the chip and start time are shown
// once, each provider phrase stays its own line so timestamps remain addressable.
const renderSpeakerTurns = (segments, { speakerNames, segmentSpeakers, playable, editable }) => {
  const voices = new Map(
    listTranscriptSpeakers(segments, speakerNames, segmentSpeakers).map((speaker) => [
      speaker.label,
      speaker
    ])
  );
  const turns = [];
  segments.forEach((segment, index) => {
    const readableText = getReadableTranscriptText(segment);
    if (!readableText) {
      return;
    }
    const speaker = readableSpeaker(segment, index, segmentSpeakers);
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) {
      last.lines.push({ startMs: segment.startMs, text: readableText });
      last.indices.push(index);
      last.endMs = Math.max(last.endMs, Number(segment.endMs) || 0);
    } else {
      turns.push({
        speaker,
        startMs: segment.startMs,
        endMs: Number(segment.endMs) || 0,
        indices: [index],
        lines: [{ startMs: segment.startMs, text: readableText }]
      });
    }
  });

  return turns
    .map((turn) => {
      const voice = voices.get(turn.speaker);
      const chip = voice ? renderSpeakerChip(voice.name, voice.tone, editable ? voice.label : '') : '';
      const lines = turn.lines
        .map(
          (line) =>
            `<p class="transcript-segment-text" data-start-ms="${Number(line.startMs) || 0}">${escapeHtml(line.text)}</p>`
        )
        .join('');
      return `
        <article class="transcript-segment transcript-turn" data-speaker-label="${escapeHtml(turn.speaker)}">
          <div class="transcript-segment-context">
            <span class="transcript-time">${formatTranscriptTime(turn.startMs)}</span>
            ${chip}
            ${playable ? renderPlayButton(turn.startMs, turn.endMs) : ''}
          </div>
          <div class="transcript-segment-body">
            ${lines}
          </div>
        </article>
      `;
    })
    .join('');
};

export const renderTranscriptMarkup = (
  segments,
  { speakerNames, segmentSpeakers, playable = false, editable = false } = {}
) => {
  const list = Array.isArray(segments) ? segments : [];
  return hasReadableSpeakers(list)
    ? renderSpeakerTurns(list, { speakerNames, segmentSpeakers, playable, editable })
    : renderLegacyTranscript(list, playable);
};

// Attribute-selector escaping that also works where CSS.escape is missing (old
// browsers, and the node environment the reader is unit-tested in).
const cssEscape = (value) =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : String(value).replace(/["\\]/g, '\\$&');

// Following one voice through a long meeting: the chips hide everyone else's turns.
// It is a view state only — the artifact, the exports and the speaker edits are
// untouched — so the status line says how much of the transcript is on screen.
// Nothing to choose between with one voice, so one-speaker and legacy transcripts
// get no strip at all.
export const renderSpeakerFilterMarkup = (
  segments,
  { speakerNames, segmentSpeakers } = {}
) => {
  const list = Array.isArray(segments) ? segments : [];
  if (!hasReadableSpeakers(list)) {
    return '';
  }
  const speakers = listTranscriptSpeakers(list, speakerNames, segmentSpeakers);
  if (speakers.length < 2) {
    return '';
  }
  const total = speakers.reduce((sum, speaker) => sum + speaker.segmentCount, 0);
  const chip = (label, name, count, tone, active) => `
        <button
          type="button"
          class="transcript-filter-chip${active ? ' is-active' : ''}"
          data-speaker-filter="${escapeHtml(label)}"
          ${tone ? `data-speaker-tone="${tone}"` : ''}
          aria-pressed="${active}"
          aria-label="${escapeHtml(name)}，${count} 段"
          title="${escapeHtml(name)}"
        ><span class="transcript-filter-name">${escapeHtml(name)}</span><span class="transcript-filter-count">${count}</span></button>`;
  return `
      <div class="transcript-filter" role="group" aria-label="依說話者篩選逐字稿">
        ${chip('', '全部', total, 0, true)}
        ${speakers
          .map((speaker) =>
            chip(speaker.label, speaker.name, speaker.segmentCount, speaker.tone, false)
          )
          .join('')}
      </div>
      <p class="transcript-filter-status" role="status" aria-atomic="true" data-transcript-filter-status>顯示全部 ${total} 段</p>`;
};

// Chips only toggle `hidden` on turns: no re-render, so playback, rename and the
// scroll position all survive a filter change.
export const wireSpeakerFilter = (card) => {
  const group = card?.querySelector('.transcript-filter');
  const reader = card?.querySelector('.transcript-reader');
  if (!group || !reader) {
    return;
  }
  const status = card.querySelector('[data-transcript-filter-status]');
  const chips = [...group.querySelectorAll('[data-speaker-filter]')];
  const turns = [...reader.querySelectorAll('[data-speaker-label]')];

  const apply = (label) => {
    let shown = 0;
    turns.forEach((turn) => {
      const matches = !label || turn.dataset.speakerLabel === label;
      turn.hidden = !matches;
      if (matches) {
        shown += turn.querySelectorAll('.transcript-segment-text').length;
      }
    });
    chips.forEach((chip) => {
      const active = chip.dataset.speakerFilter === label;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
    });
    group.dataset.activeSpeakerFilter = label;
    if (status) {
      const name = label
        ? group.querySelector(`[data-speaker-filter="${cssEscape(label)}"] .transcript-filter-name`)
            ?.textContent || label
        : '';
      const total = chips[0]?.querySelector('.transcript-filter-count')?.textContent || shown;
      status.textContent = label
        ? `只顯示 ${name} 的 ${shown} 段，共 ${total} 段`
        : `顯示全部 ${shown} 段`;
    }
  };

  group.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-speaker-filter]');
    if (chip) {
      apply(chip.dataset.speakerFilter);
    }
  });
};

const toReaderDomId = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '-');

// The complete meeting reader (summary + transcript tabs, participants strip, player,
// per-turn controls). Shared by the owner dashboard and the admin result page so both
// show exactly the same thing; `mediaUrl` and `editable` are what differ per page.
// Download + copy-all in a panel header; the page decides how the export is fetched.
const renderPanelTools = (part, label) =>
  `<div class="artifact-panel-tools">
     <button type="button" class="mini-button export" data-export-part="${part}">${label}</button>
     <button type="button" class="mini-button export artifact-copy" data-copy-part="${part}" aria-label="複製全部${part === 'summary' ? '摘要' : '逐字稿'}" title="複製全部（同下載內容）">
       <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M5.5 2.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.5 5.5h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
     </button>
   </div>`;

// Clipboard write that also works on plain-http hosts, where navigator.clipboard is
// unavailable: fall back to a temporary textarea and the legacy copy command.
const copyTextToClipboard = async (text) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to the legacy path
    }
  }
  const scratch = document.createElement('textarea');
  scratch.value = text;
  scratch.setAttribute('readonly', '');
  scratch.style.position = 'fixed';
  scratch.style.opacity = '0';
  document.body.append(scratch);
  scratch.select();
  const copied = document.execCommand('copy');
  scratch.remove();
  if (!copied) {
    throw new Error('瀏覽器不允許複製到剪貼簿，請改用下載。');
  }
};

// Both panels open with the same header row — title and note on the left, the
// download on the right — so the two columns of the split view line up.
const renderPanelHeader = (headingTag, title, note, tools) => `
        <header class="artifact-panel-heading">
          <div>
            <${headingTag}>${title}</${headingTag}>
            <p>${note}</p>
          </div>
          ${tools}
        </header>`;

// What a re-render must not lose: the open tab and how far the transcript was
// scrolled. Pages capture it before refreshing after an edit and hand it back.
export const readReaderState = (card) => ({
  tab: card?.querySelector('[data-artifact-tab][aria-selected="true"]')?.dataset.artifactTab || '',
  transcriptScrollTop: card?.querySelector('.transcript-reader')?.scrollTop || 0,
  speakerFilter: card?.querySelector('.transcript-filter')?.dataset.activeSpeakerFilter || ''
});

export const restoreReaderState = (card, state) => {
  const reader = card?.querySelector('.transcript-reader');
  if (state?.speakerFilter) {
    // Re-apply through the chip so the pressed state, the status line and the hidden
    // turns cannot drift apart.
    card
      ?.querySelector(`.transcript-filter [data-speaker-filter="${cssEscape(state.speakerFilter)}"]`)
      ?.click();
  }
  if (reader && state?.transcriptScrollTop) {
    reader.scrollTop = state.transcriptScrollTop;
  }
};

export const renderArtifactReader = (
  job,
  { detailLayout = false, mediaUrl = '', playable: playableOverride, editable = false, exportable = false, selectedTab = '', readerId: readerIdOverride = '' } = {}
) => {
  const hasSummary = Boolean(job.summaryArtifact);
  const hasTranscript = Boolean(job.transcriptArtifact);

  if (!hasSummary && !hasTranscript) {
    return '';
  }

  const readerId = readerIdOverride ? toReaderDomId(readerIdOverride) : `artifact-${toReaderDomId(job.id)}`;
  const playable = playableOverride ?? Boolean(mediaUrl);
  const selectedKind =
    (selectedTab === 'transcript' && hasTranscript) || (selectedTab === 'summary' && hasSummary)
      ? selectedTab
      : hasSummary
        ? 'summary'
        : 'transcript';
  const panelHeading = detailLayout ? 'h2' : 'h4';
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
        ${renderPanelHeader(
          panelHeading,
          detailLayout ? '摘要' : '會議摘要',
          '依逐字稿整理，只顯示有內容的段落。',
          exportable ? renderPanelTools('summary', '下載摘要 MD') : ''
        )}
        ${
          job.summaryArtifact.structured
            ? renderStructuredSummaryMarkup(
                job.summaryArtifact.structured,
                `${readerId}-summary`,
                {
                  headingLevel: detailLayout ? 2 : 4,
                  showTitle: !detailLayout
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
    const { speakerNames, segmentSpeakers, segments } = job.transcriptArtifact;
    const transcriptMarkup = renderTranscriptMarkup(segments, {
      speakerNames,
      segmentSpeakers,
      playable,
      editable
    });
    const playerMarkup = playable
      ? `<audio class="transcript-audio" controls preload="none"${
          mediaUrl ? ` src="${escapeHtml(mediaUrl)}"` : ''
        } aria-label="會議錄音"></audio>`
      : '';
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
        ${renderPanelHeader(
          panelHeading,
          '逐字稿',
          `${segments.length} 段 · 保留時間與逐字內容`,
          exportable ? renderPanelTools('transcript', '下載逐字稿 MD（含姓名與時間）') : ''
        )}
        ${playerMarkup}
        ${renderSpeakerFilterMarkup(segments, { speakerNames, segmentSpeakers })}
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
    <section class="artifact-reader${detailLayout ? ' artifact-reader--split' : ''}" aria-label="會議內容閱讀器">
      <div class="artifact-tablist" role="tablist" aria-label="選擇會議內容" data-artifact-tabs>
        ${tabs.join('')}
      </div>
      ${panels.join('')}
    </section>
  `;
};

// Speaker edits (rename from the strip, reassign from a turn's select) go through the
// page-supplied `save(body)` so the owner and admin pages can authenticate differently.
export const wireSpeakerEdits = (card, job, { save, onSaved, notify }) => {
  const submit = async (body, successMessage) => {
    await save(body);
    await onSaved?.();
    notify?.(successMessage);
  };

  // Click a speaker chip → it turns into a text field in place. Enter saves the name
  // for that voice everywhere; Escape (or leaving it unchanged) puts the chip back.
  card.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-rename-label]');
    if (!chip || !card.contains(chip) || chip.dataset.editing) {
      return;
    }
    const label = chip.dataset.renameLabel;
    const currentName = chip.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'transcript-speaker-input';
    input.maxLength = 40;
    input.autocomplete = 'off';
    input.value = currentName === label ? '' : currentName;
    input.placeholder = label;
    input.setAttribute('aria-label', `${label} 的姓名`);
    chip.dataset.editing = 'true';
    chip.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;
    const restore = () => {
      if (!settled) {
        settled = true;
        delete chip.dataset.editing;
        input.replaceWith(chip);
      }
    };
    const commit = async () => {
      if (settled) {
        return;
      }
      const name = input.value.trim();
      if (name === (currentName === label ? '' : currentName)) {
        restore();
        return;
      }
      settled = true;
      input.disabled = true;
      try {
        await submit({ speakerNames: { [label]: name } }, name ? `已將 ${label} 命名為「${name}」。` : `已清除 ${label} 的姓名。`);
      } catch (error) {
        settled = false;
        input.disabled = false;
        restore();
        notify?.(error instanceof Error ? error.message : String(error), 'error');
      }
    };
    input.addEventListener('keydown', (keyEvent) => {
      if (keyEvent.key === 'Enter') {
        keyEvent.preventDefault();
        commit();
      } else if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        restore();
      }
    });
    input.addEventListener('blur', () => commit());
  });

};

// Saves a fetched file through a temporary link; the name comes from the response's
// Content-Disposition when present so both pages get the server's naming.
export const saveResponseAsFile = async (response, fallbackName) => {
  const disposition = response.headers.get('content-disposition') || '';
  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1] || match[2]) : fallbackName;
  const objectUrl = window.URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
};

// `fetchExport(part)` returns the Markdown export Response; download saves it as a
// file, copy puts the same text on the clipboard.
const wireExports = (card, { fetchExport, notify }) => {
  card.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-export-part], [data-copy-part]');
    if (!button || !card.contains(button)) {
      return;
    }
    const part = button.dataset.exportPart || button.dataset.copyPart;
    button.disabled = true;
    try {
      const response = await fetchExport(part);
      if (button.dataset.copyPart) {
        await copyTextToClipboard(await response.text());
        notify?.(part === 'summary' ? '摘要已複製到剪貼簿。' : '逐字稿已複製到剪貼簿。');
      } else {
        await saveResponseAsFile(response, `${part}.md`);
      }
    } catch (error) {
      notify?.(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      button.disabled = false;
    }
  });
};

export const wireArtifactReader = (card, job, handlers) => {
  configureSummaryNavigation(card);
  wireArtifactTabs(card);
  wireSpeakerFilter(card);
  wireTranscriptPlayback(
    card.querySelector('.transcript-reader'),
    card.querySelector('.transcript-audio')
  );
  if (handlers?.save) {
    // Hand the page the reader state so its refresh can land on the same tab/scroll.
    wireSpeakerEdits(card, job, {
      ...handlers,
      onSaved: handlers.onSaved ? () => handlers.onSaved(readReaderState(card)) : undefined
    });
  }
  if (handlers?.fetchExport) {
    wireExports(card, handlers);
  }
};

// Drives one <audio> element from the per-segment buttons inside `root`: click seeks
// to the span and plays, playback stops at the span's end, and the active turn is
// marked so the eye can follow the ear. Clicking the active button pauses.
export const wireTranscriptPlayback = (root, audio) => {
  if (!root || !audio) {
    return;
  }
  let stopAt = null;
  let activeButton = null;

  const setActive = (button) => {
    if (activeButton) {
      activeButton.setAttribute('aria-pressed', 'false');
      activeButton.closest('.transcript-segment')?.classList.remove('is-playing');
    }
    activeButton = button;
    if (activeButton) {
      activeButton.setAttribute('aria-pressed', 'true');
      activeButton.closest('.transcript-segment')?.classList.add('is-playing');
    }
  };

  const ready = () =>
    audio.readyState > 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          audio.addEventListener('loadedmetadata', resolve, { once: true });
          audio.load();
        });

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('.transcript-play');
    if (!button || !root.contains(button)) {
      return;
    }
    if (button === activeButton && !audio.paused) {
      audio.pause();
      return;
    }
    const start = Number(button.dataset.playStart) || 0;
    const end = Number(button.dataset.playEnd) || 0;
    setActive(button);
    stopAt = end > start ? end : null;
    try {
      await ready();
      audio.currentTime = start;
      await audio.play();
    } catch {
      setActive(null);
    }
  });

  audio.addEventListener('timeupdate', () => {
    if (stopAt !== null && audio.currentTime >= stopAt) {
      stopAt = null;
      audio.pause();
    }
  });
  audio.addEventListener('pause', () => setActive(null));
  audio.addEventListener('ended', () => setActive(null));

  // A recording that is gone (deleted, expired) must say so instead of leaving a
  // player that silently does nothing; the segment buttons go with it.
  audio.addEventListener('error', () => {
    setActive(null);
    audio.outerHTML =
      '<p class="transcript-audio-unavailable" role="status">錄音檔已不存在，無法播放。逐字稿仍可閱讀與編輯。</p>';
    root.querySelectorAll('.transcript-play').forEach((button) => {
      button.disabled = true;
      button.title = '錄音檔已不存在';
    });
  });
};
