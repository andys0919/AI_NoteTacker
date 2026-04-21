import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';

import {
  assignRecordingJobToWorker,
  attachRecordingArtifact,
  attachSummaryArtifact,
  attachTranscriptArtifact,
  createRecordingJob,
  markRecordingJobFailed,
  updateRecordingJobProgress
} from '../src/domain/recording-job.js';
import {
  PostgresRecordingJobRepository,
  ensureRecordingJobSchema
} from '../src/infrastructure/postgres/postgres-recording-job-repository.js';

describe('PostgresRecordingJobRepository', () => {
  let db: ReturnType<typeof newDb>;
  let repository: PostgresRecordingJobRepository;
  let end: (() => Promise<void>) | undefined;

  const getTableIndexNames = (tableName: string): string[] => {
    const table = db.public.getTable(tableName);

    return [...table.indexByHashAndName.values()]
      .flatMap((indexesByName: Map<string, unknown>) => [...indexesByName.keys()])
      .sort();
  };

  beforeEach(async () => {
    db = newDb();
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();

    await ensureRecordingJobSchema(pool);
    repository = new PostgresRecordingJobRepository(pool);
    end = async () => {
      await pool.end();
    };
  });

  afterEach(async () => {
    if (end) {
      await end();
    }
  });

  it('persists and reloads a recording job with artifact metadata', async () => {
    const created = createRecordingJob({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'google-meet'
    });

    const withRecording = attachRecordingArtifact(created, {
      storageKey: 'recordings/job_999/meeting.webm',
      downloadUrl: 'https://storage.example.test/recordings/job_999/meeting.webm',
      contentType: 'video/webm'
    });

    const completed = attachTranscriptArtifact(withRecording, {
      storageKey: 'transcripts/job_999/transcript.json',
      downloadUrl: 'https://storage.example.test/transcripts/job_999/transcript.json',
      contentType: 'application/json',
      language: 'en',
      segments: [
        {
          startMs: 0,
          endMs: 1500,
          text: 'hello team'
        }
      ]
    });

    const summarized = attachSummaryArtifact(completed, {
      model: 'gpt-5.3-codex-spark',
      reasoningEffort: 'medium',
      text: 'hello team summary'
    });

    await repository.save(summarized);

    const reloaded = await repository.getById(summarized.id);

    expect(reloaded).toBeDefined();
    expect(reloaded?.state).toBe('completed');
    expect(reloaded?.recordingArtifact?.storageKey).toBe('recordings/job_999/meeting.webm');
    expect(reloaded?.transcriptArtifact?.storageKey).toBe('transcripts/job_999/transcript.json');
    expect(reloaded?.transcriptArtifact?.segments[0]?.text).toBe('hello team');
    expect(reloaded?.summaryArtifact?.model).toBe('gpt-5.3-codex-spark');
    expect(reloaded?.summaryArtifact?.text).toBe('hello team summary');
  });

  it('claims the next queued job for a worker', async () => {
    const first = createRecordingJob({
      meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc',
      platform: 'google-meet'
    });

    const second = createRecordingJob({
      meetingUrl: 'https://meet.google.com/ddd-eeee-fff',
      platform: 'google-meet'
    });

    await repository.save(first);
    await repository.save(second);

    const claimed = await repository.claimNextQueued('worker-alpha');

    expect(claimed).toBeDefined();
    expect(claimed?.state).toBe('joining');
    expect(claimed?.assignedWorkerId).toBe('worker-alpha');

    const reloadedFirst = await repository.getById(first.id);

    expect(reloadedFirst?.state).toBe('joining');
    expect(reloadedFirst?.assignedWorkerId).toBe('worker-alpha');
  });

  it('claims the next transcription-ready job for a transcription worker', async () => {
    const created = createRecordingJob({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'google-meet'
    });

    const transcribing = attachRecordingArtifact(created, {
      storageKey: 'recordings/job_777/meeting.webm',
      downloadUrl: 'https://storage.example.test/recordings/job_777/meeting.webm',
      contentType: 'video/webm'
    });

    await repository.save(transcribing);

    const claimed = await repository.claimNextTranscriptionReady(
      'transcriber-alpha',
      'self-hosted-whisper'
    );

    expect(claimed).toBeDefined();
    expect(claimed?.state).toBe('transcribing');
    expect(claimed?.assignedTranscriptionWorkerId).toBe('transcriber-alpha');
    expect(claimed?.transcriptionProvider).toBe('self-hosted-whisper');
    expect(claimed?.recordingArtifact?.storageKey).toBe('recordings/job_777/meeting.webm');
  });

  it('does not claim a transcription job that is already leased to another transcription worker', async () => {
    const created = createRecordingJob({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'google-meet'
    });

    const transcribing = {
      ...attachRecordingArtifact(created, {
        storageKey: 'recordings/job_lease/meeting.webm',
        downloadUrl: 'https://storage.example.test/recordings/job_lease/meeting.webm',
        contentType: 'video/webm'
      }),
      assignedTranscriptionWorkerId: 'transcriber-alpha'
    };

    await repository.save(transcribing);

    const claimed = await repository.claimNextTranscriptionReady(
      'transcriber-beta',
      'self-hosted-whisper'
    );

    expect(claimed).toBeUndefined();
  });

  it('deletes only terminal history for the requested operator', async () => {
    const failedJob = markRecordingJobFailed(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/postgres-failed',
        platform: 'google-meet',
        submitterId: 'operator-a'
      }),
      {
        code: 'meeting-bot-failed',
        message: 'join failed'
      }
    );
    const completedJob = attachTranscriptArtifact(
      attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'https://meet.google.com/postgres-completed',
          platform: 'google-meet',
          submitterId: 'operator-a'
        }),
        {
          storageKey: 'recordings/job_pg_completed/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_pg_completed/meeting.webm',
          contentType: 'video/webm'
        }
      ),
      {
        storageKey: 'transcripts/job_pg_completed/transcript.json',
        downloadUrl: 'https://storage.example.test/transcripts/job_pg_completed/transcript.json',
        contentType: 'application/json',
        language: 'en',
        segments: [
          {
            startMs: 0,
            endMs: 1000,
            text: 'postgres completed'
          }
        ]
      }
    );
    const activeJob = assignRecordingJobToWorker(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/postgres-active',
        platform: 'google-meet',
        submitterId: 'operator-a'
      }),
      'worker-alpha'
    );
    const otherOperatorJob = markRecordingJobFailed(
      createRecordingJob({
        meetingUrl: 'https://meet.google.com/postgres-other',
        platform: 'google-meet',
        submitterId: 'operator-b'
      }),
      {
        code: 'meeting-bot-failed',
        message: 'other operator'
      }
    );

    await repository.save(failedJob);
    await repository.save(completedJob);
    await repository.save(activeJob);
    await repository.save(otherOperatorJob);

    const deletedCount = await repository.clearTerminalHistoryForSubmitter('operator-a');

    expect(deletedCount).toBe(2);
    expect(await repository.getById(failedJob.id)).toBeUndefined();
    expect(await repository.getById(completedJob.id)).toBeUndefined();
    expect(await repository.getById(activeJob.id)).toBeDefined();
    expect(await repository.getById(otherOperatorJob.id)).toBeDefined();
  });

  it('persists job history entries for archive detail timelines', async () => {
    const created = createRecordingJob({
      meetingUrl: 'uploaded://postgres-timeline.mp4',
      platform: 'uploaded-audio',
      inputSource: 'uploaded-audio',
      submitterId: 'operator-history',
      uploadedFileName: 'postgres-timeline.mp4'
    });

    const staged = updateRecordingJobProgress(created, {
      processingStage: 'preparing-media',
      processingMessage: 'Extracting audio from uploaded video.'
    });

    const summarized = attachSummaryArtifact(
      attachTranscriptArtifact(
        attachRecordingArtifact(staged, {
          storageKey: 'uploads/operator-history/job_pg_timeline/postgres-timeline.mp4',
          downloadUrl:
            'https://storage.example.test/uploads/operator-history/job_pg_timeline/postgres-timeline.mp4',
          contentType: 'video/mp4'
        }),
        {
          storageKey: 'transcripts/job_pg_timeline/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_pg_timeline/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: 'postgres timeline entry'
            }
          ]
        }
      ),
      {
        model: 'gpt-5.3-codex-spark',
        reasoningEffort: 'medium',
        text: 'postgres timeline summary'
      }
    );

    await repository.save(summarized);

    const reloaded = await repository.getById(summarized.id);

    expect(reloaded?.jobHistory?.length).toBeGreaterThanOrEqual(4);
    expect(reloaded?.jobHistory?.[0]?.stage).toBe('queued');
    expect(reloaded?.jobHistory?.some((entry) => entry.stage === 'preparing-media')).toBe(true);
    expect(reloaded?.jobHistory?.at(-1)?.stage).toBe('completed');
  });

  it('returns lightweight archive rows for paginated operator history lookups', async () => {
    const created = createRecordingJob({
      meetingUrl: 'https://meet.google.com/postgres-lightweight',
      platform: 'google-meet',
      submitterId: 'operator-lightweight'
    });

    const summarized = attachSummaryArtifact(
      attachTranscriptArtifact(
        attachRecordingArtifact(created, {
          storageKey: 'recordings/job_pg_lightweight/meeting.webm',
          downloadUrl:
            'https://storage.example.test/recordings/job_pg_lightweight/meeting.webm',
          contentType: 'video/webm'
        }),
        {
          storageKey: 'transcripts/job_pg_lightweight/transcript.json',
          downloadUrl:
            'https://storage.example.test/transcripts/job_pg_lightweight/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: 'hello lightweight archive'
            },
            {
              startMs: 1000,
              endMs: 2000,
              text: 'second transcript line'
            }
          ]
        }
      ),
      {
        model: 'gpt-5.3-codex-spark',
        reasoningEffort: 'medium',
        text: 'summary preview text for archive history'
      }
    );

    await repository.save(summarized);

    const page = await repository.listBySubmitterPage('operator-lightweight', { limit: 10 });
    const listItem = page.jobs[0] as (typeof summarized) & {
      hasTranscript?: boolean;
      hasSummary?: boolean;
      transcriptPreview?: string;
      summaryPreview?: string;
    };

    expect(listItem.hasTranscript).toBe(true);
    expect(listItem.hasSummary).toBe(true);
    expect(listItem.transcriptPreview).toContain('hello lightweight archive');
    expect(listItem.summaryPreview).toBe('summary preview text for archive history');
    expect(listItem.transcriptArtifact).toBeUndefined();
    expect(listItem.summaryArtifact).toBeUndefined();
    expect(listItem.jobHistory).toBeUndefined();
  });

  it('creates the hot-path indexes required for archive retrieval and stage claims', async () => {
    expect(getTableIndexNames('recording_jobs')).toEqual(
      expect.arrayContaining([
        'recording_jobs_submitter_archive_idx',
        'recording_jobs_submitter_state_idx',
        'recording_jobs_quota_day_created_at_idx',
        'recording_jobs_active_processing_idx',
        'recording_jobs_meeting_queue_idx',
        'recording_jobs_meeting_active_idx',
        'recording_jobs_submitter_active_idx',
        'recording_jobs_transcription_claim_idx',
        'recording_jobs_summary_claim_idx',
        'recording_jobs_summary_active_idx',
        'recording_jobs_pkey'
      ])
    );
  });
});
