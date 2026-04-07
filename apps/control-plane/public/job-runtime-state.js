export const getMeetingBotStatusCopy = (job) => {
  if (job.inputSource !== 'meeting-link') {
    return null;
  }

  const runtimeState = job.displayState || job.state;

  if (job.processingStage === 'finalizing-recording') {
    return 'AI Bot is leaving the meeting and finalizing the recording.';
  }

  if (runtimeState === 'queued') {
    return 'AI Bot is waiting in queue.';
  }

  if (runtimeState === 'joining') {
    return 'AI Bot is joining the meeting.';
  }

  if (runtimeState === 'recording') {
    return 'AI Bot joined the meeting and is recording.';
  }

  if (runtimeState === 'transcribing') {
    return 'AI Bot left the meeting and transcript processing is running.';
  }

  if (runtimeState === 'completed') {
    return 'AI Bot finished the meeting and processing completed.';
  }

  if (runtimeState === 'failed') {
    return 'AI Bot left the meeting because the run failed.';
  }

  return null;
};
