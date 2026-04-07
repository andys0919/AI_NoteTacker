import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DockerSocketMeetingBotController } from '../src/infrastructure/meeting-bot-runtime.js';

describe('meeting bot runtime controller', () => {
  let socketDir: string | undefined;

  afterEach(async () => {
    if (socketDir) {
      await rm(socketDir, { recursive: true, force: true });
      socketDir = undefined;
    }
  });

  it('stops the current bot by restarting the meeting-bot container with a graceful timeout', async () => {
    socketDir = await mkdtemp(join(tmpdir(), 'meeting-bot-runtime-'));
    const socketPath = join(socketDir, 'docker.sock');
    const requests: Array<{ method?: string; url?: string; body: string }> = [];

    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({
          method: request.method,
          url: request.url,
          body
        });

        if (request.url === '/containers/meeting-bot-1/restart?t=90') {
          response.writeHead(204);
          response.end();
          return;
        }

        response.writeHead(404, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    try {
      const controller = new DockerSocketMeetingBotController(socketPath, 'meeting-bot-1', 90);
      await controller.stopCurrentBot();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/containers/meeting-bot-1/restart?t=90'
    });
    expect(requests[0].body).toBe('');
  });
});
