import type {
  CloudUsageCostSummary,
  CloudUsageLedgerEntry,
  CloudUsageLedgerEntryInput,
  CloudUsageLedgerRepository
} from '../domain/cloud-usage-ledger-repository.js';
import {
  CloudUsageLedgerConflictError,
  isSameCloudUsageLedgerPayload
} from '../domain/cloud-usage-ledger-repository.js';
import { summarizeActualCostsByJobIds } from '../domain/cloud-usage.js';

const now = (): string => new Date().toISOString();
const nextId = (): string => `usage_${crypto.randomUUID().replace(/-/g, '')}`;

export class InMemoryCloudUsageLedgerRepository implements CloudUsageLedgerRepository {
  private readonly entries: CloudUsageLedgerEntry[] = [];

  async append(input: CloudUsageLedgerEntryInput): Promise<CloudUsageLedgerEntry> {
    if (input.entryKey) {
      const existing = this.entries.find((entry) => entry.entryKey === input.entryKey);

      if (existing) {
        if (isSameCloudUsageLedgerPayload(existing, input)) {
          return existing;
        }

        throw new CloudUsageLedgerConflictError(input.entryKey);
      }
    }

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

  async listRecentEntries(limit: number): Promise<CloudUsageLedgerEntry[]> {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : this.entries.length;

    return [...this.entries]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, safeLimit);
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

  async summarizeActualCostByJobIds(
    jobIds: string[]
  ): Promise<Record<string, CloudUsageCostSummary>> {
    return summarizeActualCostsByJobIds(this.entries, jobIds);
  }
}
