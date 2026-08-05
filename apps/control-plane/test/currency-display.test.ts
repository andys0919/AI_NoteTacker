import { describe, expect, it } from 'vitest';

import {
  USD_TO_TWD_RATE,
  applyTwdPricingReference,
  formatTwdFromUsd,
  formatTwdInputFromUsd,
  getTwdPricingReferenceText,
  twdQuotaToUsd
} from '../public/currency-display.js';

describe('currency display', () => {
  it('uses the verified current Azure TWD reference rate', () => {
    expect(USD_TO_TWD_RATE).toBe(31.9175);
    expect(formatTwdFromUsd(0.919802)).toBe('NT$29.36');
    expect(formatTwdFromUsd(0.0004)).toBe('NT$0.01');
    expect(formatTwdFromUsd(0)).toBe('NT$0.00');
    expect(formatTwdFromUsd(null)).toBe('未定價');
  });

  it('round-trips admin quota inputs through the existing USD precision', () => {
    expect(formatTwdInputFromUsd(5)).toBe('159.59');
    expect(twdQuotaToUsd('159.59')).toBe(5);
  });

  it('explains the source and as-of date without claiming invoice accuracy', () => {
    expect(getTwdPricingReferenceText()).toContain('Azure Retail Prices API');
    expect(getTwdPricingReferenceText()).toContain('1 USD = NT$31.9175');
    expect(getTwdPricingReferenceText()).toContain('2026/7/31');
    expect(getTwdPricingReferenceText()).toContain('正式帳單');
  });

  it('applies the daily server reference and rejects invalid replacements', () => {
    try {
      expect(
        applyTwdPricingReference({
          source: 'Azure Retail Prices API',
          usdToTwdRate: 32,
          verifiedAt: '2026-08-01T00:00:00.000Z'
        })
      ).toBe(true);
      expect(formatTwdFromUsd(1)).toBe('NT$32.00');
      expect(getTwdPricingReferenceText()).toContain('2026/8/1');
      expect(applyTwdPricingReference({ usdToTwdRate: 0 })).toBe(false);
      expect(formatTwdFromUsd(1)).toBe('NT$32.00');
    } finally {
      applyTwdPricingReference({
        source: 'Azure Retail Prices API',
        usdToTwdRate: 31.9175,
        verifiedAt: '2026-07-31T00:00:00.000Z'
      });
    }
  });
});
