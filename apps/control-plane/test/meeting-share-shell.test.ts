import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from './test-request.js';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const readPublicFile = (name: string) =>
  readFileSync(resolve(import.meta.dirname, `../public/${name}`), 'utf-8');

describe('meeting detail and public share shells', () => {
  it('opens every archive item in a dedicated owner tab and provides share lifecycle actions', () => {
    const javascript = readPublicFile('app.js');

    expect(javascript).toContain('meetingDetailJobId');
    expect(javascript).toContain('document.body.classList.add(\'meeting-detail-page\')');
    expect(javascript).toContain('/notes/${encodeURIComponent(job.id)}');
    expect(javascript).toContain('target="_blank"');
    expect(javascript).toContain('rel="noopener"');
    expect(javascript).toContain('開啟完整內容（新分頁）');
    expect(javascript).toContain('class="mini-button primary job-detail-link"');
    expect(javascript).not.toContain('data-action="view-details"');
    expect(javascript).not.toContain('fetchJobDetails');
    expect(javascript).toContain("data-action=\"share-job\"");
    expect(javascript).toContain("data-action=\"rotate-share\"");
    expect(javascript).toContain("data-action=\"revoke-share\"");
    expect(javascript).toContain('class="share-management" aria-live="polite"');
    expect(javascript).toContain('job.share?.status');
    expect(javascript).toContain('job.share?.eligible === true');
    expect(javascript).toContain('setShareActionsBusy');
    expect(javascript).toContain('button.disabled = busy');
    expect(javascript).toContain("window.navigator.clipboard.writeText");
    expect(javascript).toContain("`${window.location.origin}/share#${payload.token}`");
    expect(javascript).toContain('持有此網址的人可以查看並轉寄');
    expect(javascript).not.toContain('/share?token=');
  });

  it('serves a read-only, dependency-free public reader with defensive headers', async () => {
    const html = readPublicFile('share.html');
    const javascript = readPublicFile('share.js');
    const app = createApp(undefined, { meetingShareSecret: 'test-share-secret' });

    expect(html).toContain('id="shared-meeting-content"');
    expect(html).toContain('id="shared-summary"');
    expect(html).toContain('id="shared-transcript"');
    expect(html).toContain('class="shared-meeting-shell" tabindex="-1"');
    expect(html).toContain('class="shared-meeting-heading"');
    expect(html).toContain('列印');
    expect(html).toContain('<noscript>');
    expect(html).toContain('此頁需要啟用 JavaScript');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('管理設定');
    expect(html).not.toContain('下載');
    expect(html).not.toContain('編輯');
    expect(javascript).toContain('window.location.hash.slice(1)');
    expect(javascript).toContain("Authorization: `Bearer ${token}`");
    expect(javascript).toContain("renderStructuredSummaryMarkup");
    expect(javascript).toContain("configureSummaryNavigation(summaryContent)");
    expect(javascript).toContain("renderTranscriptMarkup");
    expect(javascript).toContain("split('::', 2)");
    expect(javascript).toContain('token === activeToken');
    expect(javascript).toContain('encodeURIComponent(activeToken)');
    expect(javascript).toContain('prepareShareTargetLinks(activeToken)');
    expect(javascript).toContain('link.dataset.shareTarget');
    expect(javascript).toContain('scrollToShareTarget(targetId)');
    expect(javascript).toContain('target.focus({ preventScroll: true })');
    expect(javascript).toContain('const requestGeneration = ++loadGeneration');
    expect(javascript).toContain("classList.add('summary-deep-link-target')");
    expect(javascript).not.toContain('anchorHrefPrefix');
    expect(javascript).not.toContain('appendListSection');
    expect(javascript).not.toContain('rawText');
    expect(javascript).not.toContain('reviewFlags');

    for (const route of ['/share', '/share.html']) {
      const response = await request(app).get(route);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-robots-tag']).toContain('noindex');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.text).not.toContain('fonts.googleapis.com');
    }
  });

  it('uses a monochrome layered dark system with responsive editorial and print layouts', () => {
    const css = readPublicFile('styles.css');

    expect(css).toContain('color-scheme: dark;');
    expect(css).toContain('--bg: #050505;');
    expect(css).toContain('--panel: #111111;');
    expect(css).toContain('--panel-strong: #181818;');
    expect(css).toContain('--panel-raised: #212121;');
    expect(css).toContain('--panel-border: #333333;');
    expect(css).toContain('--text: #f5f5f5;');
    expect(css).toContain('--muted: #a3a3a3;');
    expect(css).toContain('--accent: #f5f5f5;');
    expect(css).not.toContain('--accent: #7c3aed;');
    expect(css).not.toContain('--bg: #000000;');
    expect(css).toContain('.meeting-detail-page');
    expect(css).toContain('.shared-meeting-page');
    expect(css).toContain('.meeting-detail-page .artifact-reader');
    expect(css).toContain('.summary-toc-disclosure > ol');
    expect(css).toContain('max-width: 75ch;');
    expect(css).toContain('@media print');
    expect(css).toContain('linear-gradient');
    expect(css).toContain('radial-gradient');
  });
});
