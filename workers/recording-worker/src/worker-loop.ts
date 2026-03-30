import type { WorkerClaimedJob, WorkerJobEvent } from './control-plane-http-client.js';
import type { RecordingWorkerExecutor } from './recording-executor.js';

export interface RecordingWorkerControlPlaneClient {
  claimNextJob(workerId: string): Promise<WorkerClaimedJob | undefined>;
  postJobEvent(jobId: string, payload: WorkerJobEvent): Promise<void>;
}

type RunRecordingWorkerIterationInput = {
  workerId: string;
  client: RecordingWorkerControlPlaneClient;
  executor: RecordingWorkerExecutor;
};

type WorkerIterationResult =
  | { kind: 'idle' }
  | { kind: 'processed'; jobId: string }
  | { kind: 'failed'; jobId: string };

export const runRecordingWorkerIteration = async ({
  workerId,
  client,
  executor
}: RunRecordingWorkerIterationInput): Promise<WorkerIterationResult> => {
  const claimedJob = await client.claimNextJob(workerId);

  if (!claimedJob) {
    return { kind: 'idle' };
  }

  try {
    await executor.execute(claimedJob, client);
  } catch (error: unknown) {
    await client.postJobEvent(claimedJob.id, {
      type: 'failed',
      failure: {
        code: 'recording-executor-failed',
        message: error instanceof Error ? error.message : String(error)
      }
    });

    return {
      kind: 'failed',
      jobId: claimedJob.id
    };
  }

  return {
    kind: 'processed',
    jobId: claimedJob.id
  };
};
