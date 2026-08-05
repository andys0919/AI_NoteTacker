import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('responsive console styles', () => {
  it('bounds wide shells and collapses page grids at the shared breakpoint', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf-8');

    expect(css).toContain('width: min(1480px, calc(100vw - 3rem));');
    expect(css).toContain('width: min(1540px, calc(100vw - 3rem));');
    expect(css).toContain('@media (max-width: 920px)');
    expect(css).toContain('.dashboard-grid {\n    grid-template-columns: 1fr;');
    expect(css).not.toContain('.dashboard-grid.has-jobs .dashboard-right-stage');
    expect(css).toContain('.admin-shell,\n  .admin-summary-strip,\n  .admin-grid');
  });

  it('uses one premium monochrome layered dark theme', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf-8');

    expect(css).toContain('color-scheme: dark;');
    expect(css).toContain('--bg: #050505;');
    expect(css).toContain('--panel: #111111;');
    expect(css).toContain('--panel-raised: #212121;');
    expect(css).toContain('--text: #f5f5f5;');
    expect(css).toContain('--muted: #a3a3a3;');
    expect(css).toContain('--accent: #f5f5f5;');
    expect(css).not.toContain('--accent: #7c3aed;');
    expect(css).toContain('/* 2026 premium monochrome layered dark theme */');
    expect(css).toContain('color: #ffffff;\n  background: rgba(255, 255, 255, 0.06);');
    expect(css).not.toContain('--bg: #000000;');
    expect(css).toContain('linear-gradient');
    expect(css).toContain('radial-gradient');
    expect(css).toContain('[hidden] {\n  display: none !important;');
    expect(css).not.toContain('.background-grid');
    expect(css).not.toContain('.background-glow');
    expect(css).not.toContain('"Noto Serif TC"');
  });

  it('contains wide tables and keeps practical touch targets', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf-8');

    expect(css).toContain('min-width: 980px;');
    expect(css).toContain('overscroll-behavior: contain;');
    expect(css).toContain('min-height: 44px;');
  });

  it('keeps the summary navigation sticky in the page without a nested scrollbar', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf-8');
    const rule = [...css.matchAll(/\.summary-toc\s*\{([^}]*)\}/g)]
      .map((match) => match[1])
      .join('\n');

    expect(rule).toMatch(/position:\s*sticky;/);
    expect(rule).toMatch(/top:\s*[^;]+;/);
    expect(rule).not.toMatch(/overflow(?:-y)?:/);
    expect(rule).not.toMatch(/max-height:/);
  });

  it('does not keep selectors for removed frontend surfaces', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf-8');

    expect(css).not.toContain('.admin-entry-card');
    expect(css).not.toContain('.hero-points');
    expect(css).not.toContain('.notification-card');
    expect(css).not.toContain('.history-timeline');
    expect(css).not.toContain('.workflow-panel');
  });
});
