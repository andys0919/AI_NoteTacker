import type {
  RecordingArtifact,
  RecordingJob,
  TranscriptArtifact
} from '../../domain/recording-job.js';
import {
  assignRecordingJobToWorker,
  assignTranscriptionJobToWorker
} from '../../domain/recording-job.js';
import type { RecordingJobRepository } from '../../domain/recording-job-repository.js';

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
  state: RecordingJob['state'];
  assigned_worker_id: string | null;
  assigned_transcription_worker_id: string | null;
  transcription_attempt_count: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  failure_code: string | null;
  failure_message: string | null;
  recording_artifact: RecordingArtifact | null;
  transcript_artifact: TranscriptArtifact | null;
};

const recordingJobSchemaSql = `
  CREATE TABLE IF NOT EXISTS recording_jobs (
    id TEXT PRIMARY KEY,
    meeting_url TEXT NOT NULL,
    platform TEXT NOT NULL,
    state TEXT NOT NULL,
    assigned_worker_id TEXT,
    assigned_transcription_worker_id TEXT,
    transcription_attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    failure_code TEXT,
    failure_message TEXT,
    recording_artifact JSONB,
    transcript_artifact JSONB
  );
`;

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const mapRowToRecordingJob = (row: RecordingJobRow): RecordingJob => ({
  id: row.id,
  meetingUrl: row.meeting_url,
  platform: row.platform,
  state: row.state,
  assignedWorkerId: row.assigned_worker_id ?? undefined,
  assignedTranscriptionWorkerId: row.assigned_transcription_worker_id ?? undefined,
  transcriptionAttemptCount: row.transcription_attempt_count ?? 0,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
  failureCode: row.failure_code ?? undefined,
  failureMessage: row.failure_message ?? undefined,
  recordingArtifact: row.recording_artifact ?? undefined,
  transcriptArtifact: row.transcript_artifact ?? undefined
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
          state,
          assigned_worker_id,
          assigned_transcription_worker_id,
          transcription_attempt_count,
          created_at,
          updated_at,
          failure_code,
          failure_message,
          recording_artifact,
          transcript_artifact
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10, $11, $12::jsonb, $13::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          meeting_url = EXCLUDED.meeting_url,
          platform = EXCLUDED.platform,
          state = EXCLUDED.state,
          assigned_worker_id = EXCLUDED.assigned_worker_id,
          assigned_transcription_worker_id = EXCLUDED.assigned_transcription_worker_id,
          transcription_attempt_count = EXCLUDED.transcription_attempt_count,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          failure_code = EXCLUDED.failure_code,
          failure_message = EXCLUDED.failure_message,
          recording_artifact = EXCLUDED.recording_artifact,
          transcript_artifact = EXCLUDED.transcript_artifact
        RETURNING *
      `,
      [
        job.id,
        job.meetingUrl,
        job.platform,
        job.state,
        job.assignedWorkerId ?? null,
        job.assignedTranscriptionWorkerId ?? null,
        job.transcriptionAttemptCount ?? 0,
        job.createdAt,
        job.updatedAt,
        job.failureCode ?? null,
        job.failureMessage ?? null,
        job.recordingArtifact ? JSON.stringify(job.recordingArtifact) : null,
        job.transcriptArtifact ? JSON.stringify(job.transcriptArtifact) : null
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

  async claimNextQueued(workerId: string): Promise<RecordingJob | undefined> {
    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE state = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      `
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    const claimedJob = assignRecordingJobToWorker(mapRowToRecordingJob(result.rows[0]), workerId);
    return await this.save(claimedJob);
  }

  async claimNextTranscriptionReady(workerId: string): Promise<RecordingJob | undefined> {
    const result = await this.database.query<RecordingJobRow>(
      `
        SELECT *
        FROM recording_jobs
        WHERE state = 'transcribing'
          AND recording_artifact IS NOT NULL
          AND transcript_artifact IS NULL
          AND assigned_transcription_worker_id IS NULL
        ORDER BY updated_at ASC
        LIMIT 1
      `
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    const claimedJob = assignTranscriptionJobToWorker(mapRowToRecordingJob(result.rows[0]), workerId);
    return await this.save(claimedJob);
  }
}
