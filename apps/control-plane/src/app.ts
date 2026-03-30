import express from 'express';
import { z } from 'zod';

import { evaluateMeetingLinkPolicy } from './domain/meeting-link-policy.js';
import type { RecordingJobRepository } from './domain/recording-job-repository.js';
import {
  attachRecordingArtifact,
  attachTranscriptArtifact,
  assignRecordingJobToWorker,
  createRecordingJob,
  markRecordingJobFailed,
  releaseTranscriptionJobForRetry,
  transitionRecordingJobState
} from './domain/recording-job.js';
import { InMemoryRecordingJobRepository } from './infrastructure/in-memory-recording-job-repository.js';

const createRecordingJobRequestSchema = z.object({
  meetingUrl: z.url()
});

const claimRecordingJobRequestSchema = z.object({
  workerId: z.string().min(1)
});

const recordingArtifactSchema = z.object({
  storageKey: z.string().min(1),
  downloadUrl: z.url(),
  contentType: z.string().min(1)
});

const transcriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1)
});

const transcriptArtifactSchema = recordingArtifactSchema.extend({
  language: z.string().min(2),
  segments: z.array(transcriptSegmentSchema)
});

const meetingBotCompletionSchema = z.object({
  recordingId: z.string().min(1),
  meetingLink: z.url(),
  status: z.literal('completed'),
  timestamp: z.string().min(1),
  blobUrl: z.url().optional(),
  metadata: z.object({
    userId: z.string().min(1),
    teamId: z.string().min(1),
    botId: z.string().min(1),
    contentType: z.string().min(1),
    uploaderType: z.string().min(1),
    storage: z
      .object({
        provider: z.string().min(1),
        bucket: z.string().min(1).optional(),
        key: z.string().min(1).optional(),
        url: z.url().optional()
      })
      .optional()
  })
});

const recordingJobEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state-updated'),
    state: z.enum(['joining', 'recording', 'transcribing', 'completed'])
  }),
  z.object({
    type: z.literal('recording-artifact-stored'),
    recordingArtifact: recordingArtifactSchema
  }),
  z.object({
    type: z.literal('transcript-artifact-stored'),
    transcriptArtifact: transcriptArtifactSchema
  }),
  z.object({
    type: z.literal('failed'),
    failure: z.object({
      code: z.string().min(1),
      message: z.string().min(1)
    })
  }),
  z.object({
    type: z.literal('transcription-failed'),
    failure: z.object({
      code: z.string().min(1),
      message: z.string().min(1)
    })
  })
]);

type AppOptions = {
  maxTranscriptionAttempts?: number;
};

const toApiRecordingJob = (job: {
  id: string;
  meetingUrl: string;
  platform: string;
  state: string;
  assignedWorkerId?: string;
  assignedTranscriptionWorkerId?: string;
  transcriptionAttemptCount?: number;
  createdAt: string;
  updatedAt: string;
  failureCode?: string;
  failureMessage?: string;
  recordingArtifact?: {
    storageKey: string;
    downloadUrl: string;
    contentType: string;
  };
  transcriptArtifact?: {
    storageKey: string;
    downloadUrl: string;
    contentType: string;
    language: string;
    segments: {
      startMs: number;
      endMs: number;
      text: string;
    }[];
  };
}) => ({
  id: job.id,
  meetingUrl: job.meetingUrl,
  platform: job.platform,
  state: job.state,
  assignedWorkerId: job.assignedWorkerId,
  assignedTranscriptionWorkerId: job.assignedTranscriptionWorkerId,
  transcriptionAttemptCount: job.transcriptionAttemptCount,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  failureCode: job.failureCode,
  failureMessage: job.failureMessage,
  recordingArtifact: job.recordingArtifact,
  transcriptArtifact: job.transcriptArtifact
});

const deriveStorageKeyFromCompletionPayload = (
  payload: z.infer<typeof meetingBotCompletionSchema>
): string | undefined => {
  if (payload.metadata.storage?.key) {
    return payload.metadata.storage.key;
  }

  const fallbackUrl = payload.blobUrl ?? payload.metadata.storage?.url;

  if (!fallbackUrl) {
    return undefined;
  }

  const pathname = new URL(fallbackUrl).pathname.replace(/^\/+/, '');
  return pathname.length > 0 ? pathname : undefined;
};

export const createApp = (
  repository: RecordingJobRepository = new InMemoryRecordingJobRepository(),
  options: AppOptions = {}
) => {
  const app = express();
  const maxTranscriptionAttempts = options.maxTranscriptionAttempts ?? 3;

  const notFoundResponse = (id: string) => ({
    error: {
      code: 'recording-job-not-found',
      message: `Recording job ${id} does not exist.`
    }
  });

  app.use(express.json());

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.post('/recording-jobs', async (request, response) => {
    const parsedRequest = createRecordingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const supportResult = evaluateMeetingLinkPolicy(parsedRequest.data.meetingUrl);

    if (!supportResult.supported) {
      return response.status(422).json({
        error: {
          code: supportResult.code,
          message: supportResult.message
        }
      });
    }

    const job = await repository.save(
      createRecordingJob({
        meetingUrl: parsedRequest.data.meetingUrl,
        platform: supportResult.platform
      })
    );

    return response.status(201).json(toApiRecordingJob(job));
  });

  app.post('/recording-workers/claims', async (request, response) => {
    const parsedRequest = claimRecordingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const claimedJob = await repository.claimNextQueued(parsedRequest.data.workerId);

    if (!claimedJob) {
      return response.status(204).send();
    }

    return response.status(200).json(toApiRecordingJob(claimedJob));
  });

  app.post('/transcription-workers/claims', async (request, response) => {
    const parsedRequest = claimRecordingJobRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedRequest.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const claimedJob = await repository.claimNextTranscriptionReady(parsedRequest.data.workerId);

    if (!claimedJob) {
      return response.status(204).send();
    }

    return response.status(200).json(toApiRecordingJob(claimedJob));
  });

  app.post('/integrations/meeting-bot/completions', async (request, response) => {
    const parsedPayload = meetingBotCompletionSchema.safeParse(request.body);

    if (!parsedPayload.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedPayload.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await repository.getById(parsedPayload.data.metadata.botId);

    if (!job) {
      return response.status(404).json(notFoundResponse(parsedPayload.data.metadata.botId));
    }

    const storageKey = deriveStorageKeyFromCompletionPayload(parsedPayload.data);

    if (!storageKey) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: 'The completion payload must include either metadata.storage.key or blobUrl.'
        }
      });
    }

    const savedJob = await repository.save(
      attachRecordingArtifact(job, {
        storageKey,
        downloadUrl:
          parsedPayload.data.blobUrl ??
          parsedPayload.data.metadata.storage?.url ??
          parsedPayload.data.meetingLink,
        contentType: parsedPayload.data.metadata.contentType
      })
    );

    return response.status(202).json(toApiRecordingJob(savedJob));
  });

  app.post('/recording-jobs/:id/events', async (request, response) => {
    const parsedEvent = recordingJobEventSchema.safeParse(request.body);

    if (!parsedEvent.success) {
      return response.status(400).json({
        error: {
          code: 'invalid-request',
          message: parsedEvent.error.issues[0]?.message ?? 'The request payload is invalid.'
        }
      });
    }

    const job = await repository.getById(request.params.id);

    if (!job) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    const updatedJob =
      parsedEvent.data.type === 'state-updated'
        ? transitionRecordingJobState(job, parsedEvent.data.state)
        : parsedEvent.data.type === 'recording-artifact-stored'
          ? attachRecordingArtifact(job, parsedEvent.data.recordingArtifact)
          : parsedEvent.data.type === 'transcript-artifact-stored'
            ? attachTranscriptArtifact(job, parsedEvent.data.transcriptArtifact)
            : parsedEvent.data.type === 'transcription-failed'
              ? releaseTranscriptionJobForRetry(job, parsedEvent.data.failure, maxTranscriptionAttempts)
              : markRecordingJobFailed(job, parsedEvent.data.failure);

    const savedJob = await repository.save(updatedJob);

    return response.status(202).json(toApiRecordingJob(savedJob));
  });

  app.get('/recording-jobs/:id', async (request, response) => {
    const job = await repository.getById(request.params.id);

    if (!job) {
      return response.status(404).json(notFoundResponse(request.params.id));
    }

    return response.status(200).json(toApiRecordingJob(job));
  });

  return app;
};
