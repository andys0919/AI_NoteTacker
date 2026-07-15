import { describe, expect, it } from 'vitest';

import { renderTranscriptReviewMarkup } from '../public/transcript-review.js';

describe('transcript review evidence', () => {
  it('shows display text first and keeps raw evidence and candidates expandable', () => {
    const markup = renderTranscriptReviewMarkup([
      {
        startMs: 1200,
        endMs: 3400,
        text: '需要黑電淨化器',
        rawText: '需要<黑電>淨化器',
        displayText: '需要黑電淨化器',
        language: 'zh-Hant',
        timingSource: 'provider',
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
    expect(markup).toContain('待確認');
    expect(markup).toContain('原始辨識');
    expect(markup).toContain('需要&lt;黑電&gt;淨化器');
    expect(markup).toContain('domain-term');
    expect(markup).toContain('黑煙淨化器');
    expect(markup).toContain('烏煙清淨器');
    expect(markup).toContain('00:01.400–00:02.800');
    expect(markup).toContain('sales glossary near-match');
    expect(markup).not.toContain('<黑電>');
  });

  it('keeps legacy segments simple without inventing review evidence', () => {
    expect(
      renderTranscriptReviewMarkup([
        { startMs: 0, endMs: 1000, text: '舊格式逐字稿' }
      ])
    ).toBe('<p class="transcript-segment-text">舊格式逐字稿</p>');
  });
});
