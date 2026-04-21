import type { WorkerClaimedJob, WorkerJobEvent } from './control-plane-http-client.js';
import type { RecordingWorkerExecutor } from './recording-executor.js';

export interface RecordingWorkerControlPlaneClient {
  claimNextJob(workerId: string): Promise<WorkerClaimedJob | undefined>;
  postJobEvent(jobId: string, payload: WorkerJobEvent, leaseToken?: string): Promise<void>;
  postLeaseHeartbeat(jobId: string, stage: 'recording', leaseToken?: string): Promise<void>;
}

type RunRecordingWorkerIterationInput = {
  workerId: string;
  client: RecordingWorkerControlPlaneClient;
  executor: RecordingWorkerExecutor;
  heartbeatIntervalMs?: number;
};

type WorkerIterationResult =
  | { kind: 'idle' }
  | { kind: 'processed'; jobId: string }
  | { kind: 'failed'; jobId: string };

export const runRecordingWorkerIteration = async ({
  workerId,
  client,
  executor,
  heartbeatIntervalMs = 30_000
}: RunRecordingWorkerIterationInput): Promise<WorkerIterationResult> => {
  const claimedJob = await client.claimNextJob(workerId);

  if (!claimedJob) {
    return { kind: 'idle' };
  }

  const heartbeatTimer =
    claimedJob.leaseToken && heartbeatIntervalMs > 0
      ? setInterval(() => {
          void client
            .postLeaseHeartbeat(claimedJob.id, 'recording', claimedJob.leaseToken)
            .catch(() => undefined);
        }, heartbeatIntervalMs)
      : undefined;

  try {
    await executor.execute(claimedJob, client);
  } catch (error: unknown) {
    await client.postJobEvent(claimedJob.id, {
      type: 'failed',
      failure: {
        code: 'recording-executor-failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }, claimedJob.leaseToken);

    return {
      kind: 'failed',
      jobId: claimedJob.id
    };
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }

  return {
    kind: 'processed',
    jobId: claimedJob.id
  };
};
