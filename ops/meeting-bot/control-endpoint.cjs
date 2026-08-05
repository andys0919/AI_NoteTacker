'use strict';

const { timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');

const token = process.env.MEETING_BOT_CONTROL_TOKEN;
if (!token || Buffer.byteLength(token, 'utf8') < 32) {
  throw new Error('MEETING_BOT_CONTROL_TOKEN must be at least 32 bytes.');
}

const timeoutSeconds = Number(process.env.MEETING_BOT_STOP_TIMEOUT_SECONDS || '90');
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 300) {
  throw new Error('MEETING_BOT_STOP_TIMEOUT_SECONDS must be between 1 and 300.');
}

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left || '', 'utf8');
  const rightBuffer = Buffer.from(right || '', 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

let stopping = false;
const server = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/shutdown') {
    response.writeHead(404).end();
    return;
  }

  const candidate = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  if (!safeEqual(candidate, token)) {
    response.writeHead(401).end();
    return;
  }

  response.writeHead(202).end();
  if (!stopping) {
    stopping = true;
    setImmediate(() => {
      setTimeout(() => process.exit(1), timeoutSeconds * 1000);
      process.kill(process.pid, 'SIGTERM');
    });
  }
});

server.listen(3001, '0.0.0.0');
server.unref();
