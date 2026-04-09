import { describe, expect, it } from 'vitest';

import {
  buildQuotaDayKey,
  calculateAzureSummaryCostUsd,
  calculateAzureTranscriptionCostUsd,
  calculateRemainingCloudQuotaUsd,
  estimateCloudReservationUsd,
  roundUsd,
  sumActualConsumedUsd,
  sumReservedUsd
} from '../src/domain/cloud-usage.js';

describe('cloud usage helpers', () => {
  it('builds a stable quota day key for a timezone', () => {
    const key = buildQuotaDayKey(new Date('2026-04-09T00:30:00.000Z'), 'Asia/Taipei');
    expect(key).toBe('2026-04-09');
  });

  it('estimates cloud reservation for uploaded audio and meeting-link jobs', () => {
    expect(
      estimateCloudReservationUsd(
        {
          inputSource: 'uploaded-audio',
          transcriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
          transcriptionModel: 'gpt-4o-mini-transcribe',
          summaryProvider: 'azure-openai'
        },
        { liveMeetingReservationCapUsd: 1.5 }
      )
    ).toBe(roundUsd(0.11));

    expect(
      estimateCloudReservationUsd(
        {
          inputSource: 'meeting-link',
          transcriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
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
          provider: 'azure-openai-gpt-4o-mini-transcribe',
          model: 'gpt-4o-mini-transcribe',
          pricingVersion: 'v1',
          usageQuantity: 1000,
          usageUnit: 'audio-ms',
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

    expect(consumedUsd).toBe(0.1);
    expect(reservedUsd).toBe(0.4);
    expect(
      calculateRemainingCloudQuotaUsd({
        dailyQuotaUsd: 2,
        consumedUsd,
        reservedUsd
      })
    ).toBe(1.5);
  });

  it('computes azure summary and transcription costs', () => {
    expect(
      calculateAzureSummaryCostUsd({
        promptTokens: 1000,
        completionTokens: 500
      })
    ).toBe(roundUsd(0.002));

    expect(
      calculateAzureTranscriptionCostUsd(600000, {
        provider: 'azure-openai-gpt-4o-mini-transcribe',
        model: 'gpt-4o-mini-transcribe'
      })
    ).toBe(roundUsd(0.03));
  });
});
