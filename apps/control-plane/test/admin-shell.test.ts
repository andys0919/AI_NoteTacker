import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import request from './test-request.js';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

describe('admin shell markup', () => {
  it('renders a dedicated admin page shell', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/admin.html'),
      'utf-8'
    );

    expect(html).toContain('AI 治理設定');
    expect(html).toContain('admin-provider-panel');
    expect(html).toContain('admin-usage-report-list');
    expect(html).toContain('admin-runtime-health-panel');
    expect(html).toContain('admin-codex-usage-panel');
    expect(html).toContain('id="admin-codex-usage-progress"');
    expect(html).toContain('<progress');
    expect(html).toContain('/admin.js');
    expect(html).toContain('id="admin-session-status"');
    expect(html).toContain('id="admin-login-overlay" class="admin-login-overlay" hidden');
    expect(html).toContain('id="admin-content" class="admin-content"');
    expect(html).not.toContain('id="admin-content" class="admin-content" hidden');
    expect(html).not.toContain('admin-login-showcase');
    expect(html).not.toContain('admin-login-wave');
    expect(html).toContain('class="admin-main-heading"');
    expect(html).toContain('<link rel="modulepreload" href="/admin.js" />');
    expect(html).toContain('<option value="100" selected>最近 100 筆</option>');
    expect(html).not.toContain('<option value="500" selected>');
  });

  it('serves the dedicated admin page at /admin', async () => {
    const app = createApp();

    const response = await request(app).get('/admin');

    expect(response.status).toBe(200);
    expect(response.text).toContain('admin-provider-panel');
    expect(response.text).toContain('admin-runtime-health-panel');
    expect(response.text).toContain('/admin.js');
  });

  it('explains that unknown provider rates stay unpriced instead of showing zero cost', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/admin.html'),
      'utf-8'
    );

    expect(html).toContain('無法精確核價的 Azure 用量標示「未定價」');
    expect(html).toContain('費用狀態 (TWD)');
    expect(html).toContain('<th scope="col">請求明細</th>');
    expect(html).toContain('每日預設額度 (TWD)');
    expect(html).not.toContain('費用狀態 (USD)');
    expect(html).toContain('<span class="meta-label">歷史費用</span>');
    expect(html).toContain('<strong id="admin-usage-history-total-cost">—</strong>');
    expect(html).not.toContain('<strong id="admin-usage-history-total-cost">$0.000</strong>');
  });

  it('uses one compact section navigation instead of duplicated overview surfaces', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/admin.html'),
      'utf-8'
    );

    expect(html).toContain('class="admin-section-nav"');
    expect(html).toContain('href="#admin-usage-history-panel"');
    expect(html).toContain('href="#admin-provider-panel"');
    expect(html).toContain('href="#admin-runtime-health-panel"');
    expect(html).toContain('href="#admin-codex-usage-panel"');
    expect(html).not.toContain('admin-topbar');
    expect(html).not.toContain('admin-rail-points');
  });

  it('shows the fixed Local Codex route without a fake provider choice', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/admin.html'),
      'utf-8'
    );
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/admin.js'),
      'utf-8'
    );

    expect(html).toContain('id="admin-summary-provider-value"');
    expect(html).toContain('>本機 Codex</output>');
    expect(html).not.toContain('id="admin-summary-provider-select"');
    expect(javascript).toContain('adminSummaryProviderValue');
    expect(javascript).toContain('summaryProvider: adminProviderState.summaryProvider');
    expect(javascript).not.toContain('adminSummaryProviderSelect');
  });

  it('provides accessible table, modal, and asynchronous form state', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/admin.html'),
      'utf-8'
    );
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/admin.js'),
      'utf-8'
    );

    expect(html).toContain('<caption class="sr-only">');
    expect(html).toContain('<th scope="col">');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="雲端處理 Token 與費用歷史紀錄，可左右捲動"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('id="admin-skip-link"');
    expect(html).toContain('<dialog id="admin-job-modal"');
    expect(html).toContain('id="admin-job-modal-card"');
    expect(html).toContain('tabindex="-1"');
    expect(javascript).toContain('elements.jobModal.showModal()');
    expect(javascript).toContain('elements.jobModal.close()');
    expect(javascript).toContain('elements.jobModalCard.focus()');
    expect(javascript).not.toContain('elements.adminContent.hidden');
    expect(javascript).toContain("elements.skipLink.href = '#admin-content'");
    expect(javascript).toContain('setFormBusy(elements.adminProviderForm');
    expect(javascript).toContain('setFormBusy(elements.adminOverrideForm');
    expect(javascript).toContain('sanitizeAnonymousSpeakerLabels');
    expect(javascript).toContain("details.className = 'usage-request-details'");
    expect(javascript).toContain("appendUsageDetail(list, 'Provider'");
    expect(javascript).toContain("appendUsageDetail(list, 'Model'");
    expect(javascript).toContain("buildModalSection('Provider request audit'");
  });

  it('keeps the administrator bearer token inside the current browser session', () => {
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/admin.js'),
      'utf-8'
    );

    expect(javascript).toContain('window.localStorage.removeItem(TOKEN_STORAGE_KEY)');
    expect(javascript).toContain('window.sessionStorage.getItem(TOKEN_STORAGE_KEY)');
    expect(javascript).toContain('window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)');
    expect(javascript).toContain('window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)');
    expect(javascript).not.toContain('window.localStorage.getItem(TOKEN_STORAGE_KEY)');
    expect(javascript).not.toContain('window.localStorage.setItem(TOKEN_STORAGE_KEY, token)');
  });
});
