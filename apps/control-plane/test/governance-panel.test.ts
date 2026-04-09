import { describe, expect, it } from 'vitest';

import {
  formatProviderLabel,
  formatSummaryModeLabel,
  formatUsd,
  getAdminGovernanceViewModel,
  getAuditEntryViewModels,
  getQuotaDisplayModel,
  getUsageReportRowViewModels
} from '../public/governance-panel.js';

describe('governance panel helpers', () => {
  it('formats provider labels for transcription and summary routes', () => {
    expect(formatProviderLabel('self-hosted-whisper')).toBe('Whisper 自架');
    expect(formatProviderLabel('azure-openai-gpt-4o-mini-transcribe')).toBe('Azure OpenAI');
    expect(formatSummaryModeLabel('local-codex')).toBe('地端 Codex');
    expect(formatSummaryModeLabel('azure-openai')).toBe('雲端');
  });

  it('formats usd values with fixed precision', () => {
    expect(formatUsd(1.23456)).toBe('$1.235');
    expect(formatUsd(0)).toBe('$0.000');
    expect(formatUsd(undefined)).toBe('$0.000');
  });

  it('builds an enabled admin governance view model when providers are ready', () => {
    const model = getAdminGovernanceViewModel({
      state: {
        transcriptionProvider: 'self-hosted-whisper',
        summaryProvider: 'local-codex',
        transcriptionOptions: [
          { value: 'self-hosted-whisper', ready: true },
          { value: 'azure-openai-gpt-4o-mini-transcribe', ready: true }
        ],
        summaryOptions: [
          { value: 'local-codex', ready: true },
          { value: 'azure-openai', ready: true }
        ],
        overrides: [{ submitterId: 'user-1', dailyQuotaUsd: 2 }]
      },
      selectedTranscriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
      selectedSummaryProvider: 'azure-openai',
      transcriptionModelInput: 'gpt-4o-mini-transcribe',
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
            value: 'azure-openai-gpt-4o-mini-transcribe',
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
      selectedTranscriptionProvider: 'azure-openai-gpt-4o-mini-transcribe',
      selectedSummaryProvider: 'azure-openai',
      transcriptionModelInput: 'gpt-4o-mini-transcribe',
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
        consumedLabel: '$1.250',
        remainingLabel: '$3.250',
        dailyQuotaLabel: '$5.000',
        entryCountLabel: '2 筆'
      }
    ]);
  });
});
