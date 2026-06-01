import type { RecordingJob, SummaryArtifact, TranscriptArtifact } from './recording-job.js';

export type RecordingJobListItem = Omit<RecordingJob, 'jobHistory'> & {
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
  // Keep the full transcript/summary artifacts inline so the dashboard can show
  // the complete result once a job is done (no preview / no extra fetch step).
  const { jobHistory: _jobHistory, ...baseJob } = job;

  return {
    ...baseJob,
    hasTranscript: Boolean(job.transcriptArtifact),
    hasSummary: Boolean(job.summaryArtifact),
    transcriptPreview: buildTranscriptPreview(job.transcriptArtifact),
    summaryPreview: buildSummaryPreview(job.summaryArtifact?.text)
  };
};
