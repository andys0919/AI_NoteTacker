const localizedStageLabels = {
  queued: '排隊中',
  'waiting-for-recording-capacity': '等待錄製容量',
  'waiting-for-host-admission': '等待主持人允許',
  'aborting-lobby-join': '取消入會中',
  'preparing-media': '媒體整理中',
  joining: '準備加入會議',
  'joining-meeting': '準備加入會議',
  recording: '錄製會議中',
  'finalizing-recording': '整理錄音中',
  transcribing: '語音轉寫中',
  'transcribing-audio': '語音轉寫中',
  'summary-pending': '等待摘要中',
  'generating-summary': '摘要整理中',
  completed: '已完成',
  failed: '處理失敗'
};

export const getProgressLabel = (value) =>
  localizedStageLabels[value] ??
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const uploadedAudioStageProgress = {
  queued: { percent: 5, label: getProgressLabel('queued') },
  'preparing-media': { percent: 25, label: getProgressLabel('preparing-media') },
  transcribing: { percent: 65, label: getProgressLabel('transcribing') },
  'transcribing-audio': { percent: 65, label: getProgressLabel('transcribing-audio') },
  'summary-pending': { percent: 90, label: getProgressLabel('summary-pending') },
  'generating-summary': { percent: 88, label: getProgressLabel('generating-summary') },
  completed: { percent: 100, label: getProgressLabel('completed') },
  failed: { percent: 100, label: getProgressLabel('failed') }
};

const meetingLinkStageProgress = {
  queued: { percent: 5, label: getProgressLabel('queued') },
  joining: { percent: 20, label: getProgressLabel('joining') },
  'waiting-for-recording-capacity': {
    percent: 8,
    label: getProgressLabel('waiting-for-recording-capacity')
  },
  'waiting-for-host-admission': {
    percent: 28,
    label: getProgressLabel('waiting-for-host-admission')
  },
  'joining-meeting': { percent: 20, label: getProgressLabel('joining-meeting') },
  recording: { percent: 45, label: getProgressLabel('recording') },
  'finalizing-recording': { percent: 58, label: getProgressLabel('finalizing-recording') },
  transcribing: { percent: 72, label: getProgressLabel('transcribing') },
  'transcribing-audio': { percent: 72, label: getProgressLabel('transcribing-audio') },
  'summary-pending': { percent: 90, label: getProgressLabel('summary-pending') },
  'generating-summary': { percent: 90, label: getProgressLabel('generating-summary') },
  completed: { percent: 100, label: getProgressLabel('completed') },
  failed: { percent: 100, label: getProgressLabel('failed') }
};

export const getJobProgressModel = (job) => {
  if (typeof job.progressPercent === 'number') {
    return {
      percent: job.progressPercent,
      label: getProgressLabel(job.processingStage || job.displayState || job.state || 'queued'),
      tone: job.state === 'failed' ? 'failed' : job.state === 'completed' ? 'completed' : 'active',
      processedMs: job.progressProcessedMs,
      totalMs: job.progressTotalMs
    };
  }

  if (
    job.inputSource === 'meeting-link' &&
    job.processingStage === 'finalizing-recording' &&
    !job.recordingArtifact
  ) {
    return {
      percent: 18,
      label: getProgressLabel('aborting-lobby-join'),
      tone: job.state === 'failed' ? 'failed' : 'active'
    };
  }

  const stageKey = job.processingStage || job.displayState || job.state || 'queued';
  const stageMap = job.inputSource === 'uploaded-audio' ? uploadedAudioStageProgress : meetingLinkStageProgress;
  const fallback = stageMap[stageKey] ?? {
    percent: job.state === 'completed' || job.state === 'failed' ? 100 : 15,
    label: getProgressLabel(stageKey)
  };

  return {
    percent: fallback.percent,
    label: fallback.label,
    tone: job.state === 'failed' ? 'failed' : job.state === 'completed' ? 'completed' : 'active'
  };
};
