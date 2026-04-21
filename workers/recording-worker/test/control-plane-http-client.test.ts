import { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../apps/control-plane/src/app.js';
import { ControlPlaneHttpClient } from '../src/control-plane-http-client.js';

describe('ControlPlaneHttpClient', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const app = createApp();
    server = createServer(app);

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

  it('claims a job and posts a worker event to the control plane', async () => {
    const appClient = createApp();
    await fetch(`${baseUrl}/recording-jobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      })
    });

    const client = new ControlPlaneHttpClient({
      baseUrl
    });

    const claimedJob = await client.claimNextJob('worker-alpha');

    expect(claimedJob).toBeDefined();
    expect(claimedJob?.state).toBe('joining');

    await client.postJobEvent(claimedJob!.id, {
      type: 'state-updated',
      state: 'recording'
    });

    const fetchedResponse = await fetch(`${baseUrl}/recording-jobs/${claimedJob!.id}`);
    const fetchedJob = await fetchedResponse.json();

    expect(fetchedJob.state).toBe('recording');
    expect(fetchedJob.assignedWorkerId).toBe('worker-alpha');
  });

  it('posts a recording lease heartbeat to the control plane', async () => {
    await fetch(`${baseUrl}/recording-jobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        meetingUrl: 'https://meet.google.com/abc-defg-hij'
      })
    });

    const client = new ControlPlaneHttpClient({
      baseUrl
    });

    const claimedJob = await client.claimNextJob('worker-heartbeat');

    expect(claimedJob).toBeDefined();
    expect(claimedJob?.leaseToken).toBeTruthy();

    await client.postLeaseHeartbeat(claimedJob!.id, 'recording', claimedJob!.leaseToken);

    const fetchedResponse = await fetch(`${baseUrl}/recording-jobs/${claimedJob!.id}`);
    const fetchedJob = await fetchedResponse.json();

    expect(fetchedJob.assignedWorkerId).toBe('worker-heartbeat');
  });
});
