import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('dashboard shell markup', () => {
  it('does not render the summary policy panel in the dashboard shell', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );

    expect(html).not.toContain('Summary Policy');
    expect(html).not.toContain('摘要說明');
    expect(html).not.toContain('固定使用完整詳細摘要');
    expect(html).not.toContain('系統預設產出完整詳細摘要');
    expect(html).not.toContain('admin-provider-panel');
    expect(html).not.toContain('admin-usage-report-list');
  });

  it('renders a left intake rail and a right jobs stage layout', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );

    expect(html).toContain('dashboard-left-rail');
    expect(html).toContain('dashboard-right-stage');
    expect(html).toContain('Meeting Capture');
    expect(html).toContain('Recording Intake');
    expect(html).toContain('Jobs & Archive');
  });

  it('removes the email login portal and quota card from the dashboard shell', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );

    expect(html).not.toContain('sign-in-button');
    expect(html).not.toContain('Email 驗證登入');
    expect(html).not.toContain('登入入口');
    expect(html).not.toContain('quota-card');
    expect(html).not.toContain('今日雲端額度');
  });

  it('links to the admin console from the dashboard shell', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );

    expect(html).toContain('admin-entry-link');
    expect(html).toContain('href="/admin"');
  });
});
