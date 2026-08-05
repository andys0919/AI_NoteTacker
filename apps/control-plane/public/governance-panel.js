import { formatTwdFromUsd } from './currency-display.js';

export const formatProviderLabel = (value) => {
  if (value === 'azure-openai-gpt-4o-transcribe' || value === 'azure-openai') {
    return 'Azure OpenAI';
  }

  if (value === 'local-codex') {
    return 'Local Codex';
  }

  if (value === 'qwen3-asr-1.7b') {
    return 'Qwen3-ASR 1.7B';
  }

  if (value === 'azure-speech-mai-transcribe-1.5') {
    return 'Azure Speech MAI 1.5';
  }

  return 'Whisper 自架';
};

export const formatSummaryModeLabel = (value) =>
  value === 'azure-openai' ? '雲端' : '地端 Codex';

export const getCloudCostDisplayModel = ({
  totalCostUsd,
  pricedCostUsd,
  hasUnpricedUsage
}) => {
  if (!hasUnpricedUsage) {
    return {
      label: '總費用',
      value: formatTwdFromUsd(totalCostUsd)
    };
  }

  if (typeof pricedCostUsd === 'number' && Number.isFinite(pricedCostUsd) && pricedCostUsd > 0) {
    return {
      label: '已知費用',
      value: `${formatTwdFromUsd(pricedCostUsd)}（含未定價用量）`
    };
  }

  return {
    label: '費用',
    value: '未定價'
  };
};

export const formatUsageStageLabel = (stage) => {
  if (stage === 'transcription') {
    return '轉寫';
  }

  if (stage === 'punctuation') {
    return '潤稿';
  }

  return stage === 'summary' ? '摘要' : stage;
};

export const getUsageHistoryCostViewModel = (payload = {}) => {
  const totals = payload.totals ?? {};
  const totalCost = getCloudCostDisplayModel({
    totalCostUsd: totals.totalCostUsd,
    pricedCostUsd: totals.pricedCostUsd ?? totals.totalCostUsd,
    hasUnpricedUsage: totals.hasUnpricedUsage === true
  });
  const unpricedEntryCount = Number(totals.unpricedEntryCount) || 0;

  return {
    totalCostLabel: totalCost.value,
    totalCostSummary: `${totalCost.label} ${totalCost.value}${
      unpricedEntryCount > 0 ? ` / 未定價 ${unpricedEntryCount} 筆` : ''
    }`,
    byModel: (payload.byModel ?? []).map((row) => {
      const cost = getCloudCostDisplayModel({
        totalCostUsd: row.totalCostUsd ?? row.costUsd,
        pricedCostUsd: row.pricedCostUsd ?? row.costUsd,
        hasUnpricedUsage: row.hasUnpricedUsage === true
      });
      const rowUnpricedEntryCount = Number(row.unpricedEntryCount) || 0;

      return {
        ...row,
        stageLabel: formatUsageStageLabel(row.stage),
        costLabel: cost.value,
        unpricedCountLabel:
          rowUnpricedEntryCount > 0 ? `未定價 ${rowUnpricedEntryCount} 筆` : null
      };
    }),
    entries: (payload.entries ?? []).map((entry) => ({
      ...entry,
      stageLabel: formatUsageStageLabel(entry.stage),
      costLabel:
        entry.pricingStatus === 'unpriced'
          ? typeof entry.costUsd === 'number' && entry.costUsd > 0
            ? `${formatTwdFromUsd(entry.costUsd)}（含未定價用量）`
            : '未定價'
          : formatTwdFromUsd(entry.costUsd)
    }))
  };
};

export const getAdminGovernanceViewModel = ({
  state,
  selectedTranscriptionProvider,
  selectedSummaryProvider,
  transcriptionModelInput,
  summaryModelInput,
  pricingVersionInput,
  overrideSubmitterId,
  overrideQuotaInput
}) => {
  if (!state) {
    return {
      currentLabel: '目前不可用',
      pillText: '隱藏',
      pillTone: 'blocked',
      copyText: '管理員治理設定目前不可用。',
      submitDisabled: true,
      overrideDisabled: true,
      providerStatusText: '',
      overrideStatusText: ''
    };
  }

  const selectedTranscriptionOption = state.transcriptionOptions.find(
    (option) => option.value === selectedTranscriptionProvider
  );
  const selectedSummaryOption = state.summaryOptions.find(
    (option) => option.value === selectedSummaryProvider
  );
  const selectedReady = Boolean(selectedTranscriptionOption?.ready && selectedSummaryOption?.ready);
  const summaryModelInputDisabled = selectedSummaryProvider === 'local-codex';

  return {
    currentLabel: `${formatProviderLabel(state.transcriptionProvider)} / ${formatSummaryModeLabel(
      state.summaryProvider
    )}`,
    pillText: selectedReady ? '可用' : '未就緒',
    pillTone: selectedReady ? 'ready' : 'blocked',
    copyText: '新的治理設定只會影響之後新送出的工作。雲端 quota 也會依照新政策估算。',
    submitDisabled:
      !selectedReady ||
      !transcriptionModelInput.trim() ||
      (!summaryModelInputDisabled && !summaryModelInput.trim()) ||
      !pricingVersionInput.trim(),
    overrideDisabled: !overrideSubmitterId.trim() || !overrideQuotaInput.trim(),
    providerStatusText: selectedReady
      ? `目前預設：${formatProviderLabel(state.transcriptionProvider)} / ${formatSummaryModeLabel(
          state.summaryProvider
        )}`
      : selectedTranscriptionOption?.reason ||
        selectedSummaryOption?.reason ||
        '所選 provider 尚未可用。',
    overrideStatusText: state.overrides?.length
      ? `目前已有 ${state.overrides.length} 筆個人 quota override。`
      : '尚未設定個人 quota override。',
    summaryModelInputDisabled
  };
};

export const getQuotaDisplayModel = (payload) => {
  if (!payload) {
    return {
      hidden: true,
      remainingLabel: '',
      breakdownText: ''
    };
  }

  const consumed = getCloudCostDisplayModel({
    totalCostUsd: payload.consumedUsd,
    pricedCostUsd: payload.pricedConsumedUsd ?? payload.consumedUsd,
    hasUnpricedUsage: payload.hasUnpricedUsage === true
  });

  return {
    hidden: false,
    remainingLabel: `${formatTwdFromUsd(payload.remainingUsd)}${
      payload.hasUnpricedUsage ? '（依已知費用計算）' : ''
    }`,
    breakdownText: `${payload.hasUnpricedUsage ? consumed.label : '已用'} ${consumed.value} / 保留 ${formatTwdFromUsd(payload.reservedUsd)} / 總額 ${formatTwdFromUsd(payload.dailyQuotaUsd)}`
  };
};

export const getAuditEntryViewModels = (entries = [], formatTimestamp = (value) => value) =>
  entries.map((entry) => ({
    action: entry.action,
    target: entry.target,
    timestampText: formatTimestamp(entry.createdAt)
  }));

export const getUsageReportRowViewModels = (rows = []) =>
  rows.map((row) => {
    const consumed = getCloudCostDisplayModel({
      totalCostUsd: row.consumedUsd,
      pricedCostUsd: row.pricedConsumedUsd ?? row.consumedUsd,
      hasUnpricedUsage: row.hasUnpricedUsage === true
    });

    return {
      identityLabel: row.email || row.submitterId,
      submitterId: row.submitterId,
      reservedLabel: formatTwdFromUsd(row.reservedUsd),
      consumedTitle: row.hasUnpricedUsage ? consumed.label : '已用',
      consumedLabel: consumed.value,
      remainingLabel: `${formatTwdFromUsd(row.remainingUsd)}${
        row.hasUnpricedUsage ? '（依已知費用計算）' : ''
      }`,
      dailyQuotaLabel: formatTwdFromUsd(row.dailyQuotaUsd),
      entryCountLabel: `${row.entries?.length ?? 0} 筆`
    };
  });
