import type { AdminAuditLogEntry, AdminAuditLogRepository } from '../../domain/admin-audit-log-repository.js';

type Queryable = {
  query: <TRow extends Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: TRow[] }>;
};

type AuditRow = {
  id: string;
  actor_id: string;
  actor_email: string | null;
  action: string;
  target: string;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  created_at: Date | string;
};

const schemaSql = `
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    actor_email TEXT,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    before_value JSONB,
    after_value JSONB,
    created_at TIMESTAMPTZ NOT NULL
  );
`;

const nextId = (): string => `audit_${crypto.randomUUID().replace(/-/g, '')}`;
const now = (): string => new Date().toISOString();

const mapRow = (row: AuditRow): AdminAuditLogEntry => ({
  id: row.id,
  actorId: row.actor_id,
  actorEmail: row.actor_email ?? undefined,
  action: row.action,
  target: row.target,
  before: row.before_value ?? undefined,
  after: row.after_value ?? undefined,
  createdAt:
    row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString()
});

export const ensureAdminAuditLogSchema = async (database: Queryable): Promise<void> => {
  await database.query(schemaSql);
};

export class PostgresAdminAuditLogRepository implements AdminAuditLogRepository {
  constructor(private readonly database: Queryable) {}

  async append(input: Omit<AdminAuditLogEntry, 'id' | 'createdAt'>): Promise<AdminAuditLogEntry> {
    const result = await this.database.query<AuditRow>(
      `
        INSERT INTO admin_audit_log (
          id,
          actor_id,
          actor_email,
          action,
          target,
          before_value,
          after_value,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz)
        RETURNING *
      `,
      [
        nextId(),
        input.actorId,
        input.actorEmail ?? null,
        input.action,
        input.target,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        now()
      ]
    );

    return mapRow(result.rows[0]);
  }

  async listRecent(limit: number): Promise<AdminAuditLogEntry[]> {
    const result = await this.database.query<AuditRow>(
      `
        SELECT *
        FROM admin_audit_log
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return result.rows.map(mapRow);
  }
}
