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

export const formatSummaryModeLabel = () => '本機 Codex';

const formatPercent = (value) =>
  `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

export const getCodexWeeklyUsageViewModel = (
  payload = {},
  formatTimestamp = (value) => value
) => {
  if (payload.status !== 'available') {
    return {
      available: false,
      headline: '暫時無法取得每週額度',
      statusText: '資料不可用',
      usedText: '—',
      remainingText: '—',
      resetText: '—',
      checkedText: payload.checkedAt ? formatTimestamp(payload.checkedAt) : '等待 worker 回報'
    };
  }

  const usedPercent = Math.min(100, Math.max(0, Number(payload.usedPercent) || 0));
  const remainingPercent = 100 - usedPercent;
  const planLabel = payload.planType === 'team' ? 'ChatGPT Business' : 'ChatGPT Codex';

  return {
    available: true,
    headline: `本週剩餘 ${formatPercent(remainingPercent)}`,
    statusText: remainingPercent > 0 ? planLabel : '額度已用罄',
    usedPercent,
    usedText: formatPercent(usedPercent),
    remainingText: formatPercent(remainingPercent),
    resetText: formatTimestamp(new Date(payload.resetsAt * 1000).toISOString()),
    checkedText: formatTimestamp(payload.checkedAt)
  };
};

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

const formatUsageEntryCost = (entry) => {
  if (entry.pricingStatus === 'not-applicable') {
    return '訂閱／自架，不計 Azure API 費';
  }
  if (entry.pricingStatus === 'pending') {
    return '待結算';
  }
  if (entry.pricingStatus === 'unpriced') {
    return typeof entry.costUsd === 'number' && entry.costUsd > 0
      ? `${formatTwdFromUsd(entry.costUsd)}（含未定價用量）`
      : '未定價';
  }
  return formatTwdFromUsd(entry.costUsd);
};

const formatProviderRequestStatus = (status) =>
  status === 'succeeded' ? '成功' : status === 'failed' ? '失敗' : '進行中';

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
        costLabel:
          row.billingClass && row.billingClass !== 'metered-api'
            ? '不計 Azure API 費'
            : cost.value,
        unpricedCountLabel:
          rowUnpricedEntryCount > 0 ? `未定價 ${rowUnpricedEntryCount} 筆` : null
      };
    }),
    entries: (payload.entries ?? []).map((entry) => ({
      ...entry,
      stageLabel: formatUsageStageLabel(entry.stage),
      ...(entry.recordKind === 'provider-request'
        ? { requestStatusLabel: formatProviderRequestStatus(entry.requestStatus) }
        : {}),
      costLabel: formatUsageEntryCost(entry)
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
  const summaryModelInputDisabled = false;

  return {
    currentLabel: `${formatProviderLabel(state.transcriptionProvider)} / ${formatSummaryModeLabel(
      state.summaryProvider
    )}`,
    pillText: selectedReady ? '可用' : '未就緒',
    pillTone: selectedReady ? 'ready' : 'blocked',
    copyText:
      '新的治理設定只影響之後送出的工作；摘要預設走 Local Codex，僅在 Codex 明確額度用罄時單次切 Azure，Azure 用量照 API 入帳。',
    submitDisabled:
      !selectedReady ||
      !transcriptionModelInput.trim() ||
      !summaryModelInput.trim() ||
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
      entryCountLabel: `${(row.entries?.length ?? 0) + (row.providerRequests?.length ?? 0)} 筆`
    };
  });
