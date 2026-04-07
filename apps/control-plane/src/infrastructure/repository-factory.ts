import { Pool } from 'pg';

import type { AuthenticatedUserRepository } from '../domain/authenticated-user-repository.js';
import type { RecordingJobRepository } from '../domain/recording-job-repository.js';
import { InMemoryAuthenticatedUserRepository } from './in-memory-authenticated-user-repository.js';
import { InMemoryRecordingJobRepository } from './in-memory-recording-job-repository.js';
import {
  ensureAuthenticatedUserSchema,
  PostgresAuthenticatedUserRepository
} from './postgres/postgres-authenticated-user-repository.js';
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
  const context = await createPersistenceContextFromEnvironment();
  return context.recordingJobRepository;
};

export type PersistenceContext = {
  recordingJobRepository: RecordingJobRepository;
  authenticatedUserRepository: AuthenticatedUserRepository;
};

export const createPersistenceContextFromEnvironment = async (): Promise<PersistenceContext> => {
  if (!isPostgresDriver(process.env.PERSISTENCE_DRIVER)) {
    return {
      recordingJobRepository: new InMemoryRecordingJobRepository(),
      authenticatedUserRepository: new InMemoryAuthenticatedUserRepository()
    };
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
    await ensureAuthenticatedUserSchema(pool);
  }, 10, 3000);

  return {
    recordingJobRepository: new PostgresRecordingJobRepository(pool),
    authenticatedUserRepository: new PostgresAuthenticatedUserRepository(pool)
  };
};
