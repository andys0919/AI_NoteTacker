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
  backfillRecordingJobListPreviews,
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
      platform: 'google-meet',
      transcriptionGlossary: ['舌片 = 蛇片', '條碼 = 調碼']
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
    expect(reloaded?.transcriptionGlossary).toEqual(['舌片 = 蛇片', '條碼 = 調碼']);
  });

  it('loads legacy jobs without a glossary as an empty list', async () => {
    const created = createRecordingJob({
      meetingUrl: 'https://meet.google.com/legacy-empty-glossary',
      platform: 'google-meet'
    });

    await repository.save(created);

    expect((await repository.getById(created.id))?.transcriptionGlossary).toEqual([]);
  });

  it('persists one reusable meeting share link and atomically rotates or revokes it', async () => {
    const job = createRecordingJob({
      meetingUrl: 'https://meet.google.com/postgres-share-link',
      platform: 'google-meet'
    });
    await repository.save(job);
    const first = {
      jobId: job.id,
      shareId: 'first-share-id-1234567890123456',
      createdAt: '2026-07-31T08:00:00.000Z',
      expiresAt: '2026-08-30T08:00:00.000Z'
    };
    const competing = {
      jobId: job.id,
      shareId: 'competing-id-123456789012345678',
      createdAt: '2026-07-31T08:00:01.000Z',
      expiresAt: '2026-08-30T08:00:01.000Z'
    };

    expect(await repository.getOrCreateMeetingShareLink(first)).toEqual(first);
    expect(await repository.getOrCreateMeetingShareLink(competing)).toEqual(first);
    expect(await repository.getMeetingShareLinkByJobId(job.id)).toEqual(first);
    expect(await repository.getMeetingShareLinkByShareId(first.shareId)).toEqual(first);

    const rotated = await repository.rotateMeetingShareLink(competing);
    expect(rotated).toEqual(competing);
    expect(await repository.getMeetingShareLinkByShareId(first.shareId)).toBeUndefined();
    expect(await repository.getMeetingShareLinkByShareId(competing.shareId)).toEqual(competing);

    expect(
      await repository.revokeMeetingShareLink(job.id, '2026-07-31T09:00:00.000Z')
    ).toBe(true);
    expect(await repository.getMeetingShareLinkByShareId(competing.shareId)).toEqual({
      ...competing,
      revokedAt: '2026-07-31T09:00:00.000Z'
    });
    expect(await repository.getOrCreateMeetingShareLink(first)).toEqual(first);
    expect(await repository.getMeetingShareLinkByJobId(job.id)).toEqual(first);
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

  it('reclaims an expired summary lease and excludes it from active summary capacity', async () => {
    const summaryReady = attachTranscriptArtifact(
      attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'uploaded://postgres-expired-summary.wav',
          platform: 'uploaded-audio',
          inputSource: 'uploaded-audio',
          summaryRequested: true
        }),
        {
          storageKey: 'recordings/job_pg_expired_summary/meeting.wav',
          downloadUrl: 'https://storage.example.test/recordings/job_pg_expired_summary/meeting.wav',
          contentType: 'audio/wav'
        }
      ),
      {
        storageKey: 'transcripts/job_pg_expired_summary/transcript.json',
        downloadUrl: 'https://storage.example.test/transcripts/job_pg_expired_summary/transcript.json',
        contentType: 'application/json',
        language: 'en',
        segments: [{ startMs: 0, endMs: 1000, text: 'recover summary' }]
      }
    );
    await repository.save(summaryReady);
    const staleClaim = (await repository.claimNextSummaryReady('summary-stale'))!;
    await repository.save({
      ...staleClaim,
      summaryLeaseHeartbeatAt: '2026-01-01T00:00:00.000Z',
      summaryLeaseExpiresAt: '2026-01-01T00:15:00.000Z'
    });

    expect(await repository.listGeneratingSummaryJobs()).toEqual([]);
    const reclaimed = await repository.claimNextSummaryReady('summary-replacement');

    expect(reclaimed?.assignedSummaryWorkerId).toBe('summary-replacement');
    expect(reclaimed?.summaryLeaseToken).not.toBe(staleClaim.summaryLeaseToken);
    expect(reclaimed?.issuedSummaryLeaseTokens).toEqual([
      staleClaim.summaryLeaseToken,
      reclaimed?.summaryLeaseToken
    ]);
  });

  it('persists one Azure summary fallback reservation across lease reclaims', async () => {
    const summaryReady = attachTranscriptArtifact(
      attachRecordingArtifact(
        createRecordingJob({
          meetingUrl: 'uploaded://postgres-summary-fallback-once.wav',
          platform: 'uploaded-audio',
          inputSource: 'uploaded-audio',
          summaryRequested: true
        }),
        {
          storageKey: 'recordings/postgres-summary-fallback-once/meeting.wav',
          downloadUrl:
            'https://storage.example.test/postgres-summary-fallback-once/meeting.wav',
          contentType: 'audio/wav'
        }
      ),
      {
        storageKey: 'transcripts/postgres-summary-fallback-once/transcript.json',
        downloadUrl:
          'https://storage.example.test/postgres-summary-fallback-once/transcript.json',
        contentType: 'application/json',
        language: 'en',
        segments: [{ startMs: 0, endMs: 1_000, text: 'reserve once' }]
      }
    );
    await repository.save(summaryReady);
    const firstClaim = (await repository.claimNextSummaryReady('summary-original'))!;
    const reservedAt = new Date().toISOString();

    const concurrentReservations = await Promise.all([
      repository.reserveSummaryFallback({
        jobId: firstClaim.id,
        leaseToken: firstClaim.summaryLeaseToken!,
        reservedAt
      }),
      repository.reserveSummaryFallback({
        jobId: firstClaim.id,
        leaseToken: firstClaim.summaryLeaseToken!,
        reservedAt
      })
    ]);

    expect(concurrentReservations.sort()).toEqual([false, true]);
    expect(
      await repository.claimSummaryFallbackRequest({
        jobId: firstClaim.id,
        leaseToken: firstClaim.summaryLeaseToken!,
        requestId: 'request-summary-fallback-1'
      })
    ).toBe(true);
    expect(
      await repository.claimSummaryFallbackRequest({
        jobId: firstClaim.id,
        leaseToken: firstClaim.summaryLeaseToken!,
        requestId: 'request-summary-fallback-1'
      })
    ).toBe(true);
    expect(
      await repository.claimSummaryFallbackRequest({
        jobId: firstClaim.id,
        leaseToken: firstClaim.summaryLeaseToken!,
        requestId: 'request-summary-fallback-2'
      })
    ).toBe(false);

    await repository.save({
      ...firstClaim,
      summaryLeaseHeartbeatAt: '2026-01-01T00:00:00.000Z',
      summaryLeaseExpiresAt: '2026-01-01T00:15:00.000Z'
    });
    const reclaimed = (await repository.claimNextSummaryReady('summary-replacement'))!;

    expect(
      await repository.reserveSummaryFallback({
        jobId: reclaimed.id,
        leaseToken: reclaimed.summaryLeaseToken!,
        reservedAt: new Date().toISOString()
      })
    ).toBe(false);
    expect(
      await repository.claimSummaryFallbackRequest({
        jobId: reclaimed.id,
        leaseToken: reclaimed.summaryLeaseToken!,
        requestId: 'request-summary-fallback-1'
      })
    ).toBe(false);
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
    const shareFor = (jobId: string, shareId: string) => ({
      jobId,
      shareId,
      createdAt: '2026-07-31T08:00:00.000Z',
      expiresAt: '2026-08-30T08:00:00.000Z'
    });
    await repository.getOrCreateMeetingShareLink(
      shareFor(failedJob.id, 'failed-share-id-1234567890123456')
    );
    await repository.getOrCreateMeetingShareLink(
      shareFor(completedJob.id, 'completed-share-id-123456789012')
    );
    await repository.getOrCreateMeetingShareLink(
      shareFor(activeJob.id, 'active-share-id-1234567890123456')
    );
    await repository.getOrCreateMeetingShareLink(
      shareFor(otherOperatorJob.id, 'other-share-id-1234567890123456')
    );

    expect(
      await repository.deleteTerminalJobForSubmitter(failedJob.id, 'operator-a')
    ).toBe(true);
    expect(
      (await repository.getMeetingShareLinkByJobId(failedJob.id))?.revokedAt
    ).toEqual(expect.any(String));

    const deletedCount = await repository.clearTerminalHistoryForSubmitter('operator-a');

    expect(deletedCount).toBe(1);
    expect(await repository.getById(failedJob.id)).toBeUndefined();
    expect(await repository.getById(completedJob.id)).toBeUndefined();
    expect(await repository.getById(activeJob.id)).toBeDefined();
    expect(await repository.getById(otherOperatorJob.id)).toBeDefined();
    expect(
      (await repository.getMeetingShareLinkByJobId(completedJob.id))?.revokedAt
    ).toEqual(expect.any(String));
    expect(
      (await repository.getMeetingShareLinkByJobId(activeJob.id))?.revokedAt
    ).toBeUndefined();
    expect(
      (await repository.getMeetingShareLinkByJobId(otherOperatorJob.id))?.revokedAt
    ).toBeUndefined();
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

  it('keeps PostgreSQL operator history and search rows thin at the query boundary', async () => {
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

    const listQueries: string[] = [];
    const listingRepository = new PostgresRecordingJobRepository({
      query: async <TRow extends Record<string, unknown>>(
        text: string,
        values?: unknown[]
      ) => {
        listQueries.push(text);
        return database.query<TRow>(text, values);
      }
    });
    const page = await listingRepository.listBySubmitterPage('operator-lightweight', {
      limit: 10
    });
    const searched = await listingRepository.listBySubmitter(
      'operator-lightweight',
      'second transcript line'
    );
    const listItem = page.jobs[0];

    expect(listItem.hasTranscript).toBe(true);
    expect(listItem.hasSummary).toBe(true);
    expect(listItem.transcriptPreview).toContain('hello lightweight archive');
    expect(listItem.summaryPreview).toBe('summary preview text for archive history');
    expect(listItem).not.toHaveProperty('recordingArtifact');
    expect(listItem).not.toHaveProperty('transcriptArtifact');
    expect(listItem).not.toHaveProperty('summaryArtifact');
    expect(listItem).not.toHaveProperty('recordingLeaseToken');
    expect(listItem).not.toHaveProperty('transcriptionLeaseToken');
    expect(listItem).not.toHaveProperty('summaryLeaseToken');
    expect(searched.map((job) => job.id)).toEqual([summarized.id]);
    expect(listQueries).toHaveLength(2);
    for (const query of listQueries) {
      const projection = query.slice(query.indexOf('SELECT'), query.indexOf('FROM recording_jobs'));
      expect(projection).not.toMatch(/^\s*recording_artifact\s*,?$/m);
      expect(projection).not.toMatch(/^\s*transcript_artifact\s*,?$/m);
      expect(projection).not.toMatch(/^\s*summary_artifact\s*,?$/m);
      expect(projection).not.toMatch(/^\s*recording_lease_token\s*,?$/m);
      expect(projection).not.toMatch(/^\s*transcription_lease_token\s*,?$/m);
      expect(projection).not.toMatch(/^\s*summary_lease_token\s*,?$/m);
    }
  });

  it('backfills historical list previews once with current preview semantics', async () => {
    const summaryText = ` ${'x'.repeat(330)} `;
    const summarized = attachSummaryArtifact(
      attachTranscriptArtifact(
        attachRecordingArtifact(
          createRecordingJob({
            meetingUrl: 'https://meet.google.com/postgres-preview-backfill',
            platform: 'google-meet',
            submitterId: 'operator-preview-backfill'
          }),
          {
            storageKey: 'recordings/job_pg_preview_backfill/meeting.webm',
            downloadUrl:
              'https://storage.example.test/recordings/job_pg_preview_backfill/meeting.webm',
            contentType: 'video/webm'
          }
        ),
        {
          storageKey: 'transcripts/job_pg_preview_backfill/transcript.json',
          downloadUrl:
            'https://storage.example.test/transcripts/job_pg_preview_backfill/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            { startMs: 0, endMs: 1000, text: '  first segment  ' },
            { startMs: 1000, endMs: 2000, text: '   ' },
            { startMs: 2000, endMs: 3000, text: 'second segment' },
            { startMs: 3000, endMs: 4000, text: '\nthird segment\n' },
            { startMs: 4000, endMs: 5000, text: 'fourth segment' },
            { startMs: 5000, endMs: 6000, text: 'fifth segment' },
            { startMs: 6000, endMs: 7000, text: 'must not appear' }
          ]
        }
      ),
      {
        model: 'gpt-5.3-codex-spark',
        reasoningEffort: 'medium',
        text: summaryText
      }
    );

    await repository.save(summarized);
    const before = await database.query<{
      transcript_artifact: unknown;
      summary_artifact: unknown;
    }>(
      'SELECT transcript_artifact, summary_artifact FROM recording_jobs WHERE id = $1',
      [summarized.id]
    );
    await database.query(
      `
        UPDATE recording_jobs
        SET transcript_preview = NULL, summary_preview = NULL
        WHERE id = $1
      `,
      [summarized.id]
    );

    let rowUpdateCount = 0;
    const backfillDatabase = {
      query: async <TRow extends Record<string, unknown>>(
        text: string,
        values?: unknown[]
      ) => {
        if (/SET\s+transcript_preview = CASE/.test(text)) {
          rowUpdateCount += 1;
        }
        return database.query<TRow>(text, values);
      }
    };

    await backfillRecordingJobListPreviews(backfillDatabase);
    await backfillRecordingJobListPreviews(backfillDatabase);

    const after = await database.query<{
      transcript_artifact: unknown;
      summary_artifact: unknown;
      transcript_preview: string | null;
      summary_preview: string | null;
    }>(
      `
        SELECT transcript_artifact, summary_artifact, transcript_preview, summary_preview
        FROM recording_jobs
        WHERE id = $1
      `,
      [summarized.id]
    );

    expect(after.rows[0]).toMatchObject({
      transcript_artifact: before.rows[0]?.transcript_artifact,
      summary_artifact: before.rows[0]?.summary_artifact,
      transcript_preview:
        'first segment\nsecond segment\nthird segment\nfourth segment\nfifth segment',
      summary_preview: `${'x'.repeat(320)}...`
    });
    expect(rowUpdateCount).toBe(1);
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
