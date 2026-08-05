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
    expect(html).toContain('/admin.js');
    expect(html).toContain('id="admin-session-status"');
    expect(html).toContain('id="admin-login-overlay" class="admin-login-overlay" hidden');
    expect(html).toContain('class="admin-login-showcase"');
    expect(html).toContain('class="admin-main-heading"');
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

    expect(html).toContain('沒有官方費率的用量會標示「未定價」');
    expect(html).toContain('費用狀態 (TWD)');
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
    expect(html).not.toContain('admin-topbar');
    expect(html).not.toContain('admin-rail-points');
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
    expect(javascript).toContain("elements.skipLink.href = '#admin-content'");
    expect(javascript).toContain('setFormBusy(elements.adminProviderForm');
    expect(javascript).toContain('setFormBusy(elements.adminOverrideForm');
    expect(javascript).toContain('sanitizeAnonymousSpeakerLabels');
  });
});
