import { getJobProgressModel, getProgressLabel } from './job-progress.js';

const badgeLabels = {
  queued: '排隊中',
  joining: '準備中',
  recording: '錄製中',
  transcribing: '整理中',
  completed: '已完成',
  failed: '失敗'
};

const getBadgeLabel = (state) => badgeLabels[state] ?? '處理中';

const getMeetingStatusSummary = (job, runtimeState) => {
  if (job.processingStage === 'finalizing-recording' && !job.recordingArtifact && job.state === 'joining') {
    return '系統正在取消尚未被允許入會的請求，這場會議不會產生錄音。';
  }

  if (job.processingStage === 'finalizing-recording') {
    return '系統正在結束錄製並整理檔案，接著會繼續產出逐字稿與摘要。';
  }

  if (runtimeState === 'queued') {
    return '已收到會議，系統會依序加入並開始整理內容。';
  }

  if (runtimeState === 'joining') {
    return '系統正在加入會議並確認錄製狀態。';
  }

  if (runtimeState === 'recording') {
    return '系統正在擷取會議內容，完成後會自動產出逐字稿與摘要。';
  }

  if (runtimeState === 'transcribing') {
    return '錄音已完成，系統正在產出逐字稿與摘要。';
  }

  return '系統正在整理這場會議。';
};

const getUploadStatusSummary = (job) => {
  if (job.processingStage === 'preparing-media') {
    return '系統正在整理媒體格式，稍後會開始轉寫。';
  }

  if (job.processingStage === 'generating-summary') {
    return '逐字稿已完成，系統正在整理重點摘要。';
  }

  if (job.processingStage === 'summary-pending') {
    return '逐字稿已完成，正在等待摘要工作開始。';
  }

  if (job.state === 'queued') {
    return '錄音檔已加入整理流程，系統會依序開始轉寫。';
  }

  if (job.state === 'transcribing') {
    return '系統正在轉寫音訊並整理摘要。';
  }

  return '系統正在整理這份錄音內容。';
};

const getStatusSummary = (job, runtimeState) => {
  if (job.state === 'failed') {
    return job.failureMessage ?? '處理失敗，請檢查來源內容後重新送出。';
  }

  if (job.state === 'completed') {
    if (job.transcriptArtifact && !job.summaryArtifact) {
      return '逐字稿已完成，但摘要尚未產生。';
    }

    return '逐字稿與摘要已完成，可直接查看或匯出。';
  }

  return job.inputSource === 'meeting-link'
    ? getMeetingStatusSummary(job, runtimeState)
    : getUploadStatusSummary(job);
};

export const getEmptyStateMessage = (search) =>
  search
    ? `找不到符合「${search}」的紀錄，請改用會議名稱、連結或摘要關鍵字搜尋。`
    : '目前還沒有任何工作。送出會議連結或上傳錄音後，系統會在這裡顯示進度與結果。';

export const renderOptionalMarkup = (value) => (typeof value === 'string' ? value : '');

export const getHistoryStageLabel = (stage) => getProgressLabel(stage || 'queued');

export const formatJobTimestamp = (value) =>
  new Date(value).toLocaleString('zh-TW', {
    hour12: false
  });

const formatUsd = (value) => `$${Number(value || 0).toFixed(3)}`;

const formatDuration = (milliseconds) => {
  if (typeof milliseconds !== 'number' || milliseconds <= 0) {
    return null;
  }

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const getTranscriptDurationMs = (job) => {
  const segments = job.transcriptArtifact?.segments;

  if (!segments?.length) {
    return null;
  }

  const durationMs = segments.reduce(
    (currentMax, segment) =>
      Math.max(currentMax, typeof segment.endMs === 'number' ? segment.endMs : 0),
    0
  );

  return durationMs > 0 ? durationMs : null;
};

const getJobDurationText = (job) =>
  formatDuration(
    typeof job.progressTotalMs === 'number' && job.progressTotalMs > 0
      ? job.progressTotalMs
      : getTranscriptDurationMs(job)
  );

export const getJobCardViewModel = (job) => {
  const runtimeState = job.displayState || job.state || 'queued';
  const progress = getJobProgressModel({
    inputSource: job.inputSource,
    state: job.state,
    displayState: runtimeState,
    processingStage: job.processingStage,
    progressPercent: job.progressPercent,
    progressProcessedMs: job.progressProcessedMs,
    progressTotalMs: job.progressTotalMs
  });
  const durationText = getJobDurationText(job);

  return {
    title: job.inputSource === 'uploaded-audio' ? '錄音整理' : '會議摘要',
    sourceLabel: job.inputSource === 'uploaded-audio' ? '檔案' : '會議連結',
    sourceValue:
      job.inputSource === 'uploaded-audio'
        ? job.uploadedFileName ?? '已上傳錄音檔'
        : job.meetingUrl ?? '未提供會議連結',
    joinNameLabel: job.inputSource === 'meeting-link' ? '顯示名稱' : null,
    joinNameValue:
      job.inputSource === 'meeting-link' ? job.requestedJoinName ?? '使用預設名稱' : null,
    badgeLabel: getBadgeLabel(runtimeState),
    badgeTone: runtimeState,
    statusSummary: getStatusSummary(job, runtimeState),
    progressLabel: progress.label,
    progressPercent: progress.percent,
    progressTone: progress.tone,
    progressProcessedMs: progress.processedMs,
    progressTotalMs: progress.totalMs,
    showProgress: job.state !== 'completed' && job.state !== 'failed',
    showHistory: false,
    createdLabel: '送出時間',
    updatedLabel: '最近更新',
    durationLabel: durationText ? '時長' : null,
    durationValue: durationText,
    transcriptionCostLabel: typeof job.actualTranscriptionCostUsd === 'number' ? '轉文字' : null,
    transcriptionCostValue:
      typeof job.actualTranscriptionCostUsd === 'number'
        ? formatUsd(job.actualTranscriptionCostUsd)
        : null,
    summaryCostLabel: typeof job.actualSummaryCostUsd === 'number' ? '摘要' : null,
    summaryCostValue:
      typeof job.actualSummaryCostUsd === 'number' ? formatUsd(job.actualSummaryCostUsd) : null,
    totalCostLabel: typeof job.actualCloudCostUsd === 'number' ? '合計' : null,
    totalCostValue:
      typeof job.actualCloudCostUsd === 'number' ? formatUsd(job.actualCloudCostUsd) : null,
    createdAtText: formatJobTimestamp(job.createdAt),
    updatedAtText: formatJobTimestamp(job.updatedAt)
  };
};
