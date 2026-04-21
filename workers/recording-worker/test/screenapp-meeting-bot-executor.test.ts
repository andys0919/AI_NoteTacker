import { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ScreenappMeetingBotExecutor } from '../src/screenapp-meeting-bot-executor.js';

describe('ScreenappMeetingBotExecutor', () => {
  let server: Server;
  let baseUrl: string;
  let requests: Array<{ path: string; body: Record<string, unknown> }> = [];

  beforeEach(async () => {
    requests = [];
    server = createServer((request, response) => {
      const chunks: Uint8Array[] = [];

      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        requests.push({
          path: request.url ?? '',
          body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
        });

        response.statusCode = 202;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ success: true }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  it('dispatches a google meet job to the meeting-bot /google/join endpoint', async () => {
    const executor = new ScreenappMeetingBotExecutor({
      meetingBotBaseUrl: baseUrl,
      bearerToken: 'internal-token',
      botName: 'AI NoteTacker',
      teamId: 'team-123',
      timezone: 'UTC',
      userId: 'worker-user'
    });

    await executor.execute({
      id: 'job_123',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'google-meet',
      state: 'joining'
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe('/google/join');
    expect(requests[0]?.body).toMatchObject({
      url: 'https://meet.google.com/abc-defg-hij',
      name: 'AI NoteTacker',
      bearerToken: 'internal-token',
      teamId: 'team-123',
      timezone: 'UTC',
      userId: 'worker-user',
      botId: 'job_123'
    });
  });

  it('uses the requested join name from the claimed job when provided', async () => {
    const executor = new ScreenappMeetingBotExecutor({
      meetingBotBaseUrl: baseUrl,
      bearerToken: 'internal-token',
      botName: 'AI NoteTacker',
      teamId: 'team-123',
      timezone: 'UTC',
      userId: 'worker-user'
    });

    await executor.execute({
      id: 'job_custom_name',
      meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV',
      platform: 'microsoft-teams',
      state: 'joining',
      requestedJoinName: 'Solomon - NoteTaker Pro'
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe('/microsoft/join');
    expect(requests[0]?.body.name).toBe('Solomon - NoteTaker Pro');
  });

  it('dispatches a zoom job to the meeting-bot /zoom/join endpoint', async () => {
    const executor = new ScreenappMeetingBotExecutor({
      meetingBotBaseUrl: baseUrl,
      bearerToken: 'internal-token',
      botName: 'AI NoteTacker',
      teamId: 'team-123',
      timezone: 'UTC',
      userId: 'worker-user'
    });

    await executor.execute({
      id: 'job_zoom',
      meetingUrl: 'https://us06web.zoom.us/j/123456789?pwd=7b18950c7815jk1hg5&omn=468791',
      platform: 'zoom',
      state: 'joining'
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe('/zoom/join');
    expect(requests[0]?.body).toMatchObject({
      url: 'https://us06web.zoom.us/j/123456789?pwd=7b18950c7815jk1hg5&omn=468791',
      name: 'AI NoteTacker',
      bearerToken: 'internal-token',
      teamId: 'team-123',
      timezone: 'UTC',
      userId: 'worker-user',
      botId: 'job_zoom'
    });
  });
});
