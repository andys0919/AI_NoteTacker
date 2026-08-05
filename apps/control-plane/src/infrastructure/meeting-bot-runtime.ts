export interface MeetingBotRuntimeMonitor {
  isBusy(): Promise<boolean>;
}

export interface MeetingBotController {
  stopCurrentBot(): Promise<void>;
}

export class HttpMeetingBotRuntimeMonitor implements MeetingBotRuntimeMonitor {
  constructor(private readonly baseUrl: string) {}

  async isBusy(): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/isbusy`);

    if (!response.ok) {
      throw new Error(`meeting-bot busy probe failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { data?: unknown };
    return payload.data === 1;
  }
}

export class HttpMeetingBotController implements MeetingBotController {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async stopCurrentBot(): Promise<void> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}` }
    });

    if (!response.ok) {
      throw new Error(`meeting-bot stop request failed with status ${response.status}`);
    }
  }
}

export const createMeetingBotRuntimeMonitorFromEnvironment = ():
  | MeetingBotRuntimeMonitor
  | undefined => {
  const baseUrl = process.env.MEETING_BOT_BASE_URL;

  if (!baseUrl) {
    return undefined;
  }

  return new HttpMeetingBotRuntimeMonitor(baseUrl);
};

export const createMeetingBotControllerFromEnvironment = (): MeetingBotController | undefined => {
  const baseUrl = process.env.MEETING_BOT_CONTROL_BASE_URL;
  const token = process.env.MEETING_BOT_CONTROL_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN;

  if (!baseUrl || !token) {
    return undefined;
  }

  return new HttpMeetingBotController(baseUrl, token);
};
