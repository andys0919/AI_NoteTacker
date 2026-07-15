import { describe, expect, it } from 'vitest';

import {
  type AzureResponsesPricing,
  buildQuotaDayKey,
  calculateAzureResponsesCost,
  calculateAzureTranscriptionActualCost,
  calculateRemainingCloudQuotaUsd,
  estimateCloudReservationUsd,
  estimateAzureTranscriptionReservationCostUsd,
  roundUsd,
  sumActualConsumedUsd,
  sumReservedUsd
} from '../src/domain/cloud-usage.js';

describe('cloud usage helpers', () => {
  it('marks an unknown Azure Responses model as unpriced', () => {
    expect(
      calculateAzureResponsesCost({
        model: 'gpt-5.6-luna',
        pricingVersion: 'v1',
        inputTokens: 1_000,
        outputTokens: 500
      })
    ).toEqual({ costUsd: null, pricingStatus: 'unpriced' });
  });

  it('marks audio-duration-only transcription actual usage as unpriced', () => {
    expect(calculateAzureTranscriptionActualCost({ audioMs: 60_000 })).toEqual({
      costUsd: null,
      pricingStatus: 'unpriced'
    });
  });

  it('rejects a price row that lacks authoritative meter provenance', () => {
    const incompletePricing = {
      model: 'priced-responses-model',
      pricingVersion: 'v-test',
      inputUsdPerMillionTokens: 4,
      cachedInputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 8
    } as unknown as AzureResponsesPricing;

    expect(
      calculateAzureResponsesCost(
        {
          model: 'priced-responses-model',
          pricingVersion: 'v-test',
          inputTokens: 1_000_000,
          outputTokens: 0
        },
        [incompletePricing]
      )
    ).toEqual({ costUsd: null, pricingStatus: 'unpriced' });
  });

  const validResponsesPricing: AzureResponsesPricing = {
    model: 'priced-responses-model',
    pricingVersion: 'v-test',
    baseModel: 'priced-base-model',
    modelVersion: '2026-01-01',
    sku: 'GlobalStandard',
    currency: 'USD',
    effectiveDate: '2026-01-01',
    meterSource: 'official-test-meter',
    inputUsdPerMillionTokens: 4,
    cachedInputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 8
  };

  it.each([
    ['deployment model', 'model', ' '],
    ['pricing version', 'pricingVersion', '']
  ])('fails closed when both usage and pricing have a blank %s', (_description, field, value) => {
    const invalidPricing = {
      ...validResponsesPricing,
      [field]: value
    } as AzureResponsesPricing;
    const usageIdentity = {
      model: validResponsesPricing.model,
      pricingVersion: validResponsesPricing.pricingVersion,
      [field]: value
    };

    expect(
      calculateAzureResponsesCost(
        {
          ...usageIdentity,
          inputTokens: 1_000_000,
          outputTokens: 0
        },
        [invalidPricing]
      )
    ).toEqual({ costUsd: null, pricingStatus: 'unpriced' });
  });

  it.each([
    ['blank base model', { baseModel: ' ' }],
    ['blank model version', { modelVersion: '' }],
    ['non-USD currency', { currency: 'EUR' }],
    ['blank effective date', { effectiveDate: '' }],
    ['non-padded effective date', { effectiveDate: '2026-1-01' }],
    ['impossible effective date', { effectiveDate: '2026-02-30' }],
    ['blank meter source', { meterSource: '\t' }],
    ['non-string meter source', { meterSource: 123 }],
    ['no SKU or service tier', { sku: undefined, serviceTier: undefined }],
    ['blank SKU without service tier', { sku: ' ', serviceTier: undefined }],
    ['both SKU and service tier', { sku: 'GlobalStandard', serviceTier: 'Standard' }],
    ['negative input rate', { inputUsdPerMillionTokens: -1 }],
    ['non-finite input rate', { inputUsdPerMillionTokens: Number.POSITIVE_INFINITY }],
    ['NaN cached-input rate', { cachedInputUsdPerMillionTokens: Number.NaN }],
    ['negative cached-input rate', { cachedInputUsdPerMillionTokens: -1 }],
    ['non-finite output rate', { outputUsdPerMillionTokens: Number.NEGATIVE_INFINITY }],
    ['negative output rate', { outputUsdPerMillionTokens: -1 }]
  ])('fails closed when pricing has %s', (_description, invalidFields) => {
    const invalidPricing = {
      ...validResponsesPricing,
      ...invalidFields
    } as unknown as AzureResponsesPricing;

    expect(
      calculateAzureResponsesCost(
        {
          model: 'priced-responses-model',
          pricingVersion: 'v-test',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000
        },
        [invalidPricing]
      )
    ).toEqual({ costUsd: null, pricingStatus: 'unpriced' });
  });

  it('accepts service tier as the sole authoritative billing tier', () => {
    const { sku: _sku, ...pricingWithoutSku } = validResponsesPricing;

    expect(
      calculateAzureResponsesCost(
        {
          model: 'priced-responses-model',
          pricingVersion: 'v-test',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000
        },
        [{ ...pricingWithoutSku, serviceTier: 'Standard' }]
      )
    ).toEqual({ costUsd: 12, pricingStatus: 'priced' });
  });

  it('prices cached input tokens at the catalog cached rate', () => {
    expect(
      calculateAzureResponsesCost(
        {
          model: 'priced-responses-model',
          pricingVersion: 'v-test',
          inputTokens: 1_000_000,
          cachedInputTokens: 250_000,
          outputTokens: 0
        },
        [
          {
            model: 'priced-responses-model',
            pricingVersion: 'v-test',
            baseModel: 'priced-base-model',
            modelVersion: '2026-01-01',
            sku: 'GlobalStandard',
            currency: 'USD',
            effectiveDate: '2026-01-01',
            meterSource: 'official-test-meter',
            inputUsdPerMillionTokens: 4,
            cachedInputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 8
          }
        ]
      )
    ).toEqual({ costUsd: 3.25, pricingStatus: 'priced' });
  });

  it('does not charge reasoning tokens again when output tokens already include them', () => {
    expect(
      calculateAzureResponsesCost(
        {
          model: 'priced-responses-model',
          pricingVersion: 'v-test',
          inputTokens: 0,
          outputTokens: 1_000_000,
          reasoningOutputTokens: 750_000
        },
        [
          {
            model: 'priced-responses-model',
            pricingVersion: 'v-test',
            baseModel: 'priced-base-model',
            modelVersion: '2026-01-01',
            sku: 'GlobalStandard',
            currency: 'USD',
            effectiveDate: '2026-01-01',
            meterSource: 'official-test-meter',
            inputUsdPerMillionTokens: 4,
            cachedInputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 8
          }
        ]
      )
    ).toEqual({ costUsd: 8, pricingStatus: 'priced' });
  });

  it('reports known actual spend as a lower bound when some usage is unpriced', () => {
    expect(
      sumActualConsumedUsd(
        [
          {
            id: 'usage_priced',
            jobId: 'job_1',
            submitterId: 'user_1',
            quotaDayKey: '2026-04-09',
            entryType: 'actual',
            stage: 'transcription',
            provider: 'azure-openai-gpt-4o-transcribe',
            model: 'gpt-4o-transcribe',
            pricingVersion: 'v1',
            usageQuantity: 1000,
            usageUnit: 'audio-ms',
            pricingStatus: 'priced',
            costUsd: 0.1,
            createdAt: '2026-04-09T00:00:00.000Z'
          },
          {
            id: 'usage_unpriced',
            jobId: 'job_1',
            submitterId: 'user_1',
            quotaDayKey: '2026-04-09',
            entryType: 'actual',
            stage: 'punctuation',
            provider: 'azure-openai',
            model: 'gpt-5.6-luna',
            pricingVersion: 'v1',
            usageQuantity: 1000,
            usageUnit: 'tokens',
            pricingStatus: 'unpriced',
            costUsd: null,
            createdAt: '2026-04-09T00:01:00.000Z'
          }
        ],
        'user_1',
        '2026-04-09'
      )
    ).toEqual({
      pricedCostUsd: 0.1,
      totalCostUsd: null,
      hasUnpricedUsage: true
    });
  });

  it('builds a stable quota day key for a timezone', () => {
    const key = buildQuotaDayKey(new Date('2026-04-09T00:30:00.000Z'), 'Asia/Taipei');
    expect(key).toBe('2026-04-09');
  });

  it('estimates cloud reservation for uploaded audio and meeting-link jobs', () => {
    expect(
      estimateCloudReservationUsd(
        {
          inputSource: 'uploaded-audio',
          transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
          transcriptionModel: 'gpt-4o-transcribe',
          summaryProvider: 'azure-openai'
        },
        { liveMeetingReservationCapUsd: 1.5 }
      )
    ).toBe(roundUsd(0.2));

    expect(
      estimateCloudReservationUsd(
        {
          inputSource: 'meeting-link',
          transcriptionProvider: 'azure-openai-gpt-4o-transcribe',
          summaryProvider: 'local-codex'
        },
        { liveMeetingReservationCapUsd: 1.5 }
      )
    ).toBe(1.5);
  });

  it('sums consumed and reserved usd and computes remaining quota', () => {
    const consumedUsd = sumActualConsumedUsd(
      [
        {
          id: 'usage_1',
          jobId: 'job_1',
          submitterId: 'user_1',
          quotaDayKey: '2026-04-09',
          entryType: 'actual',
          stage: 'transcription',
          provider: 'azure-openai-gpt-4o-transcribe',
          model: 'gpt-4o-transcribe',
          pricingVersion: 'v1',
          usageQuantity: 1000,
          usageUnit: 'audio-ms',
          pricingStatus: 'priced',
          costUsd: 0.1,
          createdAt: '2026-04-09T00:00:00.000Z'
        },
        {
          id: 'usage_2',
          jobId: 'job_2',
          submitterId: 'user_1',
          quotaDayKey: '2026-04-09',
          entryType: 'estimate',
          stage: 'summary',
          provider: 'azure-openai',
          model: 'gpt-5.4-nano',
          pricingVersion: 'v1',
          usageQuantity: 1000,
          usageUnit: 'tokens',
          pricingStatus: 'priced',
          costUsd: 0.2,
          createdAt: '2026-04-09T00:01:00.000Z'
        }
      ],
      'user_1',
      '2026-04-09'
    );

    const reservedUsd = sumReservedUsd(
      [
        {
          id: 'job_a',
          submitterId: 'user_1',
          quotaDayKey: '2026-04-09',
          state: 'queued',
          reservedCloudQuotaUsd: 0.4
        },
        {
          id: 'job_b',
          submitterId: 'user_1',
          quotaDayKey: '2026-04-09',
          state: 'completed',
          reservedCloudQuotaUsd: 0.7
        }
      ],
      'user_1',
      '2026-04-09'
    );

    expect(consumedUsd).toEqual({
      pricedCostUsd: 0.1,
      totalCostUsd: 0.1,
      hasUnpricedUsage: false
    });
    expect(reservedUsd).toBe(0.4);
    expect(
      calculateRemainingCloudQuotaUsd({
        dailyQuotaUsd: 2,
        consumedUsd: consumedUsd.pricedCostUsd,
        reservedUsd
      })
    ).toBe(1.5);
  });

  it('computes an azure transcription reservation estimate', () => {
    expect(
      estimateAzureTranscriptionReservationCostUsd(600000, {
        provider: 'azure-openai-gpt-4o-transcribe',
        model: 'gpt-4o-transcribe'
      })
    ).toBe(roundUsd(0.06));

    expect(
      estimateAzureTranscriptionReservationCostUsd(600000, {
        model: 'gpt-4o-mini-transcribe'
      })
    ).toBe(roundUsd(0.03));
  });
});
