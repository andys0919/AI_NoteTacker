export type AdminAuditLogEntry = {
  id: string;
  actorId: string;
  actorEmail?: string;
  action: string;
  target: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  createdAt: string;
};

export interface AdminAuditLogRepository {
  append(input: Omit<AdminAuditLogEntry, 'id' | 'createdAt'>): Promise<AdminAuditLogEntry>;
  listRecent(limit: number): Promise<AdminAuditLogEntry[]>;
}
