import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataType, newDb } from 'pg-mem';

import {
  assignRecordingJobToWorker,
  assignSummaryJobToWorker,
  assignTranscriptionJobToWorker,
  attachRecordingArtifact,
  attachSummaryArtifact,
  attachTranscriptArtifact,
  createRecordingJob,
  markRecordingJobFailed,
  releaseTranscriptionJobForRetry,
  updateRecordingJobProgress
} from '../src/domain/recording-job.js';
import {
  backfillActiveLeaseTokenHistory,
  PostgresRecordingJobRepository,
  ensureRecordingJobSchema
} from '../src/infrastructure/postgres/postgres-recording-job-repository.js';

describe('PostgresRecordingJobRepository', () => {
  let db: ReturnType<typeof newDb>;
  let database: ConstructorParameters<typeof PostgresRecordingJobRepository>[0];
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
    db.public.registerFunction({
      name: 'jsonb_build_array',
      args: [DataType.text],
      returns: DataType.jsonb,
      implementation: (value: string) => [value]
    });
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();

    await ensureRecordingJobSchema(pool);
    database = pool;
    repository = new PostgresRecordingJobRepository(database);
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
      schemaVersion: 2,
      storageKey: 'transcripts/job_999/transcript.json',
      downloadUrl: 'https://storage.example.test/transcripts/job_999/transcript.json',
      contentType: 'application/json',
      language: 'en',
      segments: [
        {
          startMs: 0,
          endMs: 1500,
          text: 'hello team',
          rawText: 'hello team',
          displayText: 'hello team',
          language: 'en',
          languageConfidence: 0.99,
          timingSource: 'provider',
          reviewFlags: []
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
    expect(reloaded?.transcriptArtifact?.segments[0]).toMatchObject({
      rawText: 'hello team',
      displayText: 'hello team',
      language: 'en',
      languageConfidence: 0.99,
      timingSource: 'provider',
      reviewFlags: []
    });
    expect(reloaded?.summaryArtifact?.model).toBe('gpt-5.3-codex-spark');
    expect(reloaded?.summaryArtifact?.text).toBe('hello team summary');
  });

  it('persists and reloads the meeting passcode', async () => {
    const created = createRecordingJob({
      meetingUrl: 'https://us06web.zoom.us/j/81609875791',
      platform: 'zoom',
      meetingPasscode: '424242'
    });

    await repository.save(created);

    const reloaded = await repository.getById(created.id);

    expect(reloaded?.meetingPasscode).toBe('424242');

    const claimed = await repository.claimNextQueued('worker-passcode');

    expect(claimed?.meetingPasscode).toBe('424242');
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

  it('persists issued lease history across transcription retries and summary claims', async () => {
    const transcriptionReady = attachRecordingArtifact(
      createRecordingJob({
        meetingUrl: 'uploaded://postgres-issued-leases.wav',
        platform: 'uploaded-audio',
        inputSource: 'uploaded-audio',
        summaryRequested: true
      }),
      {
        storageKey: 'recordings/job_pg_issued/meeting.wav',
        downloadUrl: 'https://storage.example.test/recordings/job_pg_issued/meeting.wav',
        contentType: 'audio/wav'
      }
    );
    await repository.save(transcriptionReady);

    const firstAttempt = (await repository.claimNextTranscriptionReady('transcriber-alpha'))!;
    await repository.save(
      releaseTranscriptionJobForRetry(
        firstAttempt,
        { code: 'transcription-failed', message: 'retry this attempt' },
        3
      )
    );
    const secondAttempt = (await repository.claimNextTranscriptionReady('transcriber-beta'))!;

    expect(secondAttempt.issuedTranscriptionLeaseTokens).toEqual([
      firstAttempt.transcriptionLeaseToken,
      secondAttempt.transcriptionLeaseToken
    ]);

    await repository.save(
      attachTranscriptArtifact(secondAttempt, {
        storageKey: 'transcripts/job_pg_issued/transcript.json',
        downloadUrl: 'https://storage.example.test/transcripts/job_pg_issued/transcript.json',
        contentType: 'application/json',
        language: 'en',
        segments: [{ startMs: 0, endMs: 1_000, text: 'issued lease history' }]
      })
    );
    const summaryAttempt = (await repository.claimNextSummaryReady('summary-alpha'))!;

    expect(summaryAttempt.issuedSummaryLeaseTokens).toEqual([
      summaryAttempt.summaryLeaseToken
    ]);
    expect((await repository.getById(summaryAttempt.id))?.issuedTranscriptionLeaseTokens).toEqual(
      secondAttempt.issuedTranscriptionLeaseTokens
    );
  });

  it('backfills active legacy leases before terminal CAS clears their active tokens', async () => {
    const transcriptionAssigned = assignTranscriptionJobToWorker(
      attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'uploaded://postgres-legacy-transcription.wav',
          platform: 'uploaded-audio',
          inputSource: 'uploaded-audio'
        }),
        {
          storageKey: 'recordings/job_pg_legacy_transcription/meeting.wav',
          downloadUrl:
            'https://storage.example.test/recordings/job_pg_legacy_transcription/meeting.wav',
          contentType: 'audio/wav'
        }
      ),
      'transcriber-legacy'
    );
    const summaryAssigned = assignSummaryJobToWorker(
      attachTranscriptArtifact(
        attachRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'uploaded://postgres-legacy-summary.wav',
            platform: 'uploaded-audio',
            inputSource: 'uploaded-audio',
            summaryRequested: true
          }),
          {
            storageKey: 'recordings/job_pg_legacy_summary/meeting.wav',
            downloadUrl:
              'https://storage.example.test/recordings/job_pg_legacy_summary/meeting.wav',
            contentType: 'audio/wav'
          }
        ),
        {
          storageKey: 'transcripts/job_pg_legacy_summary/transcript.json',
          downloadUrl:
            'https://storage.example.test/transcripts/job_pg_legacy_summary/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [{ startMs: 0, endMs: 1_000, text: 'legacy summary lease' }]
        }
      ),
      'summary-legacy'
    );
    await repository.save(transcriptionAssigned);
    await repository.save(summaryAssigned);
    await database.query(
      `
        UPDATE recording_jobs
        SET issued_transcription_lease_tokens = '[]'::jsonb
        WHERE id = $1;
        UPDATE recording_jobs
        SET issued_summary_lease_tokens = '[]'::jsonb
        WHERE id = $2
      `,
      [transcriptionAssigned.id, summaryAssigned.id]
    );

    await backfillActiveLeaseTokenHistory(database);

    const reloadedTranscription = (await repository.getById(transcriptionAssigned.id))!;
    const reloadedSummary = (await repository.getById(summaryAssigned.id))!;
    expect(reloadedTranscription.issuedTranscriptionLeaseTokens).toEqual([
      transcriptionAssigned.transcriptionLeaseToken
    ]);
    expect(reloadedSummary.issuedSummaryLeaseTokens).toEqual([
      summaryAssigned.summaryLeaseToken
    ]);

    const completed = attachTranscriptArtifact(reloadedTranscription, {
      storageKey: 'transcripts/job_pg_legacy_transcription/transcript.json',
      downloadUrl:
        'https://storage.example.test/transcripts/job_pg_legacy_transcription/transcript.json',
      contentType: 'application/json',
      language: 'en',
      segments: [{ startMs: 0, endMs: 1_000, text: 'legacy transcription lease' }]
    });
    const saved = await repository.saveIfLeaseActive(completed, {
      stage: 'transcription',
      leaseToken: transcriptionAssigned.transcriptionLeaseToken!
    });

    expect(saved?.issuedTranscriptionLeaseTokens).toEqual([
      transcriptionAssigned.transcriptionLeaseToken
    ]);
  });

  it('does not erase a newly issued lease token when saving an older cancellation snapshot', async () => {
    const transcriptionReady = attachRecordingArtifact(
      createRecordingJob({
        meetingUrl: 'uploaded://postgres-append-only-leases.wav',
        platform: 'uploaded-audio',
        inputSource: 'uploaded-audio'
      }),
      {
        storageKey: 'recordings/job_pg_append_only/meeting.wav',
        downloadUrl: 'https://storage.example.test/recordings/job_pg_append_only/meeting.wav',
        contentType: 'audio/wav'
      }
    );
    await repository.save(transcriptionReady);
    const staleSnapshot = (await repository.claimNextTranscriptionReady('transcriber-alpha'))!;
    await repository.save(
      releaseTranscriptionJobForRetry(
        staleSnapshot,
        { code: 'transcription-failed', message: 'retry this attempt' },
        3
      )
    );
    const latestClaim = (await repository.claimNextTranscriptionReady('transcriber-beta'))!;

    await repository.save(
      markRecordingJobFailed(staleSnapshot, {
        code: 'operator-cancel-requested',
        message: 'cancelled from an older snapshot'
      })
    );

    expect((await repository.getById(latestClaim.id))?.issuedTranscriptionLeaseTokens).toEqual([
      staleSnapshot.transcriptionLeaseToken,
      latestClaim.transcriptionLeaseToken
    ]);
  });

  it('does not claim transcription from a candidate whose issued history changed after selection', async () => {
    const transcriptionReady = attachRecordingArtifact(
      createRecordingJob({
        meetingUrl: 'uploaded://postgres-transcription-claim-race.wav',
        platform: 'uploaded-audio',
        inputSource: 'uploaded-audio'
      }),
      {
        storageKey: 'recordings/job_pg_transcription_claim_race/meeting.wav',
        downloadUrl:
          'https://storage.example.test/recordings/job_pg_transcription_claim_race/meeting.wav',
        contentType: 'audio/wav'
      }
    );
    await repository.save(transcriptionReady);
    let injectedInterleaving = false;
    const racingRepository = new PostgresRecordingJobRepository({
      query: async <TRow extends Record<string, unknown>>(
        text: string,
        values?: unknown[]
      ): Promise<{ rows: TRow[] }> => {
        if (!injectedInterleaving && text.includes('SET assigned_transcription_worker_id')) {
          injectedInterleaving = true;
          await database.query(
            `
              UPDATE recording_jobs
              SET issued_transcription_lease_tokens = $2::jsonb
              WHERE id = $1
            `,
            [transcriptionReady.id, JSON.stringify(['lease_intervening_transcription'])]
          );
        }

        return await database.query<TRow>(text, values);
      }
    });

    const claimed = await racingRepository.claimNextTranscriptionReady('transcriber-stale');

    expect(claimed).toBeUndefined();
    expect(
      (await repository.getById(transcriptionReady.id))?.issuedTranscriptionLeaseTokens
    ).toEqual(['lease_intervening_transcription']);
  });

  it('does not claim summary from a candidate whose issued history changed after selection', async () => {
    const summaryReady = attachTranscriptArtifact(
      attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'uploaded://postgres-summary-claim-race.wav',
          platform: 'uploaded-audio',
          inputSource: 'uploaded-audio',
          summaryRequested: true
        }),
        {
          storageKey: 'recordings/job_pg_summary_claim_race/meeting.wav',
          downloadUrl:
            'https://storage.example.test/recordings/job_pg_summary_claim_race/meeting.wav',
          contentType: 'audio/wav'
        }
      ),
      {
        storageKey: 'transcripts/job_pg_summary_claim_race/transcript.json',
        downloadUrl:
          'https://storage.example.test/transcripts/job_pg_summary_claim_race/transcript.json',
        contentType: 'application/json',
        language: 'en',
        segments: [{ startMs: 0, endMs: 1_000, text: 'summary claim race' }]
      }
    );
    await repository.save(summaryReady);
    let injectedInterleaving = false;
    const racingRepository = new PostgresRecordingJobRepository({
      query: async <TRow extends Record<string, unknown>>(
        text: string,
        values?: unknown[]
      ): Promise<{ rows: TRow[] }> => {
        if (!injectedInterleaving && text.includes('SET assigned_summary_worker_id')) {
          injectedInterleaving = true;
          await database.query(
            `
              UPDATE recording_jobs
              SET issued_summary_lease_tokens = $2::jsonb
              WHERE id = $1
            `,
            [summaryReady.id, JSON.stringify(['lease_intervening_summary'])]
          );
        }

        return await database.query<TRow>(text, values);
      }
    });

    const claimed = await racingRepository.claimNextSummaryReady('summary-stale');

    expect(claimed).toBeUndefined();
    expect((await repository.getById(summaryReady.id))?.issuedSummaryLeaseTokens).toEqual([
      'lease_intervening_summary'
    ]);
  });

  it('atomically refuses a lifecycle save when the expected transcription lease was superseded', async () => {
    const transcriptionReady = attachRecordingArtifact(
      createRecordingJob({
        meetingUrl: 'uploaded://postgres-lease-cas.wav',
        platform: 'uploaded-audio',
        inputSource: 'uploaded-audio'
      }),
      {
        storageKey: 'recordings/job_pg_cas/meeting.wav',
        downloadUrl: 'https://storage.example.test/recordings/job_pg_cas/meeting.wav',
        contentType: 'audio/wav'
      }
    );
    await repository.save(transcriptionReady);
    const staleAttempt = (await repository.claimNextTranscriptionReady('transcriber-alpha'))!;
    await repository.save(
      releaseTranscriptionJobForRetry(
        staleAttempt,
        { code: 'transcription-failed', message: 'retry this attempt' },
        3
      )
    );
    const activeAttempt = (await repository.claimNextTranscriptionReady('transcriber-beta'))!;
    const staleCompletion = attachTranscriptArtifact(staleAttempt, {
      storageKey: 'transcripts/job_pg_cas/stale.json',
      downloadUrl: 'https://storage.example.test/transcripts/job_pg_cas/stale.json',
      contentType: 'application/json',
      language: 'en',
      segments: [{ startMs: 0, endMs: 1_000, text: 'stale completion' }]
    });

    const saved = await repository.saveIfLeaseActive(staleCompletion, {
      stage: 'transcription',
      leaseToken: staleAttempt.transcriptionLeaseToken!
    });

    expect(saved).toBeUndefined();
    expect(await repository.getById(activeAttempt.id)).toEqual(activeAttempt);
  });

  it('atomically saves lifecycle changes while the expected summary lease is active', async () => {
    const summaryReady = attachTranscriptArtifact(
      attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'uploaded://postgres-summary-cas.wav',
          platform: 'uploaded-audio',
          inputSource: 'uploaded-audio',
          summaryRequested: true
        }),
        {
          storageKey: 'recordings/job_pg_summary_cas/meeting.wav',
          downloadUrl: 'https://storage.example.test/recordings/job_pg_summary_cas/meeting.wav',
          contentType: 'audio/wav'
        }
      ),
      {
        storageKey: 'transcripts/job_pg_summary_cas/transcript.json',
        downloadUrl: 'https://storage.example.test/transcripts/job_pg_summary_cas/transcript.json',
        contentType: 'application/json',
        language: 'en',
        segments: [{ startMs: 0, endMs: 1_000, text: 'summary CAS' }]
      }
    );
    await repository.save(summaryReady);
    const assigned = (await repository.claimNextSummaryReady('summary-alpha'))!;
    const completed = attachSummaryArtifact(assigned, {
      model: 'gpt-5.6-luna',
      reasoningEffort: 'medium',
      text: 'summary result'
    });
    const persistedIssuedHistory = [
      'lease_prior_summary_attempt',
      assigned.summaryLeaseToken!
    ];
    await database.query(
      `
        UPDATE recording_jobs
        SET issued_summary_lease_tokens = $2::jsonb
        WHERE id = $1
      `,
      [assigned.id, JSON.stringify(persistedIssuedHistory)]
    );

    const saved = await repository.saveIfLeaseActive(completed, {
      stage: 'summary',
      leaseToken: assigned.summaryLeaseToken!
    });

    expect(saved?.summaryArtifact).toEqual(completed.summaryArtifact);
    expect(saved?.issuedSummaryLeaseTokens).toEqual(persistedIssuedHistory);
    expect((await repository.getById(assigned.id))?.state).toBe('completed');
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

  it('returns paginated operator history rows with full artifacts inline (history stripped)', async () => {
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
    expect(listItem.transcriptArtifact?.segments).toHaveLength(2);
    expect(listItem.summaryArtifact?.text).toBe('summary preview text for archive history');
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
