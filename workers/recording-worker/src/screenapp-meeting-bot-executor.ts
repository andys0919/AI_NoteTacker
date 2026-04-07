import type { RecordingWorkerControlPlaneClient } from './worker-loop.js';
import type { RecordingWorkerExecutor } from './recording-executor.js';
import type { WorkerClaimedJob } from './control-plane-http-client.js';

type ScreenappMeetingBotExecutorOptions = {
  meetingBotBaseUrl: string;
  bearerToken: string;
  botName: string;
  teamId: string;
  timezone: string;
  userId: string;
};

const platformPathMap: Record<WorkerClaimedJob['platform'], string> = {
  'google-meet': 'google',
  'microsoft-teams': 'microsoft',
  zoom: 'zoom'
};

export class ScreenappMeetingBotExecutor implements RecordingWorkerExecutor {
  constructor(private readonly options: ScreenappMeetingBotExecutorOptions) {}

  async execute(job: WorkerClaimedJob, _client: RecordingWorkerControlPlaneClient): Promise<void> {
    const providerPath = platformPathMap[job.platform];
    const response = await fetch(`${this.options.meetingBotBaseUrl}/${providerPath}/join`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        bearerToken: this.options.bearerToken,
        url: job.meetingUrl,
        name: job.requestedJoinName ?? this.options.botName,
        teamId: this.options.teamId,
        timezone: this.options.timezone,
        userId: this.options.userId,
        botId: job.id
      })
    });

    if (!response.ok) {
      throw new Error(`meeting-bot join request failed with status ${response.status}`);
    }
  }
}
