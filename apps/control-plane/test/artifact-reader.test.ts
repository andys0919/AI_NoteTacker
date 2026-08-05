import { describe, expect, it } from 'vitest';

import {
  configureSummaryNavigation,
  renderStructuredSummaryMarkup,
  renderTranscriptMarkup,
  sanitizeAnonymousSpeakerLabels,
  wireArtifactTabs
} from '../public/artifact-reader.js';

describe('artifact reader', () => {
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
