export const formatProviderLabel = (value) => {
  if (value === 'azure-openai-gpt-4o-mini-transcribe' || value === 'azure-openai') {
    return 'Azure OpenAI';
  }

  if (value === 'local-codex') {
    return 'Local Codex';
  }

  return 'Whisper 自架';
};

export const formatSummaryModeLabel = (value) =>
  value === 'azure-openai' ? '雲端' : '地端 Codex';

export const formatUsd = (value) => `$${Number(value || 0).toFixed(3)}`;

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

  return {
    hidden: false,
    remainingLabel: formatUsd(payload.remainingUsd),
    breakdownText: `已用 ${formatUsd(payload.consumedUsd)} / 保留 ${formatUsd(payload.reservedUsd)} / 總額 ${formatUsd(payload.dailyQuotaUsd)}`
  };
};

export const getAuditEntryViewModels = (entries = [], formatTimestamp = (value) => value) =>
  entries.map((entry) => ({
    action: entry.action,
    target: entry.target,
    timestampText: formatTimestamp(entry.createdAt)
  }));

export const getUsageReportRowViewModels = (rows = []) =>
  rows.map((row) => ({
    identityLabel: row.email || row.submitterId,
    submitterId: row.submitterId,
    reservedLabel: formatUsd(row.reservedUsd),
    consumedLabel: formatUsd(row.consumedUsd),
    remainingLabel: formatUsd(row.remainingUsd),
    dailyQuotaLabel: formatUsd(row.dailyQuotaUsd),
    entryCountLabel: `${row.entries?.length ?? 0} 筆`
  }));
