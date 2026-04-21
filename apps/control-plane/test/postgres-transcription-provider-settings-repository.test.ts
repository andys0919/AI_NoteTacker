import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';

import {
  ensureTranscriptionProviderSettingsSchema,
  PostgresTranscriptionProviderSettingsRepository
} from '../src/infrastructure/postgres/postgres-transcription-provider-settings-repository.js';

describe('PostgresTranscriptionProviderSettingsRepository', () => {
  let repository: PostgresTranscriptionProviderSettingsRepository;
  let end: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const db = newDb();
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();

    await ensureTranscriptionProviderSettingsSchema(pool);
    repository = new PostgresTranscriptionProviderSettingsRepository(pool, 'self-hosted-whisper');
    end = async () => {
      await pool.end();
    };
  });

  afterEach(async () => {
    if (end) {
      await end();
    }
  });

  it('persists and reloads the selected transcription provider', async () => {
    const initial = await repository.getCurrent();
    expect(initial.provider).toBe('self-hosted-whisper');
    expect(initial.summaryModel).toBe('gpt-5.4-mini');

    const updated = await repository.setCurrent({
      provider: 'azure-openai-gpt-4o-mini-transcribe',
      updatedBy: 'admin-user'
    });

    expect(updated.provider).toBe('azure-openai-gpt-4o-mini-transcribe');
    expect(updated.updatedBy).toBe('admin-user');

    const reloaded = await repository.getCurrent();
    expect(reloaded.provider).toBe('azure-openai-gpt-4o-mini-transcribe');
    expect(reloaded.updatedBy).toBe('admin-user');
  });

  it('persists and reloads the current summary model', async () => {
    const updated = await repository.setSummaryModel({
      summaryModel: 'gpt-5.4-nano',
      updatedBy: 'admin-user'
    });

    expect(updated.summaryModel).toBe('gpt-5.4-nano');
    expect(updated.updatedBy).toBe('admin-user');

    const reloaded = await repository.getCurrent();
    expect(reloaded.summaryModel).toBe('gpt-5.4-nano');
  });

  it('switches to the provider-appropriate default transcription model when the provider changes', async () => {
    const db = newDb();
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();

    await ensureTranscriptionProviderSettingsSchema(pool);
    repository = new PostgresTranscriptionProviderSettingsRepository(pool, {
      transcriptionProvider: 'self-hosted-whisper',
      transcriptionModel: 'large-v3',
      localTranscriptionModel: 'large-v3',
      cloudTranscriptionModel: 'gpt-4o-mini-transcribe',
      summaryProvider: 'local-codex',
      summaryModel: 'gpt-5.4-mini',
      pricingVersion: 'v1',
      defaultDailyCloudQuotaUsd: 5,
      liveMeetingReservationCapUsd: 1.5,
      concurrencyPools: {
        localTranscription: 1,
        cloudTranscription: 1,
        localSummary: 1,
        cloudSummary: 1
      }
    });

    const switched = await repository.setCurrent({
      provider: 'azure-openai-gpt-4o-mini-transcribe',
      updatedBy: 'admin-user'
    });

    expect(switched.transcriptionModel).toBe('gpt-4o-mini-transcribe');
  });

  it('normalizes a persisted azure policy row that still carries the local whisper model', async () => {
    const db = newDb();
    const adapter = db.adapters.createPg();
    const pool = new adapter.Pool();

    await ensureTranscriptionProviderSettingsSchema(pool);
    repository = new PostgresTranscriptionProviderSettingsRepository(pool, {
      transcriptionProvider: 'self-hosted-whisper',
      transcriptionModel: 'large-v3',
      localTranscriptionModel: 'large-v3',
      cloudTranscriptionModel: 'gpt-4o-mini-transcribe',
      summaryProvider: 'local-codex',
      summaryModel: 'gpt-5.4-mini',
      pricingVersion: 'v1',
      defaultDailyCloudQuotaUsd: 5,
      liveMeetingReservationCapUsd: 1.5,
      concurrencyPools: {
        localTranscription: 1,
        cloudTranscription: 1,
        localSummary: 1,
        cloudSummary: 1
      }
    });

    await pool.query(`
      insert into ai_processing_policy_settings (
        singleton_key,
        transcription_provider,
        transcription_model,
        summary_provider,
        summary_model,
        pricing_version,
        default_daily_cloud_quota_usd,
        live_meeting_reservation_cap_usd,
        local_transcription_concurrency,
        cloud_transcription_concurrency,
        local_summary_concurrency,
        cloud_summary_concurrency,
        updated_at,
        updated_by
      ) values (
        'global',
        'azure-openai-gpt-4o-mini-transcribe',
        'large-v3',
        'azure-openai',
        'gpt-5.4-nano',
        'v1',
        5,
        1.5,
        1,
        1,
        1,
        1,
        now(),
        'admin-user'
      )
    `);

    const current = await repository.getCurrent();
    expect(current.transcriptionModel).toBe('gpt-4o-mini-transcribe');

    const persisted = await pool.query(
      'select transcription_model from ai_processing_policy_settings where singleton_key = $1',
      ['global']
    );
    expect(persisted.rows[0].transcription_model).toBe('gpt-4o-mini-transcribe');
  });
});
