const activeStates = new Set(['queued', 'joining', 'recording', 'transcribing']);

export const filterJobsByQuickFilter = (jobs, filterId = 'all', nowValue = new Date().toISOString()) => {
  if (filterId === 'all' || filterId === 'mine') {
    return jobs;
  }

  if (filterId === 'active') {
    return jobs.filter((job) => activeStates.has(job.state));
  }

  if (filterId === 'completed') {
    return jobs.filter((job) => job.state === 'completed');
  }

  if (filterId === 'failed') {
    return jobs.filter((job) => job.state === 'failed');
  }

  if (filterId === 'recent') {
    const now = new Date(nowValue).getTime();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    return jobs.filter((job) => new Date(job.createdAt).getTime() >= sevenDaysAgo);
  }

  return jobs;
};

export const getPreferredQuickExportFormat = (job) => job.preferredExportFormat || 'markdown';

export const getJobActionSet = (job, runtimeState) => {
  const actions = [];

  if (job.inputSource === 'meeting-link' && (runtimeState === 'joining' || runtimeState === 'recording')) {
    actions.push('stop-current');
  }

  if (
    (job.state === 'queued' || job.state === 'transcribing') &&
    !(job.inputSource === 'meeting-link' && (runtimeState === 'joining' || runtimeState === 'recording'))
  ) {
    actions.push('interrupt-job');
  }

  if (job.state === 'completed' || job.state === 'failed') {
    actions.push('delete-history');
  }

  if ((job.hasTranscript || job.hasSummary) && !job.transcriptArtifact && !job.summaryArtifact) {
    actions.push('view-details');
  }

  if (job.transcriptArtifact || job.summaryArtifact || job.hasTranscript || job.hasSummary) {
    actions.push('export-markdown');
  }

  return actions;
};

export const buildJobSharePayload = (job, origin) => {
  const url = new URL(origin);
  url.search = '';
  url.searchParams.set('jobId', job.id);

  const structured = job.summaryArtifact?.structured;
  const keyPoints =
    structured?.keyPoints?.length
      ? structured.keyPoints
      : structured?.summary
        ? [structured.summary]
        : [];

  return {
    summaryText: job.summaryArtifact?.text || '',
    keyPointsText: keyPoints.map((item) => `- ${item}`).join('\n'),
    shareUrl: url.toString()
  };
};
