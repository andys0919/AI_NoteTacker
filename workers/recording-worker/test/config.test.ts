import { describe, expect, it } from 'vitest';

import { readRecordingWorkerConfig } from '../src/config.js';

describe('readRecordingWorkerConfig', () => {
  it('reads worker config from environment values', () => {
    const config = readRecordingWorkerConfig({
      CONTROL_PLANE_BASE_URL: 'http://127.0.0.1:3000',
      WORKER_ID: 'worker-alpha',
      ARTIFACT_BASE_URL: 'https://storage.example.test'
    });

    expect(config).toEqual({
      controlPlaneBaseUrl: 'http://127.0.0.1:3000',
      workerId: 'worker-alpha',
      executorKind: 'stub',
      artifactBaseUrl: 'https://storage.example.test',
      pollIntervalMs: 1000
    });
  });

  it('reads screenapp meeting-bot executor config when configured', () => {
    const config = readRecordingWorkerConfig({
      CONTROL_PLANE_BASE_URL: 'http://127.0.0.1:3000',
      WORKER_ID: 'worker-alpha',
      RECORDING_EXECUTOR: 'screenapp',
      MEETING_BOT_BASE_URL: 'http://meeting-bot:3000',
      MEETING_BOT_BEARER_TOKEN: 'internal-token',
      MEETING_BOT_BOT_NAME: 'AI NoteTacker',
      MEETING_BOT_TEAM_ID: 'team-123',
      MEETING_BOT_TIMEZONE: 'UTC',
      MEETING_BOT_USER_ID: 'worker-user'
    });

    expect(config).toEqual({
      controlPlaneBaseUrl: 'http://127.0.0.1:3000',
      workerId: 'worker-alpha',
      executorKind: 'screenapp',
      artifactBaseUrl: undefined,
      meetingBotBaseUrl: 'http://meeting-bot:3000',
      meetingBotBearerToken: 'internal-token',
      meetingBotBotName: 'AI NoteTacker',
      meetingBotTeamId: 'team-123',
      meetingBotTimezone: 'UTC',
      meetingBotUserId: 'worker-user',
      pollIntervalMs: 1000
    });
  });
});
