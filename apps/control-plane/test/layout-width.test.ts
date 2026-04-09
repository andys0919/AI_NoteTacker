import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('layout width styles', () => {
  it('uses full available width for operator and admin shells', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../public/styles.css'), 'utf-8');

    expect(css).toContain('width: calc(100vw - 2rem);');
    expect(css).not.toContain('width: min(1220px, calc(100vw - 2.5rem));');
    expect(css).not.toContain('width: min(1400px, calc(100vw - 2.5rem));');
  });
});
