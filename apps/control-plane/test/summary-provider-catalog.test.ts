import { describe, expect, it } from 'vitest';

import {
  createSummaryProviderCatalog
} from '../src/infrastructure/summary-provider-catalog.js';

describe('summary provider catalog', () => {
  it('exposes local Codex as the only active summary provider', () => {
    const catalog = createSummaryProviderCatalog();

    expect(catalog.defaultProvider).toBe('local-codex');
    expect(catalog.options).toEqual([
      { value: 'local-codex', label: 'Local Codex', ready: true }
    ]);
    expect(catalog.isReady('local-codex')).toBe(true);
    expect(catalog.isReady('azure-openai')).toBe(false);
    expect(catalog.readinessReason('azure-openai')).toContain('retired');
  });
});
