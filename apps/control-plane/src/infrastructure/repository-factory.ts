import { Pool } from 'pg';

import type { RecordingJobRepository } from '../domain/recording-job-repository.js';
import { InMemoryRecordingJobRepository } from './in-memory-recording-job-repository.js';
import {
  ensureRecordingJobSchema,
  PostgresRecordingJobRepository
} from './postgres/postgres-recording-job-repository.js';

const isPostgresDriver = (value: string | undefined): boolean => value === 'postgres';

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const withRetry = async <T>(operation: () => Promise<T>, attempts: number, delayMs: number): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      await sleep(delayMs);
    }
  }

  throw lastError;
};

export const createRecordingJobRepositoryFromEnvironment = async (): Promise<RecordingJobRepository> => {
  if (!isPostgresDriver(process.env.PERSISTENCE_DRIVER)) {
    return new InMemoryRecordingJobRepository();
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL must be set when PERSISTENCE_DRIVER=postgres');
  }

  const pool = new Pool({
    connectionString
  });

  await withRetry(async () => {
    await ensureRecordingJobSchema(pool);
  }, 10, 3000);

  return new PostgresRecordingJobRepository(pool);
};
