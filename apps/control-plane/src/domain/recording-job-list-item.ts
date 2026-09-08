import type { RecordingJob, SummaryArtifact, TranscriptArtifact } from './recording-job.js';
import { isMeetingShareEligible, sanitizeAnonymousSpeakerLabels } from './meeting-share.js';

export const toRecordingJobResultMetadata = (
  job: Pick<RecordingJob, 'id' | 'state' | 'uploadedFileName' | 'transcriptArtifact' | 'summaryArtifact'>
) => ({
  id: job.id,
  title: job.summaryArtifact?.structured?.title?.trim()
    ? sanitizeAnonymousSpeakerLabels(job.summaryArtifact.structured.title.trim())
    : job.uploadedFileName || job.id,
  state: job.state,
  resultAvailable: isMeetingShareEligible(job)
});

export type RecordingJobListItem = Omit<
  RecordingJob,
  | 'jobHistory'
  | 'recordingArtifact'
  | 'transcriptArtifact'
  | 'summaryArtifact'
  | 'recordingLeaseToken'
  | 'transcriptionLeaseToken'
  | 'summaryLeaseToken'
> & {
  hasTranscript: boolean;
  hasSummary: boolean;
  transcriptPreview?: string;
  summaryPreview?: string;
};

export const buildTranscriptPreview = (
  transcriptArtifact?: Pick<TranscriptArtifact, 'segments'>
): string | undefined => {
  const preview = transcriptArtifact?.segments
    ?.slice(0, 6)
    .map((segment) => segment.text.trim())
    .filter((text) => text.length > 0)
    .join('\n');

  return preview && preview.length > 0 ? preview : undefined;
};

export const buildSummaryPreview = (
  summaryText?: SummaryArtifact['text']
): string | undefined => {
  const trimmed = (summaryText ?? '').trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.length > 320 ? `${trimmed.slice(0, 320)}...` : trimmed;
};

export const toRecordingJobListItem = (job: RecordingJob): RecordingJobListItem => {
  const {
    jobHistory: _jobHistory,
    recordingArtifact: _recordingArtifact,
    transcriptArtifact,
    summaryArtifact,
    recordingLeaseToken: _recordingLeaseToken,
    transcriptionLeaseToken: _transcriptionLeaseToken,
    summaryLeaseToken: _summaryLeaseToken,
    ...baseJob
  } = job;

  return {
    ...baseJob,
    hasTranscript: Boolean(transcriptArtifact),
    hasSummary: Boolean(summaryArtifact),
    transcriptPreview: buildTranscriptPreview(transcriptArtifact),
    summaryPreview: buildSummaryPreview(summaryArtifact?.text)
  };
};

export const recordingJobMatchesSearchQuery = (
  job: RecordingJob,
  query?: string
): boolean => {
  const normalizedQuery = (query ?? '').trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return true;
  }

  return [
    job.meetingUrl,
    job.requestedJoinName,
    job.uploadedFileName,
    job.failureMessage,
    job.summaryArtifact?.text,
    job.transcriptArtifact?.segments.map((segment) => segment.text).join(' ')
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .toLowerCase()
    .includes(normalizedQuery);
};
