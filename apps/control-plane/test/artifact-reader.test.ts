import { describe, expect, it } from 'vitest';

import {
  configureSummaryNavigation,
  renderArtifactReader,
  renderStructuredSummaryMarkup,
  renderSpeakerFilterMarkup,
  renderTranscriptMarkup,
  sanitizeAnonymousSpeakerLabels,
  readReaderState,
  wireArtifactTabs,
  wireSpeakerFilter,
  wireTranscriptPlayback
} from '../public/artifact-reader.js';

describe('artifact reader', () => {
  const filterSegments = [
    { startMs: 0, endMs: 4_000, text: '先看流程。', speaker: 'Speaker 1', speakerSource: 'local-diarization' },
    { startMs: 4_000, endMs: 5_000, text: '好。', speaker: 'Speaker 2', speakerSource: 'local-diarization' },
    { startMs: 5_000, endMs: 9_000, text: '再來呢？', speaker: 'Speaker 1', speakerSource: 'local-diarization' }
  ];

  it('offers one filter control per speaker plus an all-speakers control', () => {
    const markup = renderSpeakerFilterMarkup(filterSegments, {
      speakerNames: { 'Speaker 1': '王經理' }
    }).replace(/\s+/g, ' ');

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="依說話者篩選逐字稿"');
    // The all-speakers control is pressed to start and counts every segment.
    expect(markup).toContain('data-speaker-filter="" aria-pressed="true"');
    expect(markup).toContain('<span class="transcript-filter-name">全部</span><span class="transcript-filter-count">3</span>');
    // Speaker controls carry the display name, their own count and their tone.
    expect(markup).toContain('data-speaker-filter="Speaker 1" data-speaker-tone="1" aria-pressed="false"');
    expect(markup).toContain('<span class="transcript-filter-name">王經理</span><span class="transcript-filter-count">2</span>');
    expect(markup).toContain('data-speaker-filter="Speaker 2" data-speaker-tone="2"');
    expect(markup).toContain('顯示全部 3 段');
    expect(markup).toContain('role="status" aria-atomic="true"');
  });

  it('offers no filter when there is nothing to choose between', () => {
    expect(renderSpeakerFilterMarkup([filterSegments[0]])).toBe('');
    expect(renderSpeakerFilterMarkup([{ startMs: 0, endMs: 1_000, text: '一句。' }])).toBe('');
    expect(renderSpeakerFilterMarkup([])).toBe('');
  });

  it('tags every turn with its speaker so the filter can hide the others', () => {
    const markup = renderTranscriptMarkup(filterSegments, {});

    expect(markup).toContain('data-speaker-label="Speaker 1"');
    expect(markup).toContain('data-speaker-label="Speaker 2"');
  });

  it('hides the other speakers and reports what is left on screen', () => {
    const chips = [
      { filter: '', count: '3', pressed: 'true', classes: new Set(['is-active']) },
      { filter: 'Speaker 1', count: '2', pressed: 'false', classes: new Set() }
    ].map((chip) => ({
      dataset: { speakerFilter: chip.filter },
      classList: {
        toggle(name: string, on: boolean) {
          if (on) chip.classes.add(name);
          else chip.classes.delete(name);
        }
      },
      setAttribute(name: string, value: string) {
        if (name === 'aria-pressed') chip.pressed = value;
      },
      querySelector: (selector: string) =>
        selector === '.transcript-filter-count'
          ? { textContent: chip.count }
          : { textContent: chip.filter || '全部' },
      state: chip
    }));
    const turns = [
      { dataset: { speakerLabel: 'Speaker 1' }, hidden: false, querySelectorAll: () => [{}, {}] },
      { dataset: { speakerLabel: 'Speaker 2' }, hidden: false, querySelectorAll: () => [{}] }
    ];
    const status = { textContent: '' };
    const group = {
      dataset: {} as Record<string, string>,
      querySelectorAll: () => chips,
      querySelector: (selector: string) =>
        chips.find((chip) => selector.includes(`"${chip.dataset.speakerFilter}"`)) ?? null,
      listeners: {} as Record<string, (event: unknown) => void>,
      addEventListener(name: string, listener: (event: unknown) => void) {
        this.listeners[name] = listener;
      }
    };
    const card = {
      querySelector: (selector: string) => {
        if (selector === '.transcript-filter') return group;
        if (selector === '.transcript-reader') return { querySelectorAll: () => turns };
        if (selector === '[data-transcript-filter-status]') return status;
        return null;
      }
    };

    wireSpeakerFilter(card as never);
    group.listeners.click({ target: { closest: () => chips[1] } });

    expect(turns[0].hidden).toBe(false);
    expect(turns[1].hidden).toBe(true);
    expect(chips[0].state.pressed).toBe('false');
    expect(chips[1].state.pressed).toBe('true');
    expect(status.textContent).toBe('只顯示 Speaker 1 的 2 段，共 3 段');

    group.listeners.click({ target: { closest: () => chips[0] } });

    expect(turns[1].hidden).toBe(false);
    expect(status.textContent).toBe('顯示全部 3 段');
  });

  it('carries the selected speaker through the state a re-render restores', () => {
    const card = {
      querySelector: (selector: string) => {
        if (selector === '[data-artifact-tab][aria-selected="true"]') {
          return { dataset: { artifactTab: 'transcript' } };
        }
        if (selector === '.transcript-reader') return { scrollTop: 420 };
        if (selector === '.transcript-filter') {
          return { dataset: { activeSpeakerFilter: 'Speaker 2' } };
        }
        return null;
      }
    };

    expect(readReaderState(card as never)).toEqual({
      tab: 'transcript',
      transcriptScrollTop: 420,
      speakerFilter: 'Speaker 2'
    });
  });

  it('links every visible summary level through stable semantic escaped markup', () => {
    const markup = renderStructuredSummaryMarkup(
      {
        title: '流程 <檢查>',
        summary: '先確認依賴。',
        topics: [
          {
            title: '條碼流程',
            status: 'mixed',
            subtopics: [
              {
                title: '異常復原',
                details: ['掃描失敗後回到待機。']
              }
            ],
            conclusion: '仍待現場確認。'
          }
        ],
        followUpGroups: [
          {
            title: '復歸驗收',
            items: ['Andy 確認復歸流程。']
          }
        ],
        keyPoints: [],
        actionItems: [],
        decisions: [],
        risks: [],
        openQuestions: ['誰負責驗收？'],
        analysisNotes: []
      },
      'artifact-job-1-summary'
    );

    const topicTarget = markup.match(
      /href="#(artifact-job-1-summary-topic-[^"]+)"/
    )?.[1];
    const subtopicTarget = markup.match(
      /href="#(artifact-job-1-summary-topic-[^"]+-subtopic-[^"]+)"/
    )?.[1];
    const followUpTarget = markup.match(
      /href="#(artifact-job-1-summary-follow-up-[^"]+)"/
    )?.[1];

    expect(markup).toContain('href="#artifact-job-1-summary-section-summary"');
    expect(topicTarget).toBeTruthy();
    expect(subtopicTarget).toBeTruthy();
    expect(followUpTarget).toBeTruthy();
    expect(markup).toContain('<details class="summary-toc-disclosure" open>');
    expect(markup).toContain(`id="${topicTarget}"`);
    expect(markup).toContain(`id="${subtopicTarget}"`);
    expect(markup).toContain(
      'id="artifact-job-1-summary-section-summary"\n          tabindex="-1"'
    );
    expect(markup).toContain(`id="${topicTarget}"\n            tabindex="-1"`);
    expect(markup).toContain(`id="${subtopicTarget}"\n                            tabindex="-1"`);
    expect(markup).toContain(`id="${followUpTarget}"\n              tabindex="-1"`);
    expect(markup).toContain('<h4 class="summary-section-title"');
    expect(markup).toContain('<h5 class="summary-topic-title"');
    expect(markup).toContain('<h6 class="summary-subtopic-title"');
    expect(markup).toContain('流程 &lt;檢查&gt;');
    expect(markup.indexOf('條碼流程')).toBeLessThan(markup.indexOf('異常復原'));

    const reorderedMarkup = renderStructuredSummaryMarkup(
      {
        title: '流程 <檢查>',
        summary: '先確認依賴。',
        topics: [
          {
            title: '先插入的新主題',
            status: 'open',
            points: ['先處理新事項。'],
            conclusion: '待確認。'
          },
          {
            title: '條碼流程',
            status: 'mixed',
            subtopics: [
              {
                title: '異常復原',
                details: ['掃描失敗後回到待機。']
              }
            ],
            conclusion: '仍待現場確認。'
          }
        ],
        followUpGroups: [
          {
            title: '復歸驗收',
            items: ['Andy 確認復歸流程。']
          }
        ],
        keyPoints: [],
        actionItems: [],
        decisions: [],
        risks: [],
        openQuestions: ['誰負責驗收？'],
        analysisNotes: []
      },
      'artifact-job-1-summary'
    );

    expect(reorderedMarkup).toContain(`id="${topicTarget}"`);
    expect(reorderedMarkup).toContain(`id="${subtopicTarget}"`);
    expect(reorderedMarkup).toContain(`id="${followUpTarget}"`);
  });

  it('keeps nested navigation when only one top-level section is visible', () => {
    const markup = renderStructuredSummaryMarkup(
      {
        summary: '',
        topics: [
          {
            title: '唯一主題',
            status: 'confirmed',
            points: ['仍需導覽的內容。'],
            conclusion: '導覽保持可用。'
          }
        ],
        keyPoints: [],
        actionItems: [],
        decisions: [],
        risks: [],
        openQuestions: [],
        analysisNotes: []
      },
      'single-section'
    );

    expect(markup).toContain('<nav class="summary-toc" aria-label="摘要目錄">');
    expect(markup).toMatch(/href="#single-section-topic-[^"]+"/);
  });

  it('keeps duplicate-title targets attached to their content after reordering', () => {
    const structured = {
      summary: '重名段落測試。',
      topics: [
        {
          title: 'Initial 檢查條件',
          status: 'confirmed',
          points: ['檢查安全門。'],
          conclusion: '安全門必須關閉。'
        },
        {
          title: 'Initial 檢查條件',
          status: 'confirmed',
          points: ['檢查氣壓。'],
          conclusion: '氣壓必須達標。'
        },
        {
          title: '例外處理',
          status: 'mixed',
          subtopics: [
            { title: '復歸', details: ['安全門復歸。'] },
            { title: '復歸', details: ['氣壓復歸。'] }
          ],
          conclusion: '依異常來源復歸。'
        }
      ],
      followUpGroups: [
        { title: '驗收', items: ['Andy 驗收安全門。'] },
        { title: '驗收', items: ['Ben 驗收氣壓。'] }
      ],
      keyPoints: [],
      actionItems: [],
      decisions: [],
      risks: [],
      openQuestions: [],
      analysisNotes: []
    };
    const render = (value) => renderStructuredSummaryMarkup(value, 'duplicate-summary');
    const topicIdFor = (markup, conclusion) =>
      [...markup.matchAll(/<article\s+class="summary-topic-card"[\s\S]*?<\/article>/g)]
        .find((match) => match[0].includes(conclusion))?.[0]
        .match(/id="([^"]+)"/)?.[1];
    const followUpIdFor = (markup, item) =>
      [...markup.matchAll(/<section\s+class="summary-follow-up-group"[\s\S]*?<\/section>/g)]
        .find((match) => match[0].includes(item))?.[0]
        .match(/id="([^"]+)"/)?.[1];
    const subtopicIdFor = (markup, detail) =>
      [...markup.matchAll(/<section\s+class="summary-subtopic"[\s\S]*?<\/section>/g)]
        .find((match) => match[0].includes(detail))?.[0]
        .match(/id="([^"]+)"/)?.[1];
    const first = render(structured);
    const reordered = render({
      ...structured,
      topics: [
        structured.topics[1],
        structured.topics[0],
        {
          ...structured.topics[2],
          subtopics: [...structured.topics[2].subtopics].reverse()
        }
      ],
      followUpGroups: [...structured.followUpGroups].reverse()
    });

    const safetyId = topicIdFor(first, '安全門必須關閉。');
    const pressureId = topicIdFor(first, '氣壓必須達標。');
    const andyId = followUpIdFor(first, 'Andy 驗收安全門。');
    const benId = followUpIdFor(first, 'Ben 驗收氣壓。');
    const safetyRecoveryId = subtopicIdFor(first, '安全門復歸。');
    const pressureRecoveryId = subtopicIdFor(first, '氣壓復歸。');

    expect(safetyId).toBeTruthy();
    expect(pressureId).toBeTruthy();
    expect(safetyId).not.toBe(pressureId);
    expect(andyId).toBeTruthy();
    expect(benId).toBeTruthy();
    expect(andyId).not.toBe(benId);
    expect(safetyRecoveryId).toBeTruthy();
    expect(pressureRecoveryId).toBeTruthy();
    expect(safetyRecoveryId).not.toBe(pressureRecoveryId);
    expect(topicIdFor(reordered, '安全門必須關閉。')).toBe(safetyId);
    expect(topicIdFor(reordered, '氣壓必須達標。')).toBe(pressureId);
    expect(followUpIdFor(reordered, 'Andy 驗收安全門。')).toBe(andyId);
    expect(followUpIdFor(reordered, 'Ben 驗收氣壓。')).toBe(benId);
    expect(subtopicIdFor(reordered, '安全門復歸。')).toBe(safetyRecoveryId);
    expect(subtopicIdFor(reordered, '氣壓復歸。')).toBe(pressureRecoveryId);
  });

  it('supports a detail-page heading hierarchy without skipping levels', () => {
    const markup = renderStructuredSummaryMarkup(
      {
        summary: '摘要內容。',
        topics: [
          {
            title: '主題',
            status: 'confirmed',
            subtopics: [{ title: '子題', details: ['細節。'] }],
            conclusion: '結論。'
          }
        ],
        followUpGroups: [],
        keyPoints: [],
        actionItems: [],
        decisions: [],
        risks: [],
        openQuestions: [],
        analysisNotes: []
      },
      'detail-summary',
      { headingLevel: 2 }
    );

    expect(markup).toContain('<h2 class="summary-section-title"');
    expect(markup).toContain('<h3 class="summary-topic-title"');
    expect(markup).toContain('<h4 class="summary-subtopic-title"');
    expect(markup).not.toMatch(/<h[56]\b/);
  });

  it('collapses the native summary navigation only on narrow screens', () => {
    const disclosure = { open: true };
    const root = { querySelectorAll: () => [disclosure] };

    configureSummaryNavigation(root, true);
    expect(disclosure.open).toBe(false);

    configureSummaryNavigation(root, false);
    expect(disclosure.open).toBe(true);
  });

  it('shows readable transcript context without exposing anonymous speaker classification', () => {
    const markup = renderTranscriptMarkup([
      {
        startMs: 1200,
        endMs: 3400,
        text: '需要黑電淨化器',
        rawText: '需要<黑電>淨化器',
        displayText: '需要黑電淨化器',
        language: 'zh-Hant',
        timingSource: 'provider',
        speaker: 'Speaker <A>',
        reviewFlags: [
          {
            reason: 'domain-term',
            originalText: '黑電淨化器',
            candidates: ['黑煙淨化器', '烏煙清淨器'],
            startMs: 1400,
            endMs: 2800,
            evidence: 'sales glossary near-match'
          }
        ]
      }
    ]);

    expect(markup).toContain('需要黑電淨化器');
    expect(markup).toContain('<span class="transcript-time">00:01</span>');
    expect(markup).toContain('<div class="transcript-segment-body">');
    expect(markup).not.toContain('transcript-speaker');
    expect(markup).not.toContain('Speaker &lt;A&gt;');
    expect(markup).not.toContain('待確認');
    expect(markup).not.toContain('原始辨識');
    expect(markup).not.toContain('需要&lt;黑電&gt;淨化器');
    expect(markup).not.toContain('domain-term');
    expect(markup).not.toContain('黑煙淨化器');
    expect(markup).not.toContain('sales glossary near-match');
    expect(markup).not.toContain('<details');
    expect(markup).not.toContain('<黑電>');
  });

  it('strips anonymous speaker prefixes with or without metadata and skips empty rows', () => {
    const markup = renderTranscriptMarkup([
      {
        startMs: 5_616_000,
        endMs: 5_617_000,
        speaker: 'Speaker B',
        text: 'Speaker B：完整逐字稿'
      },
      {
        startMs: 5_617_000,
        endMs: 5_618_000,
        text: 'Speaker <C>: 缺少舊 speaker metadata'
      },
      { startMs: 5_618_000, endMs: 5_619_000, text: '   ' }
    ]);

    expect(markup).toContain('<span class="transcript-time">1:33:36</span>');
    expect(markup).not.toContain('transcript-speaker');
    expect(markup).toContain('<p class="transcript-segment-text">完整逐字稿</p>');
    expect(markup).toContain('<p class="transcript-segment-text">缺少舊 speaker metadata</p>');
    expect(markup).not.toContain('Speaker B');
    expect(markup).not.toContain('Speaker &lt;C&gt;');
    expect(markup.match(/transcript-segment"/g)).toHaveLength(2);
  });

  it('keeps transcript text but omits explicitly stored speaker metadata', () => {
    const markup = renderTranscriptMarkup([
      {
        startMs: 12_000,
        endMs: 15_000,
        speaker: '王小明',
        text: '下一步由我整理會議記錄。'
      },
      {
        startMs: 15_000,
        endMs: 18_000,
        speaker: 'Speaker Alice',
        text: '我會確認正式上線時程。'
      }
    ]);

    expect(markup).toContain('下一步由我整理會議記錄。');
    expect(markup).toContain('我會確認正式上線時程。');
    expect(markup).not.toContain('王小明');
    expect(markup).not.toContain('Speaker Alice');
    expect(markup).not.toContain('transcript-speaker');
  });

  it('groups provider-diarized lines into speaker turns with a participants strip', () => {
    const segments = [
      {
        startMs: 240,
        endMs: 28_000,
        text: '留料一直去做，這中間不用檢查。',
        speaker: 'Speaker 1',
        speakerSource: 'provider-diarization'
      },
      {
        startMs: 28_440,
        endMs: 32_000,
        text: '那你的脆盤是兩個都減對不對？',
        speaker: 'Speaker 2',
        speakerSource: 'provider-diarization'
      },
      {
        startMs: 32_800,
        endMs: 35_000,
        text: '對的，它啟動的時候是兩個都減。',
        speaker: 'Speaker 2',
        speakerSource: 'provider-diarization'
      },
      { startMs: 35_320, endMs: 36_000, text: '是，是。', speaker: 'Speaker 1', speakerSource: 'provider-diarization' }
    ];

    const markup = renderTranscriptMarkup(segments);

    // Three turns, not four rows: the two consecutive Speaker 2 lines share one chip.
    expect(markup.match(/transcript-turn"/g)).toHaveLength(3);
    expect(markup.match(/class="transcript-speaker"/g)).toHaveLength(3);
    expect(markup).toContain('<span class="transcript-speaker" data-speaker-tone="1">Speaker 1</span>');
    expect(markup).toContain('<span class="transcript-speaker" data-speaker-tone="2">Speaker 2</span>');
    expect(markup).toContain('<span class="transcript-time">00:28</span>');
    expect(markup).toContain('data-start-ms="32800">對的，它啟動的時候是兩個都減。</p>');
  });

  it('shows labels from the worker whole-recording diarization like provider labels', () => {
    const markup = renderTranscriptMarkup([
      { startMs: 0, endMs: 4_000, text: '先看流程。', speaker: 'Speaker 1', speakerSource: 'local-diarization' },
      { startMs: 4_000, endMs: 5_000, text: '好。', speaker: 'Speaker 2', speakerSource: 'aligned' }
    ]);

    expect(markup).toContain('data-speaker-tone="1">Speaker 1</span>');
    expect(markup).not.toContain('>Speaker 2<');
  });

  it('applies operator speaker names and offers a rename form only when editable', () => {
    const segments = [
      { startMs: 0, endMs: 4_000, text: '先看流程。', speaker: 'Speaker 1', speakerSource: 'provider-diarization' },
      { startMs: 4_000, endMs: 5_000, text: '好。', speaker: 'Speaker 2', speakerSource: 'provider-diarization' }
    ];
    const speakerNames = { 'Speaker 1': '王經理' };

    const readOnly = renderTranscriptMarkup(segments, { speakerNames });
    const editable = renderTranscriptMarkup(segments, { speakerNames, editable: true });

    expect(readOnly).toContain('data-speaker-tone="1">王經理</span>');
    expect(readOnly).toContain('data-speaker-tone="2">Speaker 2</span>');
    expect(readOnly).not.toContain('>Speaker 1<');
    expect(readOnly).not.toContain('data-rename-label');
    // Editable chips are buttons keyed by the provider label; no separate form or select.
    expect(editable).toContain('data-rename-label="Speaker 1"');
    expect(editable).toContain('data-rename-label="Speaker 2"');
    expect(editable).toContain('>Speaker 2</button>');
    expect(editable).toContain('>王經理</button>');
    expect(editable).not.toContain('<form');
    expect(editable).not.toContain('<select');
  });

  it('adds a per-segment play button spanning the whole turn only when playable', () => {
    const segments = [
      { startMs: 240, endMs: 28_000, text: '第一句。', speaker: 'Speaker 1', speakerSource: 'provider-diarization' },
      { startMs: 28_440, endMs: 30_000, text: '第二句。', speaker: 'Speaker 1', speakerSource: 'provider-diarization' },
      { startMs: 30_500, endMs: 31_000, text: '好。', speaker: 'Speaker 2', speakerSource: 'provider-diarization' }
    ];

    const playable = renderTranscriptMarkup(segments, { playable: true });
    const readOnly = renderTranscriptMarkup(segments);
    const legacy = renderTranscriptMarkup([{ startMs: 1_000, endMs: 2_500, text: '舊逐字稿' }], {
      playable: true
    });

    // One button per turn, from the first line's start to the last line's end.
    expect(playable.match(/class="transcript-play"/g)).toHaveLength(2);
    expect(playable).toContain('data-play-start="0.24"');
    expect(playable).toContain('data-play-end="30"');
    expect(playable).toContain('aria-label="播放此段 00:00"');
    expect(readOnly).not.toContain('transcript-play');
    expect(legacy).toContain('data-play-start="1"');
    expect(legacy).toContain('data-play-end="2.5"');
  });

  it('reassigns a segment to another voice and offers a per-turn select when editable', () => {
    const segments = [
      { startMs: 0, endMs: 40_000, text: '客戶第一位。', speaker: 'Speaker 1', speakerSource: 'provider-diarization' },
      { startMs: 43_000, endMs: 57_000, text: '我方回答。', speaker: 'Speaker 2', speakerSource: 'provider-diarization' },
      { startMs: 64_000, endMs: 88_000, text: '其實是客戶第二位。', speaker: 'Speaker 1', speakerSource: 'provider-diarization' }
    ];
    // The diarizer merged two customers into Speaker 1; the operator moved index 2 to
    // a label the provider never emitted and named it.
    const segmentSpeakers = { '2': 'Speaker 3' };
    const speakerNames = { 'Speaker 1': 'AMT-1', 'Speaker 3': 'AMT-2' };

    const markup = renderTranscriptMarkup(segments, { speakerNames, segmentSpeakers, editable: true });
    const readOnly = renderTranscriptMarkup(segments, { speakerNames, segmentSpeakers });

    // Editable chips render as buttons; the override label carries its own name.
    expect(markup).toContain('>AMT-1</button>');
    expect(markup).toContain('>AMT-2</button>');
    expect(markup).toContain('data-rename-label="Speaker 3"');
    expect(readOnly).toContain('>AMT-2</span>');
  });

  it('replaces the player with a notice and disables segment buttons when the recording is gone', () => {
    const button = { disabled: false, title: '' };
    const root = {
      addEventListener: () => {},
      querySelectorAll: (selector: string) => (selector === '.transcript-play' ? [button] : [])
    };
    const handlers = new Map<string, () => void>();
    const audio = {
      outerHTML: '<audio></audio>',
      paused: true,
      readyState: 0,
      addEventListener: (type: string, handler: () => void) => handlers.set(type, handler)
    };

    wireTranscriptPlayback(root, audio);
    handlers.get('error')?.();

    expect(audio.outerHTML).toContain('class="transcript-audio-unavailable"');
    expect(audio.outerHTML).toContain('錄音檔已不存在');
    expect(button.disabled).toBe(true);
  });

  it('keeps the transcript tab selected when a re-render asks for it', () => {
    const job = {
      id: 'job_tab',
      summaryArtifact: { text: '摘要內容' },
      transcriptArtifact: { segments: [{ startMs: 0, endMs: 1_000, text: '一句。' }] }
    };

    const defaultMarkup = renderArtifactReader(job);
    const transcriptMarkup = renderArtifactReader(job, { selectedTab: 'transcript' });

    expect(defaultMarkup).toContain('data-artifact-tab="summary"');
    expect(defaultMarkup).toMatch(/aria-selected="true"[^>]*data-artifact-tab="summary"/);
    expect(transcriptMarkup).toMatch(/aria-selected="true"[^>]*data-artifact-tab="transcript"/);
    expect(transcriptMarkup).toMatch(/data-artifact-panel="summary"\s+hidden/);
    expect(transcriptMarkup).not.toMatch(/data-artifact-panel="transcript"\s+hidden/);
  });

  it('offers per-panel Markdown downloads only when the page can export', () => {
    const job = {
      id: 'job_export',
      summaryArtifact: { text: '摘要內容' },
      transcriptArtifact: {
        segments: [{ startMs: 0, endMs: 1_000, text: '一句。', speaker: 'Speaker 1', speakerSource: 'provider-diarization' }]
      }
    };

    const exportable = renderArtifactReader(job, { exportable: true });
    const plain = renderArtifactReader(job);

    expect(exportable).toContain('data-export-part="summary">下載摘要 MD</button>');
    expect(exportable).toContain('data-export-part="transcript">下載逐字稿 MD（含姓名與時間）</button>');
    // A copy-all icon button sits next to each download and reads as one for screen readers.
    expect(exportable).toContain('data-copy-part="summary" aria-label="複製全部摘要"');
    expect(exportable).toContain('data-copy-part="transcript" aria-label="複製全部逐字稿"');
    expect(plain).not.toContain('data-export-part');
    expect(plain).not.toContain('data-copy-part');
  });

  it('renders the public projection with canonical playback and export controls without editing', () => {
    const job = {
      id: 'shared-meeting',
      summaryArtifact: { text: '摘要內容' },
      transcriptArtifact: {
        segments: [
          { startMs: 0, endMs: 1_000, text: '公開內容', speaker: 'Speaker 1', speakerSource: 'local-diarization' }
        ]
      }
    };
    const markup = renderArtifactReader(job, {
      detailLayout: true,
      playable: true,
      exportable: true,
      readerId: 'shared'
    });
    expect(markup).toContain('class="artifact-reader artifact-reader--split"');
    expect(markup).toContain('<audio class="transcript-audio" controls preload="none"');
    expect(markup).toContain('class="transcript-speaker"');
    expect(markup).toContain('data-export-part="summary"');
    expect(markup).toContain('data-export-part="transcript"');
    expect(markup).not.toContain('data-rename-label');
  });

  it('replaces anonymous speaker classifications in historical summary wording', () => {
    expect(
      sanitizeAnonymousSpeakerLabels(
        'Speaker A 向 PE 確認，並把記錄發給 Speaker B；Speaker A/C 仍待確認。'
      )
    ).toBe('與會者 向 PE 確認，並把記錄發給 與會者；與會者 仍待確認。');
  });

  it('preserves named speakers while normalizing anonymous speaker codes', () => {
    expect(
      sanitizeAnonymousSpeakerLabels('Speaker Alice 會確認，Speaker A 負責記錄。')
    ).toBe('Speaker Alice 會確認，與會者 負責記錄。');
  });

  it('switches panels by click and keyboard while keeping ARIA and focus in sync', () => {
    const createTab = (panelId) => {
      const listeners = {};
      const attributes = new Map([['aria-controls', panelId]]);
      const classes = new Set();
      return {
        listeners,
        attributes,
        classes,
        focused: false,
        tabIndex: -1,
        classList: {
          toggle(name, selected) {
            if (selected) classes.add(name);
            else classes.delete(name);
          }
        },
        setAttribute(name, value) {
          attributes.set(name, value);
        },
        getAttribute(name) {
          return attributes.get(name);
        },
        addEventListener(name, listener) {
          listeners[name] = listener;
        },
        focus() {
          this.focused = true;
        }
      };
    };

    const tabs = [createTab('summary-panel'), createTab('transcript-panel')];
    const panels = {
      'summary-panel': { hidden: false },
      'transcript-panel': { hidden: true }
    };
    const tablistListeners = {};
    const tablist = {
      querySelectorAll: () => tabs,
      addEventListener(name, listener) {
        tablistListeners[name] = listener;
      }
    };
    const card = {
      querySelector(selector) {
        if (selector === '[data-artifact-tabs]') return tablist;
        return panels[selector.slice(1)];
      }
    };

    wireArtifactTabs(card);
    tabs[1].listeners.click();

    expect(tabs[0].attributes.get('aria-selected')).toBe('false');
    expect(tabs[1].attributes.get('aria-selected')).toBe('true');
    expect(panels['summary-panel'].hidden).toBe(true);
    expect(panels['transcript-panel'].hidden).toBe(false);

    let prevented = false;
    tablistListeners.keydown({
      target: tabs[1],
      key: 'ArrowLeft',
      preventDefault() {
        prevented = true;
      }
    });

    expect(prevented).toBe(true);
    expect(tabs[0].focused).toBe(true);
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[0].attributes.get('aria-selected')).toBe('true');
    expect(panels['summary-panel'].hidden).toBe(false);
    expect(panels['transcript-panel'].hidden).toBe(true);
  });
});
