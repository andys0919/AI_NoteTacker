import { describe, expect, it, vi } from 'vitest';

import {
  runRecordingWorkerIteration,
  type RecordingWorkerControlPlaneClient,
  type RecordingWorkerExecutor,
  type WorkerClaimedJob
} from '../src/worker-loop.js';

class FakeWorkerClient implements RecordingWorkerControlPlaneClient {
  readonly events: Array<{ jobId: string; payload: unknown }> = [];
  readonly heartbeats: Array<{ jobId: string; stage: string; leaseToken?: string }> = [];

  constructor(private readonly claimedJob: WorkerClaimedJob | undefined) {}

  async claimNextJob(_workerId: string): Promise<WorkerClaimedJob | undefined> {
    return this.claimedJob;
  }

  async postJobEvent(jobId: string, payload: unknown, leaseToken?: string): Promise<void> {
    const normalizedPayload =
      leaseToken && typeof payload === 'object' && payload !== null
        ? { ...payload, leaseToken }
        : payload;
    this.events.push({ jobId, payload: normalizedPayload });
  }

  async postLeaseHeartbeat(jobId: string, stage: 'recording', leaseToken?: string): Promise<void> {
    this.heartbeats.push({ jobId, stage, leaseToken });
  }
}

class FakeExecutor implements RecordingWorkerExecutor {
  async execute(job: WorkerClaimedJob, client: RecordingWorkerControlPlaneClient): Promise<void> {
    await client.postJobEvent(job.id, {
      type: 'state-updated',
      state: 'recording'
    }, job.leaseToken);

    await client.postJobEvent(job.id, {
      type: 'recording-artifact-stored',
      recordingArtifact: {
        storageKey: `recordings/${job.id}/meeting.webm`,
        downloadUrl: `https://storage.example.test/recordings/${job.id}/meeting.webm`,
        contentType: 'video/webm'
      }
    }, job.leaseToken);
  }
}

class ThrowingExecutor implements RecordingWorkerExecutor {
  async execute(): Promise<void> {
    throw new Error('meeting-bot dispatch failed');
  }
}

class SlowExecutor implements RecordingWorkerExecutor {
  constructor(private readonly delayMs: number) {}

  async execute(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
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
      leaseToken: 'lease_123',
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
      leaseToken: 'lease_123',
      type: 'state-updated',
      state: 'recording'
    });
    expect(client.events[1]?.payload).toMatchObject({
      leaseToken: 'lease_123',
      type: 'recording-artifact-stored'
    });
  });

  it('marks the job failed when the executor throws', async () => {
    const client = new FakeWorkerClient({
      id: 'job_456',
      leaseToken: 'lease_456',
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
      leaseToken: 'lease_456',
      type: 'failed',
      failure: {
        code: 'recording-executor-failed',
        message: 'meeting-bot dispatch failed'
      }
    });
  });

  it('posts recording lease heartbeats while a claimed job is still running', async () => {
    vi.useFakeTimers();
    const client = new FakeWorkerClient({
      id: 'job_heartbeat',
      leaseToken: 'lease_recording_heartbeat',
      platform: 'google-meet',
      meetingUrl: 'https://meet.google.com/abc-defg-hij'
    });

    const iterationPromise = runRecordingWorkerIteration({
      workerId: 'worker-alpha',
      client,
      executor: new SlowExecutor(120_000),
      heartbeatIntervalMs: 30_000
    });

    await vi.advanceTimersByTimeAsync(90_000);

    expect(client.heartbeats).toHaveLength(3);
    expect(client.heartbeats[0]).toEqual({
      jobId: 'job_heartbeat',
      stage: 'recording',
      leaseToken: 'lease_recording_heartbeat'
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await iterationPromise;
    vi.useRealTimers();
  });
});
