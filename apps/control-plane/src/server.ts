import { InMemoryAuthenticatedUserRepository } from './infrastructure/in-memory-authenticated-user-repository.js';
import { createApp } from './app.js';
import { createAdminConsoleAuthFromEnvironment } from './infrastructure/admin-console-auth.js';
import { startAzureRetailPricingRefresh } from './infrastructure/azure-retail-pricing.js';
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
  const adminConsoleAuth = createAdminConsoleAuthFromEnvironment();
  const internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  if (
    !internalServiceToken ||
    internalServiceToken === 'internal-token' ||
    Buffer.byteLength(internalServiceToken, 'utf8') < 32
  ) {
    throw new Error(
      'INTERNAL_SERVICE_TOKEN must be a dedicated non-placeholder secret of at least 32 bytes.'
    );
  }

  const persistenceContext = await createPersistenceContextFromEnvironment();
  await startAzureRetailPricingRefresh();
  const uploadedAudioStorage = createUploadedAudioStorageFromEnvironment();
  const meetingBotController = createMeetingBotControllerFromEnvironment();
  const meetingBotRuntimeMonitor = createMeetingBotRuntimeMonitorFromEnvironment();
  const jobNotificationSender = createJobNotificationSenderFromEnvironment();
  const operatorAuth = createOperatorAuthFromEnvironment();
  const app = createApp(persistenceContext.recordingJobRepository, {
    authenticatedUserRepository:
      persistenceContext.authenticatedUserRepository ?? new InMemoryAuthenticatedUserRepository(),
    transcriptionProviderSettingsRepository:
      persistenceContext.transcriptionProviderSettingsRepository,
    operatorCloudQuotaOverrideRepository:
      persistenceContext.operatorCloudQuotaOverrideRepository,
    cloudUsageLedgerRepository: persistenceContext.cloudUsageLedgerRepository,
    adminAuditLogRepository: persistenceContext.adminAuditLogRepository,
    adminConsoleAuth,
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
