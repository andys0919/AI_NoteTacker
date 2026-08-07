import { describe, expect, it } from 'vitest';

import {
  formatProviderLabel,
  formatSummaryModeLabel,
  formatUsageStageLabel,
  getAdminGovernanceViewModel,
  getAuditEntryViewModels,
  getCloudCostDisplayModel,
  getCodexWeeklyUsageViewModel,
  getUsageHistoryCostViewModel,
  getUsageReportRowViewModels
} from '../public/governance-panel.js';

describe('governance panel helpers', () => {
  it('formats provider-reported Codex weekly usage without inventing missing data', () => {
    expect(
      getCodexWeeklyUsageViewModel(
        {
          status: 'available',
          planType: 'team',
          usedPercent: 37.5,
          resetsAt: 1_786_680_000,
          checkedAt: '2026-08-07T04:00:00.000Z'
        },
        (value) => value
      )
    ).toMatchObject({
      available: true,
      headline: '本週剩餘 62.5%',
      statusText: 'ChatGPT Business',
      usedText: '37.5%',
      remainingText: '62.5%',
      checkedText: '2026-08-07T04:00:00.000Z'
    });

    expect(getCodexWeeklyUsageViewModel({ status: 'unavailable' })).toMatchObject({
      available: false,
      headline: '暫時無法取得每週額度',
      usedText: '—',
      remainingText: '—'
    });
  });

  it('formats provider labels for transcription and summary routes', () => {
    expect(formatProviderLabel('self-hosted-whisper')).toBe('Whisper 自架');
    expect(formatProviderLabel('qwen3-asr-1.7b')).toBe('Qwen3-ASR 1.7B');
    expect(formatProviderLabel('azure-speech-mai-transcribe-1.5')).toBe(
      'Azure Speech MAI 1.5'
    );
    expect(formatProviderLabel('azure-openai-gpt-4o-transcribe')).toBe('Azure OpenAI');
    expect(formatSummaryModeLabel('local-codex')).toBe('本機 Codex');
  });

  it('formats known cost separately from unpriced usage', () => {
    expect(
      getCloudCostDisplayModel({
        totalCostUsd: null,
        pricedCostUsd: 1.25,
        hasUnpricedUsage: true
      })
    ).toEqual({
      label: '已知費用',
      value: 'NT$39.90（含未定價用量）'
    });
    expect(
      getCloudCostDisplayModel({
        totalCostUsd: null,
        pricedCostUsd: 0,
        hasUnpricedUsage: true
      })
    ).toEqual({
      label: '費用',
      value: '未定價'
    });
    expect(
      getCloudCostDisplayModel({
        totalCostUsd: 1.25,
        pricedCostUsd: 1.25,
        hasUnpricedUsage: false
      })
    ).toEqual({
      label: '總費用',
      value: 'NT$39.90'
    });
  });

  it('adds the punctuation stage label', () => {
    expect(formatUsageStageLabel('transcription')).toBe('轉寫');
    expect(formatUsageStageLabel('punctuation')).toBe('潤稿');
    expect(formatUsageStageLabel('summary')).toBe('摘要');
  });

  it('builds history cost labels for nullable totals, models, and entries', () => {
    expect(
      getUsageHistoryCostViewModel({
        totals: {
          pricedCostUsd: 0.12,
          totalCostUsd: null,
          hasUnpricedUsage: true,
          unpricedEntryCount: 2
        },
        byModel: [
          {
            model: 'gpt-5.6-luna',
            stage: 'punctuation',
            pricedCostUsd: 0,
            totalCostUsd: null,
            hasUnpricedUsage: true,
            unpricedEntryCount: 1
          }
        ],
        entries: [
          {
            id: 'usage-1',
            stage: 'punctuation',
            pricingStatus: 'unpriced',
            costUsd: 0.08
          }
        ]
      })
    ).toEqual({
      totalCostLabel: 'NT$3.83（含未定價用量）',
      totalCostSummary: '已知費用 NT$3.83（含未定價用量） / 未定價 2 筆',
      byModel: [
        {
          model: 'gpt-5.6-luna',
          stage: 'punctuation',
          pricedCostUsd: 0,
          totalCostUsd: null,
          hasUnpricedUsage: true,
          unpricedEntryCount: 1,
          stageLabel: '潤稿',
          costLabel: '未定價',
          unpricedCountLabel: '未定價 1 筆'
        }
      ],
      entries: [
        {
          id: 'usage-1',
          stage: 'punctuation',
          pricingStatus: 'unpriced',
          costUsd: 0.08,
          stageLabel: '潤稿',
          costLabel: 'NT$2.55（含未定價用量）'
        }
      ]
    });
  });

  it('separates subscription request usage from Azure API spend', () => {
    const model = getUsageHistoryCostViewModel({
      byModel: [
        {
          model: 'gpt-5.6-luna',
          stage: 'summary',
          billingClass: 'subscription',
          totalCostUsd: 0,
          hasUnpricedUsage: false
        }
      ],
      entries: [
        {
          id: 'request-local-1',
          recordKind: 'provider-request',
          stage: 'summary',
          requestStatus: 'succeeded',
          pricingStatus: 'not-applicable',
          costUsd: null
        },
        {
          id: 'request-azure-1',
          recordKind: 'provider-request',
          stage: 'summary',
          requestStatus: 'started',
          pricingStatus: 'pending',
          costUsd: null
        }
      ]
    });

    expect(model.byModel[0].costLabel).toBe('不計 Azure API 費');
    expect(model.entries[0]).toMatchObject({
      requestStatusLabel: '成功',
      costLabel: '訂閱／自架，不計 Azure API 費'
    });
    expect(model.entries[1]).toMatchObject({
      requestStatusLabel: '進行中',
      costLabel: '待結算'
    });
  });

  it('builds an enabled admin governance view model when providers are ready', () => {
    const model = getAdminGovernanceViewModel({
      state: {
        transcriptionProvider: 'self-hosted-whisper',
        summaryProvider: 'local-codex',
        transcriptionOptions: [
          { value: 'self-hosted-whisper', ready: true },
          { value: 'azure-openai-gpt-4o-transcribe', ready: true }
        ],
        summaryOptions: [{ value: 'local-codex', ready: true }],
        overrides: [{ submitterId: 'user-1', dailyQuotaUsd: 2 }]
      },
      selectedTranscriptionProvider: 'azure-openai-gpt-4o-transcribe',
      selectedSummaryProvider: 'local-codex',
      transcriptionModelInput: 'gpt-4o-transcribe',
      summaryModelInput: 'gpt-5.4-nano',
      pricingVersionInput: 'v1',
      overrideSubmitterId: 'user-1',
      overrideQuotaInput: '2.5'
    });

    expect(model.currentLabel).toBe('Whisper 自架 / 本機 Codex');
    expect(model.pillText).toBe('可用');
    expect(model.pillTone).toBe('ready');
    expect(model.submitDisabled).toBe(false);
    expect(model.overrideDisabled).toBe(false);
    expect(model.overrideStatusText).toBe('目前已有 1 筆個人 quota override。');
    expect(model.summaryModelInputDisabled).toBe(false);
  });

  it('builds a blocked admin governance view model when a selected provider is not ready', () => {
    const model = getAdminGovernanceViewModel({
      state: {
        transcriptionProvider: 'self-hosted-whisper',
        summaryProvider: 'local-codex',
        transcriptionOptions: [
          { value: 'self-hosted-whisper', ready: true },
          {
            value: 'azure-openai-gpt-4o-transcribe',
            ready: false,
            reason: 'Azure transcription is not configured.'
          }
        ],
        summaryOptions: [{ value: 'local-codex', ready: true }],
        overrides: []
      },
      selectedTranscriptionProvider: 'azure-openai-gpt-4o-transcribe',
      selectedSummaryProvider: 'local-codex',
      transcriptionModelInput: 'gpt-4o-transcribe',
      summaryModelInput: 'gpt-5.4-nano',
      pricingVersionInput: 'v1',
      overrideSubmitterId: '',
      overrideQuotaInput: ''
    });

    expect(model.pillText).toBe('未就緒');
    expect(model.pillTone).toBe('blocked');
    expect(model.submitDisabled).toBe(true);
    expect(model.overrideDisabled).toBe(true);
    expect(model.providerStatusText).toBe('Azure transcription is not configured.');
    expect(model.overrideStatusText).toBe('尚未設定個人 quota override。');
    expect(model.summaryModelInputDisabled).toBe(false);
  });

  it('requires an explicit local Codex summary model', () => {
    const model = getAdminGovernanceViewModel({
      state: {
        transcriptionProvider: 'self-hosted-whisper',
        summaryProvider: 'local-codex',
        transcriptionOptions: [{ value: 'self-hosted-whisper', ready: true }],
        summaryOptions: [{ value: 'local-codex', ready: true }],
        overrides: []
      },
      selectedTranscriptionProvider: 'self-hosted-whisper',
      selectedSummaryProvider: 'local-codex',
      transcriptionModelInput: 'large-v3',
      summaryModelInput: '',
      pricingVersionInput: 'v1',
      overrideSubmitterId: '',
      overrideQuotaInput: ''
    });

    expect(model.submitDisabled).toBe(true);
    expect(model.summaryModelInputDisabled).toBe(false);
  });

  it('builds an empty audit entry list and formatted entry view models', () => {
    expect(getAuditEntryViewModels([])).toEqual([]);

    expect(
      getAuditEntryViewModels(
        [
          {
            action: 'ai-policy.updated',
            target: 'ai-policy',
            createdAt: '2026-04-09T00:00:00.000Z'
          }
        ],
        (value) => `time:${value}`
      )
    ).toEqual([
      {
        action: 'ai-policy.updated',
        target: 'ai-policy',
        timestampText: 'time:2026-04-09T00:00:00.000Z'
      }
    ]);
  });

  it('builds usage report row view models with formatted currency labels', () => {
    expect(
      getUsageReportRowViewModels([
        {
          submitterId: 'user-1',
          email: 'user@example.com',
          dailyQuotaUsd: 5,
          reservedUsd: 0.5,
          consumedUsd: 1.25,
          remainingUsd: 3.25,
          entries: [{ stage: 'transcription' }, { stage: 'summary' }]
        }
      ])
    ).toEqual([
      {
        identityLabel: 'user@example.com',
        submitterId: 'user-1',
        reservedLabel: 'NT$15.96',
        consumedTitle: '已用',
        consumedLabel: 'NT$39.90',
        remainingLabel: 'NT$103.73',
        dailyQuotaLabel: 'NT$159.59',
        entryCountLabel: '2 筆'
      }
    ]);
  });

  it('labels report rows with a known subtotal when their complete cost is unpriced', () => {
    expect(
      getUsageReportRowViewModels([
        {
          submitterId: 'user-1',
          dailyQuotaUsd: 5,
          reservedUsd: 0.5,
          consumedUsd: null,
          pricedConsumedUsd: 1.25,
          hasUnpricedUsage: true,
          remainingUsd: 3.25,
          entries: [{ stage: 'summary', pricingStatus: 'unpriced', costUsd: null }]
        }
      ])[0]
    ).toMatchObject({
      consumedTitle: '已知費用',
      consumedLabel: 'NT$39.90（含未定價用量）',
      remainingLabel: 'NT$103.73（依已知費用計算）'
    });
  });
});
