import type { RecordingWorkerControlPlaneClient } from './worker-loop.js';
import type { RecordingWorkerExecutor } from './recording-executor.js';
import type { WorkerClaimedJob } from './control-plane-http-client.js';

type StubRecordingExecutorOptions = {
  artifactBaseUrl: string;
};

export class StubRecordingExecutor implements RecordingWorkerExecutor {
  constructor(private readonly options: StubRecordingExecutorOptions) {}

  async execute(job: WorkerClaimedJob, client: RecordingWorkerControlPlaneClient): Promise<void> {
    await client.postJobEvent(job.id, {
      type: 'state-updated',
      state: 'recording'
    });

    await client.postJobEvent(job.id, {
      type: 'recording-artifact-stored',
      recordingArtifact: {
        storageKey: `recordings/${job.id}/meeting.webm`,
        downloadUrl: `${this.options.artifactBaseUrl}/recordings/${job.id}/meeting.webm`,
        contentType: 'video/webm'
      }
    });
  }
}
