export type WorkerClaimedJob = {
  id: string;
  meetingUrl: string;
  platform: 'google-meet' | 'microsoft-teams' | 'zoom';
  inputSource?: 'meeting-link';
  submitterId?: string;
  requestedJoinName?: string;
  state: 'joining' | 'recording' | 'transcribing' | 'completed' | 'failed' | 'queued';
  assignedWorkerId?: string;
};

export type WorkerJobEvent =
  | {
      type: 'state-updated';
      state: 'joining' | 'recording' | 'transcribing' | 'completed';
    }
  | {
      type: 'recording-artifact-stored';
      recordingArtifact: {
        storageKey: string;
        downloadUrl: string;
        contentType: string;
      };
    }
  | {
      type: 'transcript-artifact-stored';
      transcriptArtifact: {
        storageKey: string;
        downloadUrl: string;
        contentType: string;
        language: string;
        segments: Array<{
          startMs: number;
          endMs: number;
          text: string;
        }>;
      };
    }
  | {
      type: 'failed';
      failure: {
        code: string;
        message: string;
      };
    };

type ControlPlaneHttpClientOptions = {
  baseUrl: string;
};

export class ControlPlaneHttpClient {
  constructor(private readonly options: ControlPlaneHttpClientOptions) {}

  async claimNextJob(workerId: string): Promise<WorkerClaimedJob | undefined> {
    const response = await fetch(`${this.options.baseUrl}/recording-workers/claims`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ workerId })
    });

    if (response.status === 204) {
      return undefined;
    }

    if (!response.ok) {
      throw new Error(`Failed to claim next job: ${response.status}`);
    }

    return (await response.json()) as WorkerClaimedJob;
  }

  async postJobEvent(jobId: string, payload: WorkerJobEvent): Promise<void> {
    const response = await fetch(`${this.options.baseUrl}/recording-jobs/${jobId}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to post job event: ${response.status}`);
    }
  }
}
