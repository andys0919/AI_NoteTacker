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
    expect(html).not.toContain('admin-usage-report-list');
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
    expect(html).toContain('<option value="100" selected>最近 100 個工作</option>');
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

    expect(html).toContain('無法精確核價的用量保留「未定價」狀態');
    expect(html).toContain('總消費 (TWD)');
    expect(html).toContain('<th scope="col">最終結果</th>');
    expect(html).toContain('每日預設額度 (TWD)');
    expect(html).not.toContain('費用狀態 (USD)');
    expect(html).toContain('<span class="meta-label">所選工作總消費</span>');
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

  it('provides accessible results and omits retired panels and requests', () => {
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
    expect(html).toContain('aria-label="工作總消費歷史紀錄，可左右捲動"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('id="admin-skip-link"');
    expect(javascript).not.toContain('elements.adminContent.hidden');
    expect(javascript).toContain("elements.skipLink.href = '#admin-content'");
    expect(javascript).toContain('setFormBusy(elements.adminProviderForm');
    expect(javascript).toContain('/admin/result?jobId=');
    expect(javascript).toContain("jobIdLabel.className = 'usage-history-job-id'");
    expect(javascript).not.toContain('buildUsageJobDetails');
    for (const id of ['admin-quota-panel', 'admin-audit-panel', 'admin-usage-report-panel']) {
      expect(html).not.toContain(id);
    }
    for (const route of ['/api/admin/cloud-quota/overrides', '/api/admin/audit-log', '/api/admin/cloud-usage/report']) {
      expect(javascript).not.toContain(route);
    }
    expect(javascript).toContain('/api/admin/runtime-health');
  });

  it('keeps one administrator session per device and never stores credentials', () => {
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/admin.js'),
      'utf-8'
    );

    // Per device, so every tab shares one login instead of each asking again.
    expect(javascript).toContain('window.localStorage.getItem(TOKEN_STORAGE_KEY)');
    expect(javascript).toContain('window.localStorage.setItem(TOKEN_STORAGE_KEY, token)');
    // A token left in the old per-tab location is adopted once, then removed there.
    expect(javascript).toContain('window.sessionStorage.getItem(TOKEN_STORAGE_KEY)');
    expect(javascript).toContain('window.localStorage.setItem(TOKEN_STORAGE_KEY, carried)');
    // Logging out clears both locations.
    expect(javascript).toContain('window.localStorage.removeItem(TOKEN_STORAGE_KEY)');
    expect(javascript).toContain('window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)');
    // Only the signed session token is ever stored.
    expect(javascript).not.toContain('setItem(TOKEN_STORAGE_KEY, password');
    expect(javascript).not.toMatch(/(local|session)Storage\.setItem\([^)]*password/i);
  });
});
