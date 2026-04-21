import type { RecordingJob, SummaryArtifact, TranscriptArtifact } from './recording-job.js';

export type RecordingJobListItem = Omit<
  RecordingJob,
  'transcriptArtifact' | 'summaryArtifact' | 'jobHistory'
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
  const { transcriptArtifact, summaryArtifact, jobHistory: _jobHistory, ...baseJob } = job;

  return {
    ...baseJob,
    hasTranscript: Boolean(transcriptArtifact),
    hasSummary: Boolean(summaryArtifact),
    transcriptPreview: buildTranscriptPreview(transcriptArtifact),
    summaryPreview: buildSummaryPreview(summaryArtifact?.text)
  };
};
