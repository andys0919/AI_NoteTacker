const queueLabels = {
  meeting: '會議錄製',
  transcription: '轉寫',
  summary: '摘要'
};

const formatCompactDuration = (milliseconds) => {
  if (typeof milliseconds !== 'number' || Number.isNaN(milliseconds)) {
    return '0s';
  }

  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.round(totalSeconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const formatExpiryDuration = (milliseconds) =>
  typeof milliseconds === 'number' && milliseconds > 0
    ? formatCompactDuration(milliseconds)
    : 'expired';

export const getRuntimeHealthViewModel = (payload) => {
  const queueCards = ['meeting', 'transcription', 'summary'].map((key) => {
    const queue = payload?.queues?.[key] ?? {
      active: 0,
      queued: 0,
      capacity: 0,
      saturated: false
    };

    return {
      label: queueLabels[key],
      valueText: `${queue.active} active / ${queue.queued} queued`,
      capacityText: `capacity ${queue.capacity}`,
      tone: queue.saturated ? 'warn' : 'ok'
    };
  });

  const topFailureCode = payload?.failures?.codes?.[0]?.code;

  return {
    summaryText: `${payload?.quotaDayKey ?? '-'} / ${payload?.throughput?.uploadedToday ?? 0} uploads / ${payload?.throughput?.completedToday ?? 0} completed`,
    queueCards,
    leaseHeadline:
      payload?.leases?.active?.length > 0
        ? `最老 lease ${formatCompactDuration(payload.leases.oldestLeaseAgeMs)}`
        : '沒有 active lease',
    leaseRows: (payload?.leases?.active ?? []).map((lease) => ({
      stageLabel: lease.stage.toUpperCase(),
      detailText: `${lease.submitterId} / ${lease.workerId} / ${lease.processingStage ?? lease.state}`,
      heartbeatText: `hb ${formatCompactDuration(lease.heartbeatAgeMs)} ago / exp ${formatExpiryDuration(lease.expiresInMs)}`
    })),
    failureText: `今日失敗 ${payload?.failures?.failedToday ?? 0} / ${payload?.failures?.terminalToday ?? 0} (${Math.round(
      (payload?.failures?.failureRate ?? 0) * 100
    )}%)${topFailureCode ? ` / top ${topFailureCode}` : ''}`,
    cleanupText: payload?.cleanup?.policyConfigured
      ? `Cleanup backlog ${payload.cleanup.pendingJobs} jobs`
      : 'Artifact cleanup policy 尚未啟用'
  };
};
