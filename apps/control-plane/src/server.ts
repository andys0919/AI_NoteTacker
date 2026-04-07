import { InMemoryAuthenticatedUserRepository } from './infrastructure/in-memory-authenticated-user-repository.js';
import { createApp } from './app.js';
import { createJobNotificationSenderFromEnvironment } from './infrastructure/job-notification-sender.js';
import {
  createMeetingBotControllerFromEnvironment,
  createMeetingBotRuntimeMonitorFromEnvironment
} from './infrastructure/meeting-bot-runtime.js';
import { createOperatorAuthFromEnvironment } from './infrastructure/operator-auth.js';
import { createPersistenceContextFromEnvironment } from './infrastructure/repository-factory.js';
import { createUploadedAudioStorageFromEnvironment } from './infrastructure/uploaded-audio-storage.js';

const port = Number(process.env.PORT ?? '3000');

const main = async (): Promise<void> => {
  const persistenceContext = await createPersistenceContextFromEnvironment();
  const uploadedAudioStorage = createUploadedAudioStorageFromEnvironment();
  const meetingBotController = createMeetingBotControllerFromEnvironment();
  const meetingBotRuntimeMonitor = createMeetingBotRuntimeMonitorFromEnvironment();
  const jobNotificationSender = createJobNotificationSenderFromEnvironment();
  const operatorAuth = createOperatorAuthFromEnvironment();
  const app = createApp(persistenceContext.recordingJobRepository, {
    authenticatedUserRepository:
      persistenceContext.authenticatedUserRepository ?? new InMemoryAuthenticatedUserRepository(),
    operatorAuth,
    uploadedAudioStorage,
    meetingBotController,
    meetingBotRuntimeMonitor,
    jobNotificationSender
  });

  app.listen(port, () => {
    console.log(`control-plane listening on http://localhost:${port}`);
  });
};

main().catch((error: unknown) => {
  console.error('failed to start control-plane', error);
  process.exit(1);
});
