import type { AdminAuditLogEntry, AdminAuditLogRepository } from '../domain/admin-audit-log-repository.js';

const now = (): string => new Date().toISOString();
const nextId = (): string => `audit_${crypto.randomUUID().replace(/-/g, '')}`;

export class InMemoryAdminAuditLogRepository implements AdminAuditLogRepository {
  private readonly entries: AdminAuditLogEntry[] = [];

  async append(input: Omit<AdminAuditLogEntry, 'id' | 'createdAt'>): Promise<AdminAuditLogEntry> {
    const entry: AdminAuditLogEntry = {
      ...input,
      id: nextId(),
      createdAt: now()
    };

    this.entries.unshift(entry);
    return entry;
  }

  async listRecent(limit: number): Promise<AdminAuditLogEntry[]> {
    return this.entries.slice(0, limit);
  }
}
