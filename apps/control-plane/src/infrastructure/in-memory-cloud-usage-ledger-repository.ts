import type {
  CloudUsageCostSummary,
  CloudUsageLedgerEntry,
  CloudUsageLedgerRepository
} from '../domain/cloud-usage-ledger-repository.js';
import { roundUsd } from '../domain/cloud-usage.js';

const now = (): string => new Date().toISOString();
const nextId = (): string => `usage_${crypto.randomUUID().replace(/-/g, '')}`;

export class InMemoryCloudUsageLedgerRepository implements CloudUsageLedgerRepository {
  private readonly entries: CloudUsageLedgerEntry[] = [];

  async append(
    input: Omit<CloudUsageLedgerEntry, 'id' | 'createdAt'>
  ): Promise<CloudUsageLedgerEntry> {
    if (input.entryKey) {
      const existing = this.entries.find((entry) => entry.entryKey === input.entryKey);

      if (existing) {
        const updated = {
          ...existing,
          ...input
        };
        this.entries.splice(this.entries.indexOf(existing), 1, updated);
        return updated;
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
    const summaries: Record<string, CloudUsageCostSummary> = {};

    for (const entry of this.entries) {
      if (entry.entryType !== 'actual' || !jobIds.includes(entry.jobId)) {
        continue;
      }

      const current = summaries[entry.jobId] ?? {
        actualTranscriptionCostUsd: 0,
        actualSummaryCostUsd: 0,
        actualCloudCostUsd: 0
      };

      if (entry.stage === 'transcription') {
        current.actualTranscriptionCostUsd = roundUsd(
          current.actualTranscriptionCostUsd + entry.costUsd
        );
      }

      if (entry.stage === 'summary') {
        current.actualSummaryCostUsd = roundUsd(current.actualSummaryCostUsd + entry.costUsd);
      }

      current.actualCloudCostUsd = roundUsd(
        current.actualTranscriptionCostUsd + current.actualSummaryCostUsd
      );
      summaries[entry.jobId] = current;
    }

    return summaries;
  }
}
