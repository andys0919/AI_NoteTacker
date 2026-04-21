export type WorkerClaimedJob = {
  id: string;
  leaseToken?: string;
  leaseAcquiredAt?: string;
  leaseHeartbeatAt?: string;
  leaseExpiresAt?: string;
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
  internalServiceToken?: string;
};

export class ControlPlaneHttpClient {
  constructor(private readonly options: ControlPlaneHttpClientOptions) {}

  async claimNextJob(workerId: string): Promise<WorkerClaimedJob | undefined> {
    const response = await fetch(`${this.options.baseUrl}/recording-workers/claims`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.internalServiceToken
          ? { 'x-internal-service-token': this.options.internalServiceToken }
          : {})
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

  async postJobEvent(
    jobId: string,
    payload: WorkerJobEvent,
    leaseToken?: string
  ): Promise<void> {
    const response = await fetch(`${this.options.baseUrl}/recording-jobs/${jobId}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.internalServiceToken
          ? { 'x-internal-service-token': this.options.internalServiceToken }
          : {})
      },
      body: JSON.stringify(leaseToken ? { ...payload, leaseToken } : payload)
    });

    if (!response.ok) {
      throw new Error(`Failed to post job event: ${response.status}`);
    }
  }

  async postLeaseHeartbeat(
    jobId: string,
    stage: 'recording',
    leaseToken?: string
  ): Promise<void> {
    const response = await fetch(`${this.options.baseUrl}/recording-jobs/${jobId}/leases/heartbeat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.internalServiceToken
          ? { 'x-internal-service-token': this.options.internalServiceToken }
          : {})
      },
      body: JSON.stringify({
        stage,
        ...(leaseToken ? { leaseToken } : {})
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to post lease heartbeat: ${response.status}`);
    }
  }
}
