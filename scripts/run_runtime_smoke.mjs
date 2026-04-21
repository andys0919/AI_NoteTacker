#!/usr/bin/env node

import { setTimeout as sleep } from 'node:timers/promises';

const parseArgs = (argv) => {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const nextValue = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined) {
      index += 1;
    }

    values.set(rawKey, nextValue);
  }

  return values;
};

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args.get('base-url') ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const meetingUrl = args.get('meeting-url') ?? 'https://meet.google.com/abc-defg-hij';
const timeoutMs = Number(args.get('timeout-ms') ?? '240000');
const pollIntervalMs = Number(args.get('poll-interval-ms') ?? '2000');
const idPrefix = args.get('id-prefix') ?? `smoke-${Date.now()}`;

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error('--timeout-ms must be a positive number');
}

if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error('--poll-interval-ms must be a positive number');
}

const generateWavBytes = () => {
  const sampleRate = 16_000;
  const durationSeconds = 1;
  const frequencyHz = 440;
  const amplitude = 16_000;
  const sampleCount = sampleRate * durationSeconds;
  const pcm = Buffer.alloc(sampleCount * 2);

  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.round(
      amplitude * Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate)
    );
    pcm.writeInt16LE(value, index * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
};

const fail = (message, extra) => {
  if (extra !== undefined) {
    console.error(message, extra);
  } else {
    console.error(message);
  }
  process.exit(1);
};

const submitJson = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
};

const fetchJson = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
};

const fetchText = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await response.text();
  return { status: response.status, ok: response.ok, payload };
};

const waitForHealth = async () => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {}

    await sleep(pollIntervalMs);
  }

  fail(`Timed out waiting for ${baseUrl}/health`);
};

const submitUpload = async (submitterId) => {
  const formData = new FormData();
  formData.set('submitterId', submitterId);
  formData.set(
    'audio',
    new File([generateWavBytes()], 'runtime-smoke.wav', {
      type: 'audio/wav'
    })
  );

  const response = await fetch(`${baseUrl}/api/operator/jobs/uploads`, {
    method: 'POST',
    body: formData
  });

  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
};

const waitForTerminalJob = async (jobId, submitterId) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detail = await fetchJson(
      `/api/operator/jobs/${jobId}?submitterId=${encodeURIComponent(submitterId)}`
    );

    if (!detail.ok) {
      await sleep(pollIntervalMs);
      continue;
    }

    if (detail.payload.state === 'completed' || detail.payload.state === 'failed') {
      return detail.payload;
    }

    await sleep(pollIntervalMs);
  }

  fail(`Timed out waiting for terminal state on job ${jobId}`);
};

const main = async () => {
  const uploadSubmitterId = `${idPrefix}-upload`;
  const meetingSubmitterId = `${idPrefix}-meeting`;

  console.log(`Waiting for health at ${baseUrl}...`);
  await waitForHealth();

  const meetingSubmission = await submitJson('/api/operator/jobs/meetings', {
    submitterId: meetingSubmitterId,
    meetingUrl
  });

  if (!meetingSubmission.ok) {
    fail('Meeting submission failed', meetingSubmission);
  }

  const uploadSubmission = await submitUpload(uploadSubmitterId);

  if (!uploadSubmission.ok) {
    fail('Upload submission failed', uploadSubmission);
  }

  const uploadJob = await waitForTerminalJob(uploadSubmission.payload.id, uploadSubmitterId);
  const meetingJob = await waitForTerminalJob(meetingSubmission.payload.id, meetingSubmitterId);

  if (uploadJob.state !== 'completed') {
    fail('Upload smoke job did not complete successfully', uploadJob);
  }

  if (!uploadJob.transcriptArtifact) {
    fail('Upload smoke job completed without a transcript artifact', uploadJob);
  }

  if (uploadJob.summaryRequested && !uploadJob.summaryArtifact?.text) {
    fail('Upload smoke job requested summary but no summary artifact was stored', uploadJob);
  }

  const markdownExport = await fetchText(
    `/api/operator/jobs/${uploadJob.id}/export?submitterId=${encodeURIComponent(
      uploadSubmitterId
    )}&format=markdown`
  );

  if (
    !markdownExport.ok ||
    !markdownExport.payload.includes('# AI NoteTacker Export') ||
    !markdownExport.payload.includes('## Summary')
  ) {
    fail('Upload markdown export failed smoke verification', markdownExport);
  }

  const listResponse = await fetchJson(
    `/api/operator/jobs?submitterId=${encodeURIComponent(uploadSubmitterId)}`
  );

  if (!listResponse.ok || !Array.isArray(listResponse.payload.jobs) || listResponse.payload.jobs.length < 1) {
    fail('Operator job list did not return the uploaded job', listResponse);
  }

  if (meetingJob.state !== 'completed') {
    fail('Meeting smoke job did not complete successfully', meetingJob);
  }

  if (!meetingJob.recordingArtifact) {
    fail('Meeting smoke job completed without a recording artifact', meetingJob);
  }

  if (!meetingJob.transcriptArtifact) {
    fail('Meeting smoke job completed without a transcript artifact', meetingJob);
  }

  console.log(
    JSON.stringify(
      {
        baseUrl,
        uploadJob: {
          id: uploadJob.id,
          state: uploadJob.state,
          transcriptSegmentCount: uploadJob.transcriptArtifact?.segments?.length ?? 0,
          summaryReady: Boolean(uploadJob.summaryArtifact?.text)
        },
        meetingJob: {
          id: meetingJob.id,
          state: meetingJob.state,
          transcriptSegmentCount: meetingJob.transcriptArtifact?.segments?.length ?? 0,
          summaryReady: Boolean(meetingJob.summaryArtifact?.text)
        }
      },
      null,
      2
    )
  );
};

await main();
