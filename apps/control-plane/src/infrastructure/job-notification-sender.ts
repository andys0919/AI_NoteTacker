import nodemailer from 'nodemailer';

import type { JobNotificationSender, TerminalJobNotification } from '../domain/job-notification-sender.js';

export class SmtpJobNotificationSender implements JobNotificationSender {
  constructor(
    private readonly transporter: nodemailer.Transporter,
    private readonly from: string
  ) {}

  async sendTerminalJobNotification(notification: TerminalJobNotification): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: notification.to,
      subject: notification.subject,
      text: notification.text
    });
  }
}

const parseBoolean = (value: string | undefined): boolean => value === 'true';

export const createJobNotificationSenderFromEnvironment = (): JobNotificationSender | undefined => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const from = process.env.SMTP_FROM;

  if (!host || !port || !from) {
    return undefined;
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: parseBoolean(process.env.SMTP_SECURE),
    auth: user && pass ? { user, pass } : undefined
  });

  return new SmtpJobNotificationSender(transporter, from);
};
