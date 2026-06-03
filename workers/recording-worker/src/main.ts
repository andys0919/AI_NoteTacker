import { ControlPlaneHttpClient } from './control-plane-http-client.js';
import { readRecordingWorkerConfig } from './config.js';
import type { RecordingWorkerExecutor } from './recording-executor.js';
import { ScreenappMeetingBotExecutor } from './screenapp-meeting-bot-executor.js';
import { StubRecordingExecutor } from './stub-recording-executor.js';
import { runRecordingWorkerIteration } from './worker-loop.js';

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const createRecordingExecutor = (config: ReturnType<typeof readRecordingWorkerConfig>): RecordingWorkerExecutor => {
  if (config.executorKind === 'screenapp') {
    return new ScreenappMeetingBotExecutor({
      meetingBotBaseUrl: config.meetingBotBaseUrl!,
      bearerToken: config.meetingBotBearerToken!,
      botName: config.meetingBotBotName!,
      teamId: config.meetingBotTeamId!,
      timezone: config.meetingBotTimezone!,
      userId: config.meetingBotUserId!
    });
  }

  return new StubRecordingExecutor({
    artifactBaseUrl: config.artifactBaseUrl!
  });
};

const main = async (): Promise<void> => {
  const config = readRecordingWorkerConfig(process.env);

  // Make the recording mode unmistakable in the logs. The single most common
  // production misconfiguration is bringing the stack up without the screenapp
  // override, which silently reverts to the stub executor and stops driving the
  // meeting bot — so real Zoom/Google/Teams meetings are never recorded.
  console.log(
    `[recording-worker] executor=${config.executorKind} ` +
      `meetingBotBaseUrl=${config.meetingBotBaseUrl ?? '(none)'} ` +
      `controlPlane=${config.controlPlaneBaseUrl}`
  );
  if (config.executorKind === 'stub') {
    console.warn(
      '[recording-worker] WARNING: RECORDING_EXECUTOR is "stub" — real meeting ' +
        'recording is DISABLED. Meeting-link jobs will only produce a placeholder ' +
        'artifact (no real audio). For real Zoom/Google/Teams recording, deploy with ' +
        'RECORDING_EXECUTOR=screenapp, e.g.\n' +
        '  docker compose -f docker-compose.yml -f docker-compose.screenapp.yml up -d'
    );
  }

  const client = new ControlPlaneHttpClient({
    baseUrl: config.controlPlaneBaseUrl,
    internalServiceToken: config.internalServiceToken
  });
  const executor = createRecordingExecutor(config);

  while (true) {
    try {
      const result = await runRecordingWorkerIteration({
        workerId: config.workerId,
        client,
        executor
      });

      if (result.kind === 'idle') {
        await sleep(config.pollIntervalMs);
        continue;
      }

      console.log(`processed recording job ${result.jobId}`);
    } catch (error: unknown) {
      console.error('recording worker iteration failed', error);
      await sleep(config.pollIntervalMs);
    }
  }
};

main().catch((error: unknown) => {
  console.error('recording worker failed', error);
  process.exit(1);
});
