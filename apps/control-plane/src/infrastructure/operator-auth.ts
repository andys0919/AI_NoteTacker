import { createRemoteJWKSet, jwtVerify } from 'jose';

export type AuthenticatedOperator = {
  id: string;
  email: string;
};

export interface OperatorAuth {
  verifyAuthorizationHeader(header: string | undefined): Promise<AuthenticatedOperator | undefined>;
}

const extractBearerToken = (header: string | undefined): string | undefined => {
  if (!header) {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
};

export class SupabaseOperatorAuth implements OperatorAuth {
  private readonly issuer: string;
  private readonly jwks;

  constructor(
    private readonly supabaseUrl: string,
    private readonly publishableKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    const normalizedUrl = supabaseUrl.replace(/\/+$/, '');
    this.issuer = `${normalizedUrl}/auth/v1`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async verifyAuthorizationHeader(
    header: string | undefined
  ): Promise<AuthenticatedOperator | undefined> {
    const token = extractBearerToken(header);

    if (!token) {
      return undefined;
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated'
      });

      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        return undefined;
      }

      return {
        id: payload.sub,
        email: payload.email
      };
    } catch {
      const response = await this.fetchImpl(`${this.issuer}/user`, {
        headers: {
          apikey: this.publishableKey,
          authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        return undefined;
      }

      const payload = (await response.json()) as { id?: string; email?: string };

      if (!payload.id || !payload.email) {
        return undefined;
      }

      return {
        id: payload.id,
        email: payload.email
      };
    }
  }
}

export const createOperatorAuthFromEnvironment = (): OperatorAuth | undefined => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    return undefined;
  }

  return new SupabaseOperatorAuth(supabaseUrl, publishableKey);
};
