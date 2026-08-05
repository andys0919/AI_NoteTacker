import { describe, expect, it } from 'vitest';

import {
  applyAzureRetailPricingSnapshot,
  calculateAzureResponsesCost,
  calculateAzureTranscriptionActualCost,
  getAzureRetailPricingSnapshot
} from '../src/domain/cloud-usage.js';
import {
  AZURE_LUNA_RETAIL_PRICE_URL,
  AZURE_MAI_TWD_RETAIL_PRICE_URL,
  refreshAzureRetailPricing
} from '../src/infrastructure/azure-retail-pricing.js';

const lunaItem = (skuName: string, retailPrice: number) => ({
  currencyCode: 'USD',
  retailPrice,
  armRegionName: 'eastus2',
  productName: 'Azure OpenAI GPT5',
  skuName,
  unitOfMeasure: '1M',
  type: 'Consumption',
  effectiveStartDate: '2026-07-01T00:00:00Z'
});

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

const lunaItems = [
  lunaItem('5.6 luna ShortCo Inp Std Gl', 0.2),
  lunaItem('5.6 luna ShortCo Cd Inp Std Gl', 0.02),
  lunaItem('5.6 luna ShortCo Cd Wr Std Gl', 0.25),
  lunaItem('5.6 luna ShortCo Opt Std Gl', 1.2)
];

const fakeFetch = (
  items: unknown[],
  twdEffectiveStartDate = '2024-11-01T00:00:00Z'
) => async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => ({
    Items:
      url === AZURE_LUNA_RETAIL_PRICE_URL
        ? items
        : url === AZURE_MAI_TWD_RETAIL_PRICE_URL
          ? [maiItem(9.6, 'TWD', twdEffectiveStartDate)]
          : [maiItem(0.3)],
    NextPageLink: null
  })
});

describe('Azure retail pricing refresh', () => {
  it('updates both exact meters atomically and keeps them on an incomplete refresh', async () => {
    const original = getAzureRetailPricingSnapshot();

    try {
      await refreshAzureRetailPricing({
        fetcher: fakeFetch(lunaItems),
        now: new Date('2026-07-31T00:00:00Z')
      });

      expect(
        calculateAzureResponsesCost({
          model: 'gpt-5.6-luna',
          pricingVersion: 'v1',
          inputTokens: 1_000_000,
          cachedInputTokens: 250_000,
          cacheWriteTokens: 250_000,
          outputTokens: 1_000_000
        })
      ).toEqual({ costUsd: 1.3675, pricingStatus: 'priced' });
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
          fetcher: fakeFetch(lunaItems.slice(0, 3)),
          now: new Date('2026-07-31T00:00:00Z')
        })
      ).rejects.toThrow('incomplete or inconsistent');

      await expect(
        refreshAzureRetailPricing({
          fetcher: fakeFetch(lunaItems, '2025-01-01T00:00:00Z'),
          now: new Date('2026-07-31T00:00:00Z')
        })
      ).rejects.toThrow('effective dates differ');

      await expect(
        refreshAzureRetailPricing({
          fetcher: fakeFetch([
            lunaItem('5.6 luna ShortCo Inp Std Gl', 0),
            ...lunaItems.slice(1)
          ]),
          now: new Date('2026-07-31T00:00:00Z')
        })
      ).rejects.toThrow('incomplete or inconsistent');

      expect(getAzureRetailPricingSnapshot().luna.outputUsdPerMillionTokens).toBe(1.2);
      expect(getAzureRetailPricingSnapshot().mai.usdPerHour).toBe(0.3);
      expect(getAzureRetailPricingSnapshot().twd.usdToTwdRate).toBe(32);
    } finally {
      applyAzureRetailPricingSnapshot(original);
    }
  });
});
