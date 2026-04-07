import type { RecordingJobState } from './recording-job.js';

export type TerminalJobNotification = {
  to: string;
  state: RecordingJobState;
  jobId: string;
  subject: string;
  text: string;
};

export interface JobNotificationSender {
  sendTerminalJobNotification(notification: TerminalJobNotification): Promise<void>;
}
