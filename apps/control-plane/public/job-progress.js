const uploadedAudioStageProgress = {
  queued: { percent: 5, label: 'Queued' },
  'preparing-media': { percent: 25, label: 'Preparing Media' },
  transcribing: { percent: 65, label: 'Transcribing Audio' },
  'transcribing-audio': { percent: 65, label: 'Transcribing Audio' },
  'generating-summary': { percent: 88, label: 'Generating Summary' },
  completed: { percent: 100, label: 'Completed' },
  failed: { percent: 100, label: 'Failed' }
};

const meetingLinkStageProgress = {
  queued: { percent: 5, label: 'Queued' },
  joining: { percent: 20, label: 'Joining Meeting' },
  recording: { percent: 45, label: 'Recording Meeting' },
  'finalizing-recording': { percent: 58, label: 'Finalizing Recording' },
  transcribing: { percent: 72, label: 'Transcribing Audio' },
  'transcribing-audio': { percent: 72, label: 'Transcribing Audio' },
  'generating-summary': { percent: 90, label: 'Generating Summary' },
  completed: { percent: 100, label: 'Completed' },
  failed: { percent: 100, label: 'Failed' }
};

const prettifyProgressLabel = (value) =>
  value
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

export const getJobProgressModel = (job) => {
  if (typeof job.progressPercent === 'number') {
    return {
      percent: job.progressPercent,
      label: prettifyProgressLabel(job.processingStage || job.displayState || job.state || 'queued'),
      tone: job.state === 'failed' ? 'failed' : job.state === 'completed' ? 'completed' : 'active',
      processedMs: job.progressProcessedMs,
      totalMs: job.progressTotalMs
    };
  }

  const stageKey = job.processingStage || job.displayState || job.state || 'queued';
  const stageMap = job.inputSource === 'uploaded-audio' ? uploadedAudioStageProgress : meetingLinkStageProgress;
  const fallback = stageMap[stageKey] ?? {
    percent: job.state === 'completed' || job.state === 'failed' ? 100 : 15,
    label: prettifyProgressLabel(stageKey)
  };

  return {
    percent: fallback.percent,
    label: fallback.label,
    tone: job.state === 'failed' ? 'failed' : job.state === 'completed' ? 'completed' : 'active'
  };
};
