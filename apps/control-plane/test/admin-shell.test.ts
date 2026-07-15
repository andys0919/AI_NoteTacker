import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import request from 'supertest';
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
    expect(html).toContain('<span class="meta-label">歷史費用</span>');
    expect(html).toContain('<strong id="admin-usage-history-total-cost">—</strong>');
    expect(html).not.toContain('<strong id="admin-usage-history-total-cost">$0.000</strong>');
  });
});
