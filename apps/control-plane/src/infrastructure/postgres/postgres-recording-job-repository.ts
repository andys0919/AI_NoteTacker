import type {
  RecordingArtifact,
  RecordingJobHistoryEntry,
  RecordingInputSource,
  RecordingJob,
  SummaryArtifact,
  TranscriptArtifact
} from '../../domain/recording-job.js';
import type { SummaryProvider } from '../../domain/summary-provider.js';
import type {
  PreferredExportFormat,
  SubmissionTemplateId,
  SummaryProfile
} from '../../domain/operator-workflow-template.js';
import {
  assignRecordingJobToWorker,
  assignTranscriptionJobToWorker
} from '../../domain/recording-job.js';
import type { RecordingJobRepository } from '../../domain/recording-job-repository.js';
import type { TranscriptionProvider } from '../../domain/transcription-provider.js';

type Queryable = {
  query: <TRow extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
};

type RecordingJobRow = {
  id: string;
  meeting_url: string;
  platform: RecordingJob['platform'];
  input_source: RecordingInputSource;
  submitter_id: string;
  requested_join_name: string;
  submission_template_id: SubmissionTemplateId | null;
  summary_profile: SummaryProfile | null;
  preferred_export_format: PreferredExportFormat | null;
  uploaded_file_name: string | null;
  state: RecordingJob['state'];
  processing_stage: string | null;
  processing_message: string | null;
  progress_percent: number | null;
  progress_processed_ms: number | null;
  progress_total_ms: number | null;
  assigned_worker_id: string | null;
  assigned_transcription_worker_id: string | null;
  transcription_provider: TranscriptionProvider | null;
  transcription_model: string | null;
  summary_provider: SummaryProvider | null;
  summary_model: string | null;
  pricing_version: string | null;
  estimated_cloud_reservation_usd: number | string | null;
  reserved_cloud_quota_usd: number | string | null;
  quota_day_key: string | null;
  transcription_attempt_count: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  failure_code: string | null;
  failure_message: string | null;
  recording_artifact: RecordingArtifact | null;
  transcript_artifact: TranscriptArtifact | null;
  summary_artifact: SummaryArtifact | null;
  job_history: RecordingJobHistoryEntry[] | null;
  terminal_notification_sent_at: Date | string | null;
  terminal_notification_target: string | null;
  terminal_notification_state: RecordingJob['state'] | null;
};

const recordingJobSchemaSql = `
  CREATE TABLE IF NOT EXISTS recording_jobs (
    id TEXT PRIMARY KEY,
    meeting_url TEXT NOT NULL,
    platform TEXT NOT NULL,
    input_source TEXT NOT NULL DEFAULT 'meeting-link',
    submitter_id TEXT NOT NULL DEFAULT 'anonymous',
    requested_join_name TEXT NOT NULL DEFAULT 'Solomon - NoteTaker',
    submission_template_id TEXT,
    summary_profile TEXT,
    preferred_export_format TEXT,
    uploaded_file_name TEXT,
    state TEXT NOT NULL,
    processing_stage TEXT,
    processing_message TEXT,
    progress_percent INTEGER,
    progress_processed_ms INTEGER,
    progress_total_ms INTEGER,
    assigned_worker_id TEXT,
    assigned_transcription_worker_id TEXT,
    transcription_provider TEXT,
    transcription_model TEXT,
    summary_provider TEXT,
    summary_model TEXT,
    pricing_version TEXT,
    estimated_cloud_reservation_usd NUMERIC(12, 6),
    reserved_cloud_quota_usd NUMERIC(12, 6),
    quota_day_key TEXT,
    transcription_attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    failure_code TEXT,
    failure_message TEXT,
    recording_artifact JSONB,
    transcript_artifact JSONB,
    summary_artifact JSONB,
    job_history JSONB,
    terminal_notification_sent_at TIMESTAMPTZ,
    terminal_notification_target TEXT,
    terminal_notification_state TEXT
  );

  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_artifact JSONB;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS input_source TEXT NOT NULL DEFAULT 'meeting-link';
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS submitter_id TEXT NOT NULL DEFAULT 'anonymous';
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS requested_join_name TEXT NOT NULL DEFAULT 'Solomon - NoteTaker';
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS submission_template_id TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_profile TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS preferred_export_format TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS uploaded_file_name TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS processing_stage TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS processing_message TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS progress_percent INTEGER;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS progress_processed_ms INTEGER;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS progress_total_ms INTEGER;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS job_history JSONB;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS transcription_provider TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS transcription_model TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_provider TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_model TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS pricing_version TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS estimated_cloud_reservation_usd NUMERIC(12, 6);
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS reserved_cloud_quota_usd NUMERIC(12, 6);
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS quota_day_key TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS terminal_notification_sent_at TIMESTAMPTZ;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS terminal_notification_target TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS terminal_notification_state TEXT;
`;

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const mapRowToRecordingJob = (row: RecordingJobRow): RecordingJob => ({
  id: row.id,
  meetingUrl: row.meeting_url,
  platform: row.platform,
  inputSource: row.input_source,
  submitterId: row.submitter_id,
  requestedJoinName: row.requested_join_name,
  submissionTemplateId: row.submission_template_id ?? undefined,
  summaryProfile: row.summary_profile ?? undefined,
  preferredExportFormat: row.preferred_export_format ?? undefined,
  uploadedFileName: row.uploaded_file_name ?? undefined,
  state: row.state,
  processingStage: row.processing_stage ?? undefined,
  processingMessage: row.processing_message ?? undefined,
  progressPercent: row.progress_percent ?? undefined,
  progressProcessedMs: row.progress_processed_ms ?? undefined,
  progressTotalMs: row.progress_total_ms ?? undefined,
  assignedWorkerId: row.assigned_worker_id ?? undefined,
  assignedTranscriptionWorkerId: row.assigned_transcription_worker_id ?? undefined,
  transcriptionProvider: row.transcription_provider ?? undefined,
  transcriptionModel: row.transcription_model ?? undefined,
  summaryProvider: row.summary_provider ?? undefined,
  summaryModel: row.summary_model ?? undefined,
  pricingVersion: row.pricing_version ?? undefined,
  estimatedCloudReservationUsd:
    row.estimated_cloud_reservation_usd !== null && row.estimated_cloud_reservation_usd !== undefined
      ? Number(row.estimated_cloud_reservation_usd)
      : undefined,
  reservedCloudQuotaUsd:
    row.reserved_cloud_quota_usd !== null && row.reserved_cloud_quota_usd !== undefined
      ? Number(row.reserved_cloud_quota_usd)
      : undefined,
  quotaDayKey: row.quota_day_key ?? undefined,
  transcriptionAttemptCount: row.transcription_attempt_count ?? 0,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
  failureCode: row.failure_code ?? undefined,
  failureMessage: row.failure_message ?? undefined,
  recordingArtifact: row.recording_artifact ?? undefined,
  transcriptArtifact: row.transcript_artifact ?? undefined,
  summaryArtifact: row.summary_artifact ?? undefined,
  jobHistory: row.job_history ?? undefined,
  terminalNotificationSentAt: row.terminal_notification_sent_at
    ? toIsoString(row.terminal_notification_sent_at)
    : undefined,
  terminalNotificationTarget: row.terminal_notification_target ?? undefined,
  terminalNotificationState: row.terminal_notification_state ?? undefined
});

export const ensureRecordingJobSchema = async (database: Queryable): Promise<void> => {
  await database.query(recordingJobSchemaSql);
};

export class PostgresRecordingJobRepository implements RecordingJobRepository {
  constructor(private readonly database: Queryable) {}

  async save(job: RecordingJob): Promise<RecordingJob> {
    const result = await this.database.query<RecordingJobRow>(
      `
        INSERT INTO recording_jobs (
          id,
          meeting_url,
          platform,
          input_source,
          submitter_id,
          requested_join_name,
          submission_template_id,
          summary_profile,
          preferred_export_format,
          uploaded_file_name,
          state,
          processing_stage,
          processing_message,
          progress_percent,
          progress_processed_ms,
          progress_total_ms,
          assigned_worker_id,
          assigned_transcription_worker_id,
          transcription_provider,
          transcription_model,
          summary_provider,
          summary_model,
          pricing_version,
          estimated_cloud_reservation_usd,
          reserved_cloud_quota_usd,
          quota_day_key,
          transcription_attempt_count,
          created_at,
          updated_at,
          failure_code,
          failure_message,
          recording_artifact,
          transcript_artifact,
          summary_artifact,
          job_history,
          terminal_notification_sent_at,
          terminal_notification_target,
          terminal_notification_state
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28::timestamptz, $29::timestamptz, $30, $31, $32::jsonb, $33::jsonb, $34::jsonb, $35::jsonb, $36::timestamptz, $37, $38)
        ON CONFLICT (id) DO UPDATE SET
          meeting_url = EXCLUDED.meeting_url,
          platform = EXCLUDED.platform,
          input_source = EXCLUDED.input_source,
          submitter_id = EXCLUDED.submitter_id,
          requested_join_name = EXCLUDED.requested_join_name,
          submission_template_id = EXCLUDED.submission_template_id,
          summary_profile = EXCLUDED.summary_profile,
          preferred_export_format = EXCLUDED.preferred_export_format,
          uploaded_file_name = EXCLUDED.uploaded_file_name,
          state = EXCLUDED.state,
          processing_stage = EXCLUDED.processing_stage,
          processing_message = EXCLUDED.processing_message,
          progress_percent = EXCLUDED.progress_percent,
          progress_processed_ms = EXCLUDED.progress_processed_ms,
          progress_total_ms = EXCLUDED.progress_total_ms,
          assigned_worker_id = EXCLUDED.assigned_worker_id,
          assigned_transcription_worker_id = EXCLUDED.assigned_transcription_worker_id,
          transcription_provider = EXCLUDED.transcription_provider,
          transcription_model = EXCLUDED.transcription_model,
          summary_provider = EXCLUDED.summary_provider,
          summary_model = EXCLUDED.summary_model,
          pricing_version = EXCLUDED.pricing_version,
          estimated_cloud_reservation_usd = EXCLUDED.estimated_cloud_reservation_usd,
          reserved_cloud_quota_usd = EXCLUDED.reserved_cloud_quota_usd,
          quota_day_key = EXCLUDED.quota_day_key,
          transcription_attempt_count = EXCLUDED.transcription_attempt_count,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          failure_code = EXCLUDED.failure_code,
          failure_message = EXCLUDED.failure_message,
          recording_artifact = EXCLUDED.recording_artifact,
          transcript_artifact = EXCLUDED.transcript_artifact,
          summary_artifact = EXCLUDED.summary_artifact,
          job_history = EXCLUDED.job_history,
          terminal_notification_sent_at = EXCLUDED.terminal_notification_sent_at,
          terminal_notification_target = EXCLUDED.terminal_notification_target,
          terminal_notification_state = EXCLUDED.terminal_notification_state
        RETURNING *
      `,
      [
        job.id,
        job.meetingUrl,
        job.platform,
        job.inputSource,
        job.submitterId,
        job.requestedJoinName,
        job.submissionTemplateId ?? null,
        job.summaryProfile ?? null,
        job.preferredExportFormat ?? null,
        job.uploadedFileName ?? null,
        job.state,
        job.processingStage ?? null,
        job.processingMessage ?? null,
        job.progressPercent ?? null,
        job.progressProcessedMs ?? null,
        job.progressTotalMs ?? null,
        job.assignedWorkerId ?? null,
        job.assignedTranscriptionWorkerId ?? null,
        job.transcriptionProvider ?? null,
        job.transcriptionModel ?? null,
        job.summaryProvider ?? null,
        job.summaryModel ?? null,
        job.pricingVersion ?? null,
        job.estimatedCloudReservationUsd ?? null,
        job.reservedCloudQuotaUsd ?? null,
        job.quotaDayKey ?? null,
        job.transcriptionAttemptCount ?? 0,
        job.createdAt,
        job.updatedAt,
        job.failureCode ?? null,
        job.failureMessage ?? null,
        job.recordingArtifact ? JSON.stringify(job.recordingArtifact) : null,
        job.transcriptArtifact ? JSON.stringify(job.transcriptArtifact) : null,
        job.summaryArtifact ? JSON.stringify(job.summaryArtifact) : null,
        job.jobHistory ? JSON.stringify(job.jobHistory) : null,
        job.terminalNotificationSentAt ?? null,
        job.terminalNotificationTarget ?? null,
        job.terminalNotificationState ?? null
      ]
    );

    return mapRowToRecordingJob(result.rows[0]);
  }

  async getById(id: string): Promise<RecordingJob | undefined> {
    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    return mapRowToRecordingJob(result.rows[0]);
  }

  async listBySubmitter(submitterId: string): Promise<RecordingJob[]> {
    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE submitter_id = $1
        ORDER BY created_at DESC
      `,
      [submitterId]
    );

    return result.rows.map(mapRowToRecordingJob);
  }

  async listByQuotaDayKey(quotaDayKey: string): Promise<RecordingJob[]> {
    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE quota_day_key = $1
        ORDER BY created_at DESC
      `,
      [quotaDayKey]
    );

    return result.rows.map(mapRowToRecordingJob);
  }

  async deleteTerminalJobForSubmitter(id: string, submitterId: string): Promise<boolean> {
    const result = await this.database.query<{ id: string }>(
      `
        DELETE FROM recording_jobs
        WHERE id = $1
          AND submitter_id = $2
          AND state IN ('failed', 'completed')
        RETURNING id
      `,
      [id, submitterId]
    );

    return result.rows.length > 0;
  }

  async clearTerminalHistoryForSubmitter(submitterId: string): Promise<number> {
    const result = await this.database.query<{ id: string }>(
      `
        DELETE FROM recording_jobs
        WHERE submitter_id = $1
          AND state IN ('failed', 'completed')
        RETURNING id
      `,
      [submitterId]
    );

    return result.rows.length;
  }

  async listActiveProcessingJobs(): Promise<RecordingJob[]> {
    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE state IN ('joining', 'recording', 'transcribing')
      `
    );

    return result.rows.map(mapRowToRecordingJob);
  }

  async listGeneratingSummaryJobs(): Promise<RecordingJob[]> {
    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE processing_stage = 'generating-summary'
          AND summary_artifact IS NULL
      `
    );

    return result.rows.map(mapRowToRecordingJob);
  }

  async claimNextQueued(workerId: string): Promise<RecordingJob | undefined> {
    const activeMeetingResult = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE input_source = 'meeting-link'
          AND state IN ('joining', 'recording')
        ORDER BY updated_at ASC
        LIMIT 1
      `
    );

    if (activeMeetingResult.rows.length > 0) {
      return undefined;
    }

    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE state = 'queued'
          AND input_source = 'meeting-link'
        ORDER BY created_at ASC
      `
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    const activeJobs = await this.listActiveProcessingJobs();
    const candidate = result.rows
      .map(mapRowToRecordingJob)
      .find(
        (job) =>
          !activeJobs.some(
            (activeJob) => activeJob.id !== job.id && activeJob.submitterId === job.submitterId
          )
      );

    if (!candidate) {
      return undefined;
    }

    const claimedJob = assignRecordingJobToWorker(candidate, workerId);
    return await this.save(claimedJob);
  }

  async claimNextTranscriptionReady(
    workerId: string,
    allowedProviders?: TranscriptionProvider | TranscriptionProvider[]
  ): Promise<RecordingJob | undefined> {
    const normalizedProviders = !allowedProviders
      ? undefined
      : Array.isArray(allowedProviders)
        ? allowedProviders
        : [allowedProviders];
    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE (
          state = 'transcribing'
          OR (state = 'queued' AND input_source = 'uploaded-audio')
        )
          AND recording_artifact IS NOT NULL
          AND transcript_artifact IS NULL
          AND assigned_transcription_worker_id IS NULL
        ORDER BY updated_at ASC
      `
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    const activeJobs = await this.listActiveProcessingJobs();
    const candidate = result.rows
      .map(mapRowToRecordingJob)
      .find(
        (job) =>
          (!normalizedProviders?.length ||
            normalizedProviders.includes(job.transcriptionProvider ?? 'self-hosted-whisper')) &&
          (job.state === 'transcribing' ||
            !activeJobs.some(
              (activeJob) => activeJob.id !== job.id && activeJob.submitterId === job.submitterId
            ))
      );

    if (!candidate) {
      return undefined;
    }

    const claimedJob = assignTranscriptionJobToWorker(candidate, workerId);
    return await this.save(
      !claimedJob.transcriptionProvider && normalizedProviders?.length == 1
        ? {
            ...claimedJob,
            transcriptionProvider: normalizedProviders[0]
          }
        : claimedJob
    );
  }
}
