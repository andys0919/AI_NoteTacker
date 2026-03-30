import { describe, expect, it } from 'vitest';

import {
  runRecordingWorkerIteration,
  type RecordingWorkerControlPlaneClient,
  type RecordingWorkerExecutor,
  type WorkerClaimedJob
} from '../src/worker-loop.js';

class FakeWorkerClient implements RecordingWorkerControlPlaneClient {
  readonly events: Array<{ jobId: string; payload: unknown }> = [];

  constructor(private readonly claimedJob: WorkerClaimedJob | undefined) {}

  async claimNextJob(_workerId: string): Promise<WorkerClaimedJob | undefined> {
    return this.claimedJob;
  }

  async postJobEvent(jobId: string, payload: unknown): Promise<void> {
    this.events.push({ jobId, payload });
  }
}

class FakeExecutor implements RecordingWorkerExecutor {
  async execute(job: WorkerClaimedJob, client: RecordingWorkerControlPlaneClient): Promise<void> {
    await client.postJobEvent(job.id, {
      type: 'state-updated',
      state: 'recording'
    });

    await client.postJobEvent(job.id, {
      type: 'recording-artifact-stored',
      recordingArtifact: {
        storageKey: `recordings/${job.id}/meeting.webm`,
        downloadUrl: `https://storage.example.test/recordings/${job.id}/meeting.webm`,
        contentType: 'video/webm'
      }
    });
  }
}

class ThrowingExecutor implements RecordingWorkerExecutor {
  async execute(): Promise<void> {
    throw new Error('meeting-bot dispatch failed');
  }
}

describe('runRecordingWorkerIteration', () => {
  it('returns idle when no queued job is available', async () => {
    const client = new FakeWorkerClient(undefined);

    const result = await runRecordingWorkerIteration({
      workerId: 'worker-alpha',
      client,
      executor: new FakeExecutor()
    });

    expect(result).toEqual({ kind: 'idle' });
    expect(client.events).toHaveLength(0);
  });

  it('claims a job and emits recording plus transcript events', async () => {
    const client = new FakeWorkerClient({
      id: 'job_123',
      platform: 'google-meet',
      meetingUrl: 'https://meet.google.com/abc-defg-hij'
    });

    const result = await runRecordingWorkerIteration({
      workerId: 'worker-alpha',
      client,
      executor: new FakeExecutor()
    });

    expect(result.kind).toBe('processed');
    expect(result.jobId).toBe('job_123');
    expect(client.events).toHaveLength(2);
    expect(client.events[0]?.payload).toEqual({
      type: 'state-updated',
      state: 'recording'
    });
    expect(client.events[1]?.payload).toMatchObject({
      type: 'recording-artifact-stored'
    });
  });

  it('marks the job failed when the executor throws', async () => {
    const client = new FakeWorkerClient({
      id: 'job_456',
      platform: 'google-meet',
      meetingUrl: 'https://meet.google.com/abc-defg-hij'
    });

    const result = await runRecordingWorkerIteration({
      workerId: 'worker-alpha',
      client,
      executor: new ThrowingExecutor()
    });

    expect(result.kind).toBe('failed');
    expect(result.jobId).toBe('job_456');
    expect(client.events).toHaveLength(1);
    expect(client.events[0]?.payload).toEqual({
      type: 'failed',
      failure: {
        code: 'recording-executor-failed',
        message: 'meeting-bot dispatch failed'
      }
    });
  });
});
