export type RecordingWorkerConfig = {
  controlPlaneBaseUrl: string;
  workerId: string;
  executorKind: 'stub' | 'screenapp';
  artifactBaseUrl?: string;
  meetingBotBaseUrl?: string;
  meetingBotBearerToken?: string;
  meetingBotBotName?: string;
  meetingBotTeamId?: string;
  meetingBotTimezone?: string;
  meetingBotUserId?: string;
  pollIntervalMs: number;
};

type WorkerEnvironment = Partial<Record<string, string | undefined>>;

export const readRecordingWorkerConfig = (environment: WorkerEnvironment): RecordingWorkerConfig => {
  const controlPlaneBaseUrl = environment.CONTROL_PLANE_BASE_URL;
  const workerId = environment.WORKER_ID;
  const executorKind = environment.RECORDING_EXECUTOR === 'screenapp' ? 'screenapp' : 'stub';
  const artifactBaseUrl = environment.ARTIFACT_BASE_URL;

  if (!controlPlaneBaseUrl) {
    throw new Error('CONTROL_PLANE_BASE_URL is required');
  }

  if (!workerId) {
    throw new Error('WORKER_ID is required');
  }

  if (executorKind === 'stub' && !artifactBaseUrl) {
    throw new Error('ARTIFACT_BASE_URL is required');
  }

  const meetingBotBaseUrl = environment.MEETING_BOT_BASE_URL;
  const meetingBotBearerToken = environment.MEETING_BOT_BEARER_TOKEN;
  const meetingBotBotName = environment.MEETING_BOT_BOT_NAME;
  const meetingBotTeamId = environment.MEETING_BOT_TEAM_ID;
  const meetingBotTimezone = environment.MEETING_BOT_TIMEZONE;
  const meetingBotUserId = environment.MEETING_BOT_USER_ID;

  if (executorKind === 'screenapp') {
    for (const [key, value] of [
      ['MEETING_BOT_BASE_URL', meetingBotBaseUrl],
      ['MEETING_BOT_BEARER_TOKEN', meetingBotBearerToken],
      ['MEETING_BOT_BOT_NAME', meetingBotBotName],
      ['MEETING_BOT_TEAM_ID', meetingBotTeamId],
      ['MEETING_BOT_TIMEZONE', meetingBotTimezone],
      ['MEETING_BOT_USER_ID', meetingBotUserId]
    ] as const) {
      if (!value) {
        throw new Error(`${key} is required when RECORDING_EXECUTOR=screenapp`);
      }
    }
  }

  return {
    controlPlaneBaseUrl,
    workerId,
    executorKind,
    artifactBaseUrl,
    meetingBotBaseUrl,
    meetingBotBearerToken,
    meetingBotBotName,
    meetingBotTeamId,
    meetingBotTimezone,
    meetingBotUserId,
    pollIntervalMs: Number(environment.POLL_INTERVAL_MS ?? '1000')
  };
};
