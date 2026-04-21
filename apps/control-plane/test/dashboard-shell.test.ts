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

  it('renders a visible login entry point in the dashboard shell', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );

    expect(html).toContain('sign-in-button');
    expect(html).toContain('登入');
    expect(html).toContain('Email 驗證登入');
  });
});
