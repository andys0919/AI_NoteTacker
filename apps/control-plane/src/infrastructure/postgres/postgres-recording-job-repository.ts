import type {
  RecordingArtifact,
  RecordingJobHistoryEntry,
  RecordingInputSource,
  RecordingJob,
  SummaryArtifact,
  TranscriptArtifact
} from '../../domain/recording-job.js';
import {
  buildSummaryPreview,
  buildTranscriptPreview,
  type RecordingJobListItem
} from '../../domain/recording-job-list-item.js';
import type { SummaryProvider } from '../../domain/summary-provider.js';
import type {
  PreferredExportFormat,
  SubmissionTemplateId,
  SummaryProfile
} from '../../domain/operator-workflow-template.js';
import {
  assignRecordingJobToWorker,
  assignSummaryJobToWorker,
  assignTranscriptionJobToWorker
} from '../../domain/recording-job.js';
import type {
  RecordingJobPage,
  RecordingJobPageCursor,
  RecordingJobRepository,
  RecordingJobStats
} from '../../domain/recording-job-repository.js';
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
  assigned_summary_worker_id: string | null;
  recording_lease_token: string | null;
  recording_lease_acquired_at: Date | string | null;
  recording_lease_heartbeat_at: Date | string | null;
  recording_lease_expires_at: Date | string | null;
  transcription_lease_token: string | null;
  transcription_lease_acquired_at: Date | string | null;
  transcription_lease_heartbeat_at: Date | string | null;
  transcription_lease_expires_at: Date | string | null;
  summary_lease_token: string | null;
  summary_lease_acquired_at: Date | string | null;
  summary_lease_heartbeat_at: Date | string | null;
  summary_lease_expires_at: Date | string | null;
  transcription_provider: TranscriptionProvider | null;
  transcription_model: string | null;
  summary_provider: SummaryProvider | null;
  summary_model: string | null;
  summary_requested: boolean | null;
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
  transcript_preview: string | null;
  summary_preview: string | null;
  has_transcript_artifact: boolean | null;
  has_summary_artifact: boolean | null;
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
    assigned_summary_worker_id TEXT,
    recording_lease_token TEXT,
    recording_lease_acquired_at TIMESTAMPTZ,
    recording_lease_heartbeat_at TIMESTAMPTZ,
    recording_lease_expires_at TIMESTAMPTZ,
    transcription_lease_token TEXT,
    transcription_lease_acquired_at TIMESTAMPTZ,
    transcription_lease_heartbeat_at TIMESTAMPTZ,
    transcription_lease_expires_at TIMESTAMPTZ,
    summary_lease_token TEXT,
    summary_lease_acquired_at TIMESTAMPTZ,
    summary_lease_heartbeat_at TIMESTAMPTZ,
    summary_lease_expires_at TIMESTAMPTZ,
    transcription_provider TEXT,
    transcription_model TEXT,
    summary_provider TEXT,
    summary_model TEXT,
    summary_requested BOOLEAN NOT NULL DEFAULT TRUE,
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
    transcript_preview TEXT,
    summary_preview TEXT,
    has_transcript_artifact BOOLEAN NOT NULL DEFAULT FALSE,
    has_summary_artifact BOOLEAN NOT NULL DEFAULT FALSE,
    job_history JSONB,
    terminal_notification_sent_at TIMESTAMPTZ,
    terminal_notification_target TEXT,
    terminal_notification_state TEXT
  );

  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_artifact JSONB;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS transcript_preview TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_preview TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS has_transcript_artifact BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS has_summary_artifact BOOLEAN NOT NULL DEFAULT FALSE;
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
  ADD COLUMN IF NOT EXISTS summary_requested BOOLEAN NOT NULL DEFAULT TRUE;
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
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS assigned_summary_worker_id TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS recording_lease_token TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS recording_lease_acquired_at TIMESTAMPTZ;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS recording_lease_heartbeat_at TIMESTAMPTZ;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS recording_lease_expires_at TIMESTAMPTZ;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS transcription_lease_token TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS transcription_lease_acquired_at TIMESTAMPTZ;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS transcription_lease_heartbeat_at TIMESTAMPTZ;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS transcription_lease_expires_at TIMESTAMPTZ;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_lease_token TEXT;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_lease_acquired_at TIMESTAMPTZ;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_lease_heartbeat_at TIMESTAMPTZ;
  ALTER TABLE recording_jobs
  ADD COLUMN IF NOT EXISTS summary_lease_expires_at TIMESTAMPTZ;

  CREATE INDEX IF NOT EXISTS recording_jobs_submitter_archive_idx
  ON recording_jobs (submitter_id, created_at DESC, id DESC);

  CREATE INDEX IF NOT EXISTS recording_jobs_submitter_state_idx
  ON recording_jobs (submitter_id, state);

  CREATE INDEX IF NOT EXISTS recording_jobs_quota_day_created_at_idx
  ON recording_jobs (quota_day_key, created_at DESC);

  CREATE INDEX IF NOT EXISTS recording_jobs_active_processing_idx
  ON recording_jobs (state, updated_at DESC)
  WHERE state IN ('joining', 'recording', 'transcribing');

  CREATE INDEX IF NOT EXISTS recording_jobs_meeting_queue_idx
  ON recording_jobs (created_at ASC)
  WHERE input_source = 'meeting-link'
    AND state = 'queued';

  CREATE INDEX IF NOT EXISTS recording_jobs_meeting_active_idx
  ON recording_jobs (state, updated_at DESC)
  WHERE input_source = 'meeting-link'
    AND state IN ('joining', 'recording');

  CREATE INDEX IF NOT EXISTS recording_jobs_submitter_active_idx
  ON recording_jobs (submitter_id, updated_at DESC)
  WHERE state IN ('joining', 'recording', 'transcribing');

  CREATE INDEX IF NOT EXISTS recording_jobs_transcription_claim_idx
  ON recording_jobs (updated_at ASC)
  WHERE recording_artifact IS NOT NULL
    AND transcript_artifact IS NULL
    AND assigned_transcription_worker_id IS NULL
    AND (
      state = 'transcribing'
      OR (state = 'queued' AND input_source = 'uploaded-audio')
    );

  CREATE INDEX IF NOT EXISTS recording_jobs_summary_claim_idx
  ON recording_jobs (updated_at ASC)
  WHERE state = 'transcribing'
    AND summary_requested = TRUE
    AND transcript_artifact IS NOT NULL
    AND summary_artifact IS NULL
    AND assigned_summary_worker_id IS NULL
    AND processing_stage = 'summary-pending';

  CREATE INDEX IF NOT EXISTS recording_jobs_summary_active_idx
  ON recording_jobs (updated_at DESC)
  WHERE summary_requested = TRUE
    AND assigned_summary_worker_id IS NOT NULL
    AND summary_artifact IS NULL;
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
  assignedSummaryWorkerId: row.assigned_summary_worker_id ?? undefined,
  recordingLeaseToken: row.recording_lease_token ?? undefined,
  recordingLeaseAcquiredAt: row.recording_lease_acquired_at
    ? toIsoString(row.recording_lease_acquired_at)
    : undefined,
  recordingLeaseHeartbeatAt: row.recording_lease_heartbeat_at
    ? toIsoString(row.recording_lease_heartbeat_at)
    : undefined,
  recordingLeaseExpiresAt: row.recording_lease_expires_at
    ? toIsoString(row.recording_lease_expires_at)
    : undefined,
  transcriptionLeaseToken: row.transcription_lease_token ?? undefined,
  transcriptionLeaseAcquiredAt: row.transcription_lease_acquired_at
    ? toIsoString(row.transcription_lease_acquired_at)
    : undefined,
  transcriptionLeaseHeartbeatAt: row.transcription_lease_heartbeat_at
    ? toIsoString(row.transcription_lease_heartbeat_at)
    : undefined,
  transcriptionLeaseExpiresAt: row.transcription_lease_expires_at
    ? toIsoString(row.transcription_lease_expires_at)
    : undefined,
  summaryLeaseToken: row.summary_lease_token ?? undefined,
  summaryLeaseAcquiredAt: row.summary_lease_acquired_at
    ? toIsoString(row.summary_lease_acquired_at)
    : undefined,
  summaryLeaseHeartbeatAt: row.summary_lease_heartbeat_at
    ? toIsoString(row.summary_lease_heartbeat_at)
    : undefined,
  summaryLeaseExpiresAt: row.summary_lease_expires_at
    ? toIsoString(row.summary_lease_expires_at)
    : undefined,
  transcriptionProvider: row.transcription_provider ?? undefined,
  transcriptionModel: row.transcription_model ?? undefined,
  summaryProvider: row.summary_provider ?? undefined,
  summaryModel: row.summary_model ?? undefined,
  summaryRequested: row.summary_requested ?? true,
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

const mapRowToRecordingJobListItem = (row: RecordingJobRow): RecordingJobListItem => ({
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
  assignedSummaryWorkerId: row.assigned_summary_worker_id ?? undefined,
  recordingLeaseToken: row.recording_lease_token ?? undefined,
  recordingLeaseAcquiredAt: row.recording_lease_acquired_at
    ? toIsoString(row.recording_lease_acquired_at)
    : undefined,
  recordingLeaseHeartbeatAt: row.recording_lease_heartbeat_at
    ? toIsoString(row.recording_lease_heartbeat_at)
    : undefined,
  recordingLeaseExpiresAt: row.recording_lease_expires_at
    ? toIsoString(row.recording_lease_expires_at)
    : undefined,
  transcriptionLeaseToken: row.transcription_lease_token ?? undefined,
  transcriptionLeaseAcquiredAt: row.transcription_lease_acquired_at
    ? toIsoString(row.transcription_lease_acquired_at)
    : undefined,
  transcriptionLeaseHeartbeatAt: row.transcription_lease_heartbeat_at
    ? toIsoString(row.transcription_lease_heartbeat_at)
    : undefined,
  transcriptionLeaseExpiresAt: row.transcription_lease_expires_at
    ? toIsoString(row.transcription_lease_expires_at)
    : undefined,
  summaryLeaseToken: row.summary_lease_token ?? undefined,
  summaryLeaseAcquiredAt: row.summary_lease_acquired_at
    ? toIsoString(row.summary_lease_acquired_at)
    : undefined,
  summaryLeaseHeartbeatAt: row.summary_lease_heartbeat_at
    ? toIsoString(row.summary_lease_heartbeat_at)
    : undefined,
  summaryLeaseExpiresAt: row.summary_lease_expires_at
    ? toIsoString(row.summary_lease_expires_at)
    : undefined,
  transcriptionProvider: row.transcription_provider ?? undefined,
  transcriptionModel: row.transcription_model ?? undefined,
  summaryProvider: row.summary_provider ?? undefined,
  summaryModel: row.summary_model ?? undefined,
  summaryRequested: row.summary_requested ?? true,
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
  terminalNotificationSentAt: row.terminal_notification_sent_at
    ? toIsoString(row.terminal_notification_sent_at)
    : undefined,
  terminalNotificationTarget: row.terminal_notification_target ?? undefined,
  terminalNotificationState: row.terminal_notification_state ?? undefined,
  hasTranscript: row.has_transcript_artifact ?? false,
  hasSummary: row.has_summary_artifact ?? false,
  transcriptPreview: row.transcript_preview ?? undefined,
  summaryPreview: row.summary_preview ?? undefined
});

export const ensureRecordingJobSchema = async (database: Queryable): Promise<void> => {
  await database.query(recordingJobSchemaSql);
  await database.query(
    `
      UPDATE recording_jobs
      SET has_transcript_artifact = TRUE
      WHERE transcript_artifact IS NOT NULL
    `
  );
  await database.query(
    `
      UPDATE recording_jobs
      SET has_summary_artifact = TRUE
      WHERE summary_artifact IS NOT NULL
    `
  );
};

export class PostgresRecordingJobRepository implements RecordingJobRepository {
  constructor(private readonly database: Queryable) {}

  async save(job: RecordingJob): Promise<RecordingJob> {
    const transcriptPreview = buildTranscriptPreview(job.transcriptArtifact);
    const summaryPreview = buildSummaryPreview(job.summaryArtifact?.text);
    const hasTranscriptArtifact = Boolean(job.transcriptArtifact);
    const hasSummaryArtifact = Boolean(job.summaryArtifact);
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
          assigned_summary_worker_id,
          recording_lease_token,
          recording_lease_acquired_at,
          recording_lease_heartbeat_at,
          recording_lease_expires_at,
          transcription_lease_token,
          transcription_lease_acquired_at,
          transcription_lease_heartbeat_at,
          transcription_lease_expires_at,
          summary_lease_token,
          summary_lease_acquired_at,
          summary_lease_heartbeat_at,
          summary_lease_expires_at,
          transcription_provider,
          transcription_model,
          summary_provider,
          summary_model,
          summary_requested,
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
          transcript_preview,
          summary_preview,
          has_transcript_artifact,
          has_summary_artifact,
          job_history,
          terminal_notification_sent_at,
          terminal_notification_target,
          terminal_notification_state
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::timestamptz, $22::timestamptz, $23::timestamptz, $24, $25::timestamptz, $26::timestamptz, $27::timestamptz, $28, $29::timestamptz, $30::timestamptz, $31::timestamptz, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42::timestamptz, $43::timestamptz, $44, $45, $46::jsonb, $47::jsonb, $48::jsonb, $49, $50, $51, $52, $53::jsonb, $54::timestamptz, $55, $56)
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
          assigned_summary_worker_id = EXCLUDED.assigned_summary_worker_id,
          recording_lease_token = EXCLUDED.recording_lease_token,
          recording_lease_acquired_at = EXCLUDED.recording_lease_acquired_at,
          recording_lease_heartbeat_at = EXCLUDED.recording_lease_heartbeat_at,
          recording_lease_expires_at = EXCLUDED.recording_lease_expires_at,
          transcription_lease_token = EXCLUDED.transcription_lease_token,
          transcription_lease_acquired_at = EXCLUDED.transcription_lease_acquired_at,
          transcription_lease_heartbeat_at = EXCLUDED.transcription_lease_heartbeat_at,
          transcription_lease_expires_at = EXCLUDED.transcription_lease_expires_at,
          summary_lease_token = EXCLUDED.summary_lease_token,
          summary_lease_acquired_at = EXCLUDED.summary_lease_acquired_at,
          summary_lease_heartbeat_at = EXCLUDED.summary_lease_heartbeat_at,
          summary_lease_expires_at = EXCLUDED.summary_lease_expires_at,
          transcription_provider = EXCLUDED.transcription_provider,
          transcription_model = EXCLUDED.transcription_model,
          summary_provider = EXCLUDED.summary_provider,
          summary_model = EXCLUDED.summary_model,
          summary_requested = EXCLUDED.summary_requested,
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
          transcript_preview = EXCLUDED.transcript_preview,
          summary_preview = EXCLUDED.summary_preview,
          has_transcript_artifact = EXCLUDED.has_transcript_artifact,
          has_summary_artifact = EXCLUDED.has_summary_artifact,
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
        job.assignedSummaryWorkerId ?? null,
        job.recordingLeaseToken ?? null,
        job.recordingLeaseAcquiredAt ?? null,
        job.recordingLeaseHeartbeatAt ?? null,
        job.recordingLeaseExpiresAt ?? null,
        job.transcriptionLeaseToken ?? null,
        job.transcriptionLeaseAcquiredAt ?? null,
        job.transcriptionLeaseHeartbeatAt ?? null,
        job.transcriptionLeaseExpiresAt ?? null,
        job.summaryLeaseToken ?? null,
        job.summaryLeaseAcquiredAt ?? null,
        job.summaryLeaseHeartbeatAt ?? null,
        job.summaryLeaseExpiresAt ?? null,
        job.transcriptionProvider ?? null,
        job.transcriptionModel ?? null,
        job.summaryProvider ?? null,
        job.summaryModel ?? null,
        job.summaryRequested ?? true,
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
        transcriptPreview ?? null,
        summaryPreview ?? null,
        hasTranscriptArtifact,
        hasSummaryArtifact,
        job.jobHistory ? JSON.stringify(job.jobHistory) : null,
        job.terminalNotificationSentAt ?? null,
        job.terminalNotificationTarget ?? null,
        job.terminalNotificationState ?? null
      ]
    );

    return mapRowToRecordingJob(result.rows[0]);
  }

  async heartbeatLease(input: {
    jobId: string;
    stage: 'recording' | 'transcription' | 'summary';
    leaseToken: string;
    heartbeatAt: string;
    expiresAt: string;
  }): Promise<RecordingJob | undefined> {
    const leaseColumns =
      input.stage === 'recording'
        ? {
            token: 'recording_lease_token',
            acquiredAt: 'recording_lease_acquired_at',
            heartbeatAt: 'recording_lease_heartbeat_at',
            expiresAt: 'recording_lease_expires_at'
          }
        : input.stage === 'transcription'
          ? {
              token: 'transcription_lease_token',
              acquiredAt: 'transcription_lease_acquired_at',
              heartbeatAt: 'transcription_lease_heartbeat_at',
              expiresAt: 'transcription_lease_expires_at'
            }
          : {
              token: 'summary_lease_token',
              acquiredAt: 'summary_lease_acquired_at',
              heartbeatAt: 'summary_lease_heartbeat_at',
              expiresAt: 'summary_lease_expires_at'
            };

    const result = await this.database.query<RecordingJobRow>(
      `
        UPDATE recording_jobs
        SET ${leaseColumns.acquiredAt} = COALESCE(${leaseColumns.acquiredAt}, $3::timestamptz),
            ${leaseColumns.heartbeatAt} = $3::timestamptz,
            ${leaseColumns.expiresAt} = $4::timestamptz,
            updated_at = $3::timestamptz
        WHERE id = $1
          AND ${leaseColumns.token} = $2
        RETURNING *
      `,
      [input.jobId, input.leaseToken, input.heartbeatAt, input.expiresAt]
    );

    return result.rows.length > 0 ? mapRowToRecordingJob(result.rows[0]) : undefined;
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

  async listBySubmitterPage(
    submitterId: string,
    input: { limit: number; cursor?: RecordingJobPageCursor }
  ): Promise<RecordingJobPage> {
    const cursorClause = input.cursor
      ? `
          AND (
            created_at < $2::timestamptz
            OR (created_at = $2::timestamptz AND id < $3)
          )
        `
      : '';
    const values = input.cursor
      ? [submitterId, input.cursor.createdAt, input.cursor.id, input.limit + 1]
      : [submitterId, input.limit + 1];
    const limitPlaceholder = input.cursor ? '$4' : '$2';
    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT
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
          assigned_summary_worker_id,
          recording_lease_token,
          transcription_lease_token,
          summary_lease_token,
          transcription_provider,
          transcription_model,
          summary_provider,
          summary_model,
          summary_requested,
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
          transcript_preview,
          summary_preview,
          has_transcript_artifact,
          has_summary_artifact,
          terminal_notification_sent_at,
          terminal_notification_target,
          terminal_notification_state
        FROM recording_jobs
        WHERE submitter_id = $1
        ${cursorClause}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limitPlaceholder}
      `,
      values
    );

    const rows = result.rows.map(mapRowToRecordingJobListItem);
    const pageJobs = rows.slice(0, input.limit);
    const hasMore = rows.length > input.limit;
    const nextJob = hasMore ? pageJobs.at(-1) : undefined;

    return {
      jobs: pageJobs,
      nextCursor: nextJob
        ? {
            createdAt: nextJob.createdAt,
            id: nextJob.id
          }
        : undefined
    };
  }

  async summarizeBySubmitter(submitterId: string): Promise<RecordingJobStats> {
    const result = await this.database.query<{
      total_count: number | string;
      active_count: number | string;
      queued_count: number | string;
      completed_count: number | string;
      failed_count: number | string;
    }>(
      `
        SELECT
          COUNT(*) AS total_count,
          SUM(CASE WHEN state IN ('joining', 'recording', 'transcribing') THEN 1 ELSE 0 END) AS active_count,
          SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END) AS queued_count,
          SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS completed_count,
          SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed_count
        FROM recording_jobs
        WHERE submitter_id = $1
      `,
      [submitterId]
    );

    const row = result.rows[0];
    return {
      totalCount: Number(row?.total_count ?? '0'),
      activeCount: Number(row?.active_count ?? '0'),
      queuedCount: Number(row?.queued_count ?? '0'),
      completedCount: Number(row?.completed_count ?? '0'),
      failedCount: Number(row?.failed_count ?? '0')
    };
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

  async countQueuedMeetingJobs(): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM recording_jobs
        WHERE input_source = 'meeting-link'
          AND state = 'queued'
      `
    );

    return Number(result.rows[0]?.count ?? '0');
  }

  async countPendingTranscriptionJobs(): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM recording_jobs
        WHERE recording_artifact IS NOT NULL
          AND transcript_artifact IS NULL
          AND assigned_transcription_worker_id IS NULL
          AND (
            state = 'transcribing'
            OR (state = 'queued' AND input_source = 'uploaded-audio')
          )
      `
    );

    return Number(result.rows[0]?.count ?? '0');
  }

  async countPendingSummaryJobs(): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM recording_jobs
        WHERE state = 'transcribing'
          AND summary_requested = TRUE
          AND transcript_artifact IS NOT NULL
          AND summary_artifact IS NULL
          AND assigned_summary_worker_id IS NULL
          AND processing_stage = 'summary-pending'
      `
    );

    return Number(result.rows[0]?.count ?? '0');
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
    const matching = await this.database.query<{ id: string }>(
      `
        SELECT id
        FROM recording_jobs
        WHERE submitter_id = $1
          AND state IN ('failed', 'completed')
      `,
      [submitterId]
    );

    if (matching.rows.length === 0) {
      return 0;
    }

    const ids = matching.rows.map((row) => row.id);
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
    const result = await this.database.query<{ id: string }>(
      `
        DELETE FROM recording_jobs
        WHERE id IN (${placeholders})
        RETURNING id
      `,
      ids
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
        WHERE summary_requested = TRUE
          AND assigned_summary_worker_id IS NOT NULL
          AND summary_artifact IS NULL
      `
    );

    return result.rows.map(mapRowToRecordingJob);
  }

  private async attemptRecordingClaim(
    candidate: RecordingJob,
    workerId: string
  ): Promise<RecordingJob | undefined> {
    const claimedJob = assignRecordingJobToWorker(candidate, workerId);
    const result = await this.database.query<RecordingJobRow>(
      `
        UPDATE recording_jobs
        SET assigned_worker_id = $2,
            recording_lease_token = $3,
            recording_lease_acquired_at = $4::timestamptz,
            recording_lease_heartbeat_at = $5::timestamptz,
            recording_lease_expires_at = $6::timestamptz,
            state = $7,
            updated_at = $8::timestamptz,
            job_history = $9::jsonb
        WHERE id = $1
          AND state = 'queued'
          AND input_source = 'meeting-link'
          AND assigned_worker_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM recording_jobs active_meeting
            WHERE active_meeting.input_source = 'meeting-link'
              AND active_meeting.state IN ('joining', 'recording')
              AND active_meeting.id <> $1
          )
          AND NOT EXISTS (
            SELECT 1
            FROM recording_jobs active_submitter_job
            WHERE active_submitter_job.submitter_id = $10
              AND active_submitter_job.id <> $1
              AND active_submitter_job.state IN ('joining', 'recording', 'transcribing')
          )
        RETURNING *
      `,
      [
        claimedJob.id,
        claimedJob.assignedWorkerId,
        claimedJob.recordingLeaseToken,
        claimedJob.recordingLeaseAcquiredAt,
        claimedJob.recordingLeaseHeartbeatAt,
        claimedJob.recordingLeaseExpiresAt,
        claimedJob.state,
        claimedJob.updatedAt,
        JSON.stringify(claimedJob.jobHistory ?? []),
        claimedJob.submitterId
      ]
    );

    return result.rows.length > 0 ? mapRowToRecordingJob(result.rows[0]) : undefined;
  }

  private async attemptTranscriptionClaim(
    candidate: RecordingJob,
    workerId: string,
    preferredProvider?: TranscriptionProvider
  ): Promise<RecordingJob | undefined> {
    const claimedJob = assignTranscriptionJobToWorker(candidate, workerId);
    const patchedClaimedJob =
      !claimedJob.transcriptionProvider && preferredProvider
        ? {
            ...claimedJob,
            transcriptionProvider: preferredProvider
          }
        : claimedJob;
    const result = await this.database.query<RecordingJobRow>(
      `
        UPDATE recording_jobs
        SET assigned_transcription_worker_id = $2,
            transcription_lease_token = $3,
            transcription_lease_acquired_at = $4::timestamptz,
            transcription_lease_heartbeat_at = $5::timestamptz,
            transcription_lease_expires_at = $6::timestamptz,
            transcription_provider = COALESCE(transcription_provider, $7),
            state = $8,
            processing_stage = $9,
            processing_message = $10,
            progress_percent = $11,
            updated_at = $12::timestamptz,
            job_history = $13::jsonb
        WHERE id = $1
          AND (
            state = 'transcribing'
            OR (state = 'queued' AND input_source = 'uploaded-audio')
          )
          AND recording_artifact IS NOT NULL
          AND transcript_artifact IS NULL
          AND assigned_transcription_worker_id IS NULL
          AND (
            state = 'transcribing'
            OR NOT EXISTS (
              SELECT 1
              FROM recording_jobs active_submitter_job
              WHERE active_submitter_job.submitter_id = $14
                AND active_submitter_job.id <> $1
                AND active_submitter_job.state IN ('joining', 'recording', 'transcribing')
            )
          )
        RETURNING *
      `,
      [
        patchedClaimedJob.id,
        patchedClaimedJob.assignedTranscriptionWorkerId,
        patchedClaimedJob.transcriptionLeaseToken,
        patchedClaimedJob.transcriptionLeaseAcquiredAt,
        patchedClaimedJob.transcriptionLeaseHeartbeatAt,
        patchedClaimedJob.transcriptionLeaseExpiresAt,
        patchedClaimedJob.transcriptionProvider ?? null,
        patchedClaimedJob.state,
        patchedClaimedJob.processingStage ?? null,
        patchedClaimedJob.processingMessage ?? null,
        patchedClaimedJob.progressPercent ?? null,
        patchedClaimedJob.updatedAt,
        JSON.stringify(patchedClaimedJob.jobHistory ?? []),
        patchedClaimedJob.submitterId
      ]
    );

    return result.rows.length > 0 ? mapRowToRecordingJob(result.rows[0]) : undefined;
  }

  private async attemptSummaryClaim(
    candidate: RecordingJob,
    workerId: string
  ): Promise<RecordingJob | undefined> {
    const claimedJob = assignSummaryJobToWorker(candidate, workerId);
    const result = await this.database.query<RecordingJobRow>(
      `
        UPDATE recording_jobs
        SET assigned_summary_worker_id = $2,
            summary_lease_token = $3,
            summary_lease_acquired_at = $4::timestamptz,
            summary_lease_heartbeat_at = $5::timestamptz,
            summary_lease_expires_at = $6::timestamptz,
            processing_stage = $7,
            processing_message = $8,
            progress_percent = $9,
            updated_at = $10::timestamptz,
            job_history = $11::jsonb
        WHERE id = $1
          AND state = 'transcribing'
          AND summary_requested = TRUE
          AND transcript_artifact IS NOT NULL
          AND summary_artifact IS NULL
          AND assigned_summary_worker_id IS NULL
          AND processing_stage = 'summary-pending'
        RETURNING *
      `,
      [
        claimedJob.id,
        claimedJob.assignedSummaryWorkerId,
        claimedJob.summaryLeaseToken,
        claimedJob.summaryLeaseAcquiredAt,
        claimedJob.summaryLeaseHeartbeatAt,
        claimedJob.summaryLeaseExpiresAt,
        claimedJob.processingStage ?? null,
        claimedJob.processingMessage ?? null,
        claimedJob.progressPercent ?? null,
        claimedJob.updatedAt,
        JSON.stringify(claimedJob.jobHistory ?? [])
      ]
    );

    return result.rows.length > 0 ? mapRowToRecordingJob(result.rows[0]) : undefined;
  }

  async claimNextQueued(workerId: string): Promise<RecordingJob | undefined> {
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

    for (const candidate of result.rows.map(mapRowToRecordingJob)) {
      const claimedJob = await this.attemptRecordingClaim(candidate, workerId);
      if (claimedJob) {
        return claimedJob;
      }
    }
    return undefined;
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

    for (const candidate of result.rows.map(mapRowToRecordingJob)) {
      if (
        normalizedProviders?.length &&
        !normalizedProviders.includes(candidate.transcriptionProvider ?? 'self-hosted-whisper')
      ) {
        continue;
      }

      const claimedJob = await this.attemptTranscriptionClaim(
        candidate,
        workerId,
        normalizedProviders?.length === 1 ? normalizedProviders[0] : undefined
      );

      if (claimedJob) {
        return claimedJob;
      }
    }
    return undefined;
  }

  async claimNextSummaryReady(
    workerId: string,
    allowedProviders?: SummaryProvider | SummaryProvider[]
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
        WHERE state = 'transcribing'
          AND summary_requested = TRUE
          AND transcript_artifact IS NOT NULL
          AND summary_artifact IS NULL
          AND assigned_summary_worker_id IS NULL
          AND processing_stage = 'summary-pending'
        ORDER BY updated_at ASC
      `
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    for (const candidate of result.rows.map(mapRowToRecordingJob)) {
      if (
        normalizedProviders?.length &&
        !normalizedProviders.includes(candidate.summaryProvider ?? 'local-codex')
      ) {
        continue;
      }

      const claimedJob = await this.attemptSummaryClaim(candidate, workerId);
      if (claimedJob) {
        return claimedJob;
      }
    }

    return undefined;
  }
}
