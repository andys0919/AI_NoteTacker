import type {
  CloudUsageLedgerEntry,
  CloudUsageLedgerRepository
} from '../domain/cloud-usage-ledger-repository.js';

const now = (): string => new Date().toISOString();
const nextId = (): string => `usage_${crypto.randomUUID().replace(/-/g, '')}`;

export class InMemoryCloudUsageLedgerRepository implements CloudUsageLedgerRepository {
  private readonly entries: CloudUsageLedgerEntry[] = [];

  async append(
    input: Omit<CloudUsageLedgerEntry, 'id' | 'createdAt'>
  ): Promise<CloudUsageLedgerEntry> {
    const entry: CloudUsageLedgerEntry = {
      ...input,
      id: nextId(),
      createdAt: now()
    };

    this.entries.push(entry);
    return entry;
  }

  async listByQuotaDayKey(quotaDayKey: string): Promise<CloudUsageLedgerEntry[]> {
    return this.entries.filter((entry) => entry.quotaDayKey === quotaDayKey);
  }

  async listBySubmitterAndDay(
    submitterId: string,
    quotaDayKey: string
  ): Promise<CloudUsageLedgerEntry[]> {
    return this.entries.filter(
      (entry) => entry.submitterId === submitterId && entry.quotaDayKey === quotaDayKey
    );
  }

  async listByJob(jobId: string): Promise<CloudUsageLedgerEntry[]> {
    return this.entries.filter((entry) => entry.jobId === jobId);
  }
}
