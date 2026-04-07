import type { AuthenticatedUser } from '../../domain/authenticated-user.js';
import type { AuthenticatedUserRepository } from '../../domain/authenticated-user-repository.js';

type Queryable = {
  query: <TRow extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
};

type AuthenticatedUserRow = {
  id: string;
  email: string;
  created_at: Date | string;
  updated_at: Date | string;
};

const authenticatedUserSchemaSql = `
  CREATE TABLE IF NOT EXISTS authenticated_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
`;

const toIsoString = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const mapRowToAuthenticatedUser = (row: AuthenticatedUserRow): AuthenticatedUser => ({
  id: row.id,
  email: row.email,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

export const ensureAuthenticatedUserSchema = async (database: Queryable): Promise<void> => {
  await database.query(authenticatedUserSchemaSql);
};

export class PostgresAuthenticatedUserRepository implements AuthenticatedUserRepository {
  constructor(private readonly database: Queryable) {}

  async upsert(user: { id: string; email: string }): Promise<AuthenticatedUser> {
    const result = await this.database.query<AuthenticatedUserRow>(
      `
        INSERT INTO authenticated_users (
          id,
          email,
          created_at,
          updated_at
        )
        VALUES ($1, $2, now(), now())
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          updated_at = now()
        RETURNING *
      `,
      [user.id, user.email]
    );

    return mapRowToAuthenticatedUser(result.rows[0]);
  }

  async getById(id: string): Promise<AuthenticatedUser | undefined> {
    const result = await this.database.query<AuthenticatedUserRow>(
      `
        SELECT *
        FROM authenticated_users
        WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    return mapRowToAuthenticatedUser(result.rows[0]);
  }
}
