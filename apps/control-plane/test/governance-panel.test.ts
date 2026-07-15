import { describe, expect, it } from 'vitest';

import {
  formatProviderLabel,
  formatSummaryModeLabel,
  formatUsageStageLabel,
  formatUsd,
  getAdminGovernanceViewModel,
  getAuditEntryViewModels,
  getCloudCostDisplayModel,
  getQuotaDisplayModel,
  getUsageHistoryCostViewModel,
  getUsageReportRowViewModels
} from '../public/governance-panel.js';

describe('governance panel helpers', () => {
  it('formats provider labels for transcription and summary routes', () => {
    expect(formatProviderLabel('self-hosted-whisper')).toBe('Whisper 自架');
    expect(formatProviderLabel('azure-openai-gpt-4o-transcribe')).toBe('Azure OpenAI');
    expect(formatSummaryModeLabel('local-codex')).toBe('地端 Codex');
    expect(formatSummaryModeLabel('azure-openai')).toBe('雲端');
  });

  it('formats usd values with fixed precision', () => {
    expect(formatUsd(1.23456)).toBe('$1.235');
    expect(formatUsd(0)).toBe('$0.000');
    expect(formatUsd(null)).toBe('未定價');
    expect(formatUsd(undefined)).toBe('未定價');
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
      value: '$1.250（含未定價用量）'
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
      value: '$1.250'
    });
  });

  it('adds the punctuation stage label', () => {
    expect(formatUsageStageLabel('transcription')).toBe('轉寫');
    expect(formatUsageStageLabel('punctuation')).toBe('標點');
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
            costUsd: null
          }
        ]
      })
    ).toEqual({
      totalCostLabel: '$0.120（含未定價用量）',
      totalCostSummary: '已知費用 $0.120（含未定價用量） / 未定價 2 筆',
      byModel: [
        {
          model: 'gpt-5.6-luna',
          stage: 'punctuation',
          pricedCostUsd: 0,
          totalCostUsd: null,
          hasUnpricedUsage: true,
          unpricedEntryCount: 1,
          stageLabel: '標點',
          costLabel: '未定價',
          unpricedCountLabel: '未定價 1 筆'
        }
      ],
      entries: [
        {
          id: 'usage-1',
          stage: 'punctuation',
          pricingStatus: 'unpriced',
          costUsd: null,
          stageLabel: '標點',
          costLabel: '未定價'
        }
      ]
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
        summaryOptions: [
          { value: 'local-codex', ready: true },
          { value: 'azure-openai', ready: true }
        ],
        overrides: [{ submitterId: 'user-1', dailyQuotaUsd: 2 }]
      },
      selectedTranscriptionProvider: 'azure-openai-gpt-4o-transcribe',
      selectedSummaryProvider: 'azure-openai',
      transcriptionModelInput: 'gpt-4o-transcribe',
      summaryModelInput: 'gpt-5.4-nano',
      pricingVersionInput: 'v1',
      overrideSubmitterId: 'user-1',
      overrideQuotaInput: '2.5'
    });

    expect(model.currentLabel).toBe('Whisper 自架 / 地端 Codex');
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
        summaryOptions: [
          { value: 'local-codex', ready: true },
          { value: 'azure-openai', ready: true }
        ],
        overrides: []
      },
      selectedTranscriptionProvider: 'azure-openai-gpt-4o-transcribe',
      selectedSummaryProvider: 'azure-openai',
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

  it('does not require a summary model when local codex is selected', () => {
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

    expect(model.submitDisabled).toBe(false);
    expect(model.summaryModelInputDisabled).toBe(true);
  });

  it('requires a summary model when cloud summary is selected', () => {
    const model = getAdminGovernanceViewModel({
      state: {
        transcriptionProvider: 'self-hosted-whisper',
        summaryProvider: 'azure-openai',
        transcriptionOptions: [{ value: 'self-hosted-whisper', ready: true }],
        summaryOptions: [{ value: 'azure-openai', ready: true }],
        overrides: []
      },
      selectedTranscriptionProvider: 'self-hosted-whisper',
      selectedSummaryProvider: 'azure-openai',
      transcriptionModelInput: 'large-v3',
      summaryModelInput: '',
      pricingVersionInput: 'v1',
      overrideSubmitterId: '',
      overrideQuotaInput: ''
    });

    expect(model.submitDisabled).toBe(true);
    expect(model.summaryModelInputDisabled).toBe(false);
  });

  it('builds a visible quota display model', () => {
    expect(
      getQuotaDisplayModel({
        dailyQuotaUsd: 5,
        consumedUsd: 1.25,
        reservedUsd: 0.5,
        remainingUsd: 3.25
      })
    ).toEqual({
      hidden: false,
      remainingLabel: '$3.250',
      breakdownText: '已用 $1.250 / 保留 $0.500 / 總額 $5.000'
    });
  });

  it('shows quota consumption as known cost when usage also contains unpriced entries', () => {
    expect(
      getQuotaDisplayModel({
        dailyQuotaUsd: 5,
        consumedUsd: null,
        pricedConsumedUsd: 1.25,
        hasUnpricedUsage: true,
        reservedUsd: 0.5,
        remainingUsd: 3.25
      })
    ).toEqual({
      hidden: false,
      remainingLabel: '$3.250（依已知費用計算）',
      breakdownText: '已知費用 $1.250（含未定價用量） / 保留 $0.500 / 總額 $5.000'
    });
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
        reservedLabel: '$0.500',
        consumedTitle: '已用',
        consumedLabel: '$1.250',
        remainingLabel: '$3.250',
        dailyQuotaLabel: '$5.000',
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
      consumedLabel: '$1.250（含未定價用量）',
      remainingLabel: '$3.250（依已知費用計算）'
    });
  });
});
