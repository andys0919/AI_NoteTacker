import type { WorkerClaimedJob } from './control-plane-http-client.js';
import type { RecordingWorkerControlPlaneClient } from './worker-loop.js';

export interface RecordingWorkerExecutor {
  execute(job: WorkerClaimedJob, client: RecordingWorkerControlPlaneClient): Promise<void>;
}
