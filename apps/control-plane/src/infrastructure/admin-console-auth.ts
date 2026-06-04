import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AuthenticatedOperator } from './operator-auth.js';

export type AdminConsoleSession = {
  sub: string;
  issuedAt: string;
  expiresAt: string;
};

export type AdminConsoleIssuedToken = {
  token: string;
  expiresAt: string;
};

export interface AdminConsoleAuth {
  readonly username: string;
  verifyCredentials(username: string, password: string): boolean;
  issueToken(): AdminConsoleIssuedToken;
  verifyToken(token: string | undefined): AdminConsoleSession | undefined;
  toOperator(): AuthenticatedOperator;
}

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'solomonvbuandy';
const DEFAULT_SESSION_TTL_HOURS = 12;

const base64UrlEncode = (value: string): string =>
  Buffer.from(value, 'utf8').toString('base64url');

const base64UrlDecode = (value: string): string =>
  Buffer.from(value, 'base64url').toString('utf8');

const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    // Still compare a fixed-length buffer to keep timing roughly constant.
    timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

export type AdminConsoleAuthConfig = {
  username?: string;
  password?: string;
  sessionSecret?: string;
  sessionTtlMs?: number;
  /**
   * Injectable clock so tests can pin token issue/expiry timestamps. Production
   * uses Date.now().
   */
  now?: () => number;
};

export const createAdminConsoleAuth = (config: AdminConsoleAuthConfig = {}): AdminConsoleAuth => {
  const username = (config.username ?? DEFAULT_USERNAME).trim();
  const password = config.password ?? DEFAULT_PASSWORD;
  const sessionTtlMs = config.sessionTtlMs ?? DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000;
  const now = config.now ?? (() => Date.now());
  // When no explicit secret is configured, derive a stable per-process secret so
  // tokens stay valid across requests but never use a guessable constant. Mixing
  // in the password means rotating the password also invalidates old tokens.
  const sessionSecret =
    config.sessionSecret && config.sessionSecret.trim().length > 0
      ? config.sessionSecret
      : `${password}:${randomBytes(32).toString('hex')}`;

  const sign = (payload: string): string =>
    createHmac('sha256', sessionSecret).update(payload).digest('base64url');

  const operator: AuthenticatedOperator = {
    id: `admin-console:${username}`,
    email: `${username}@console.local`
  };

  return {
    username,
    verifyCredentials(candidateUsername, candidatePassword) {
      const usernameMatches = safeEqual(candidateUsername ?? '', username);
      const passwordMatches = safeEqual(candidatePassword ?? '', password);
      // Evaluate both before returning so a wrong username and a wrong password
      // take the same time.
      return usernameMatches && passwordMatches;
    },
    issueToken() {
      const issuedAtMs = now();
      const expiresAtMs = issuedAtMs + sessionTtlMs;
      const session: AdminConsoleSession = {
        sub: operator.id,
        issuedAt: new Date(issuedAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString()
      };
      const encodedPayload = base64UrlEncode(JSON.stringify(session));
      const signature = sign(encodedPayload);

      return {
        token: `${encodedPayload}.${signature}`,
        expiresAt: session.expiresAt
      };
    },
    verifyToken(token) {
      if (!token) {
        return undefined;
      }

      const segments = token.split('.');

      if (segments.length !== 2) {
        return undefined;
      }

      const [encodedPayload, signature] = segments;
      const expectedSignature = sign(encodedPayload);

      if (!safeEqual(signature, expectedSignature)) {
        return undefined;
      }

      let session: AdminConsoleSession;

      try {
        session = JSON.parse(base64UrlDecode(encodedPayload)) as AdminConsoleSession;
      } catch {
        return undefined;
      }

      if (!session?.expiresAt || Number.isNaN(Date.parse(session.expiresAt))) {
        return undefined;
      }

      if (Date.parse(session.expiresAt) <= now()) {
        return undefined;
      }

      return session;
    },
    toOperator() {
      return { ...operator };
    }
  };
};

const parsePositiveNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const createAdminConsoleAuthFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env
): AdminConsoleAuth => {
  const ttlHours = parsePositiveNumber(env.ADMIN_CONSOLE_SESSION_TTL_HOURS);

  return createAdminConsoleAuth({
    username: env.ADMIN_CONSOLE_USERNAME,
    password: env.ADMIN_CONSOLE_PASSWORD,
    sessionSecret: env.ADMIN_CONSOLE_SESSION_SECRET,
    sessionTtlMs: ttlHours ? ttlHours * 60 * 60 * 1000 : undefined
  });
};
