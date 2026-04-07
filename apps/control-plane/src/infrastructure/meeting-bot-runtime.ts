import { request as httpRequest } from 'node:http';

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

export class DockerSocketMeetingBotController implements MeetingBotController {
  constructor(
    private readonly socketPath: string,
    private readonly containerName: string,
    private readonly restartTimeoutSeconds: number = 90
  ) {}

  async stopCurrentBot(): Promise<void> {
    await this.requestRaw(
      'POST',
      `/containers/${encodeURIComponent(this.containerName)}/restart?t=${this.restartTimeoutSeconds}`
    );
  }

  private async requestRaw(method: string, path: string, body?: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const request = httpRequest(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: body
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body)
              }
            : undefined
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          response.on('end', () => {
            const responseText = Buffer.concat(chunks).toString('utf8');

            if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
              resolve(responseText);
              return;
            }

            reject(
              new Error(
                `docker socket request failed with status ${response.statusCode ?? 'unknown'}: ${responseText}`
              )
            );
          });
        }
      );

      request.on('error', reject);

      if (body) {
        request.write(body);
      }

      request.end();
    });
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
  const socketPath = process.env.DOCKER_SOCKET_PATH;
  const containerName = process.env.MEETING_BOT_CONTAINER_NAME;
  const restartTimeoutSeconds = Number(process.env.MEETING_BOT_STOP_TIMEOUT_SECONDS ?? '90');

  if (!socketPath || !containerName) {
    return undefined;
  }

  return new DockerSocketMeetingBotController(socketPath, containerName, restartTimeoutSeconds);
};
