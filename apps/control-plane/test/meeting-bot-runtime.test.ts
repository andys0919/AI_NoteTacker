import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { HttpMeetingBotController } from '../src/infrastructure/meeting-bot-runtime.js';

describe('meeting bot runtime controller', () => {
  it('stops only the meeting-bot through its authenticated private endpoint', async () => {
    const requests: Array<{
      method?: string;
      url?: string;
      authorization?: string;
      body: string;
    }> = [];

    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          body
        });

        if (
          request.url === '/shutdown' &&
          request.headers.authorization === 'Bearer dedicated-control-token'
        ) {
          response.writeHead(202);
          response.end();
          return;
        }

        response.writeHead(404, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;

    try {
      const controller = new HttpMeetingBotController(
        `http://127.0.0.1:${address.port}`,
        'dedicated-control-token'
      );
      await controller.stopCurrentBot();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/shutdown',
      authorization: 'Bearer dedicated-control-token'
    });
    expect(requests[0].body).toBe('');
  });
});
