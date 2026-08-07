import { describe, expect, it } from 'vitest';

import {
  applyAzureRetailPricingSnapshot,
  calculateAzureTranscriptionActualCost,
  getAzureRetailPricingSnapshot
} from '../src/domain/cloud-usage.js';
import {
  AZURE_MAI_TWD_RETAIL_PRICE_URL,
  refreshAzureRetailPricing
} from '../src/infrastructure/azure-retail-pricing.js';

const maiItem = (
  retailPrice: number,
  currencyCode: 'TWD' | 'USD' = 'USD',
  effectiveStartDate = '2024-11-01T00:00:00Z'
) => ({
  currencyCode,
  retailPrice,
  armRegionName: 'southeastasia',
  productName: 'Azure Speech',
  skuName: 'Fast Transcription',
  meterName: 'Fast Transcription Speech To Text',
  meterId: 'e366297b-9194-5c2f-91f9-2b6472d890b3',
  unitOfMeasure: '1 Hour',
  type: 'Consumption',
  effectiveStartDate
});

const fakeFetch = (
  usdRate = 0.3,
  twdEffectiveStartDate = '2024-11-01T00:00:00Z'
) => async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    Items:
      url === AZURE_MAI_TWD_RETAIL_PRICE_URL
        ? [maiItem(9.6, 'TWD', twdEffectiveStartDate)]
        : [maiItem(usdRate)],
    NextPageLink: null
  })
});

describe('Azure retail pricing refresh', () => {
  it('updates active MAI/TWD meters atomically and keeps them on an invalid refresh', async () => {
    const original = getAzureRetailPricingSnapshot();

    try {
      await refreshAzureRetailPricing({
        fetcher: fakeFetch(),
        now: new Date('2026-07-31T00:00:00Z')
      });

      expect(
        calculateAzureTranscriptionActualCost({
          provider: 'azure-speech-mai-transcribe-1.5',
          model: 'mai-transcribe-1.5',
          pricingVersion: 'v1',
          audioMs: 3_600_000
        })
      ).toEqual({ costUsd: 0.3, pricingStatus: 'priced' });

      await expect(
        refreshAzureRetailPricing({
          fetcher: fakeFetch(0.3, '2025-01-01T00:00:00Z'),
          now: new Date('2026-07-31T00:00:00Z')
        })
      ).rejects.toThrow('effective dates differ');

      await expect(
        refreshAzureRetailPricing({
          fetcher: fakeFetch(0),
          now: new Date('2026-07-31T00:00:00Z')
        })
      ).rejects.toThrow('not effective or consistent');

      expect(getAzureRetailPricingSnapshot().mai.usdPerHour).toBe(0.3);
      expect(getAzureRetailPricingSnapshot().twd.usdToTwdRate).toBe(32);
    } finally {
      applyAzureRetailPricingSnapshot(original);
    }
  });
});
