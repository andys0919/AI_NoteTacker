#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

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

const baseUrl = (args.get('base-url') ?? process.env.CONTROL_PLANE_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const meetingUrl = args.get('meeting-url') ?? 'https://meet.google.com/abc-defg-hij';
const submitterPrefix = args.get('submitter-prefix') ?? 'load-probe';
const meetingCount = Number(args.get('meetings') ?? '0');
const uploadCount = Number(args.get('uploads') ?? '0');
const audioFilePath = args.get('audio-file');
const authToken = args.get('auth-token') ?? process.env.LOAD_PROBE_AUTH_TOKEN;

if (!Number.isInteger(meetingCount) || meetingCount < 0) {
  throw new Error('--meetings must be a non-negative integer');
}

if (!Number.isInteger(uploadCount) || uploadCount < 0) {
  throw new Error('--uploads must be a non-negative integer');
}

if (uploadCount > 0 && !audioFilePath) {
  throw new Error('--audio-file is required when --uploads is greater than 0');
}

const defaultHeaders = authToken ? { authorization: `Bearer ${authToken}` } : {};

const submitJson = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...defaultHeaders,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
};

const submitUpload = async (submitterId, bytes) => {
  const formData = new FormData();
  formData.set('submitterId', submitterId);
  formData.set(
    'audio',
    new File([bytes], 'load-probe.wav', {
      type: 'audio/wav'
    })
  );

  const response = await fetch(`${baseUrl}/api/operator/jobs/uploads`, {
    method: 'POST',
    headers: defaultHeaders,
    body: formData
  });

  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
};

const summarize = (label, results) => {
  const totals = results.reduce(
    (summary, result) => {
      summary.total += 1;
      summary.byStatus[result.status] = (summary.byStatus[result.status] ?? 0) + 1;
      if (result.ok) {
        summary.success += 1;
      } else {
        summary.failure += 1;
      }
      return summary;
    },
    {
      total: 0,
      success: 0,
      failure: 0,
      byStatus: {}
    }
  );

  console.log(`\n${label}`);
  console.log(JSON.stringify(totals, null, 2));
};

const main = async () => {
  const uploadBytes = audioFilePath ? await readFile(audioFilePath) : undefined;
  const meetingResults = [];
  const uploadResults = [];

  for (let index = 0; index < meetingCount; index += 1) {
    meetingResults.push(
      await submitJson('/api/operator/jobs/meetings', {
        submitterId: `${submitterPrefix}-meeting-${index + 1}`,
        meetingUrl
      })
    );
  }

  for (let index = 0; index < uploadCount; index += 1) {
    uploadResults.push(
      await submitUpload(`${submitterPrefix}-upload-${index + 1}`, uploadBytes)
    );
  }

  summarize('Meeting submissions', meetingResults);
  summarize('Upload submissions', uploadResults);
};

await main();
