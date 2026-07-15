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
import { roundUsd } from '../domain/cloud-usage.js';

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
    const summaries: Record<string, CloudUsageCostSummary> = {};
    const jobIdSet = new Set(jobIds);

    for (const entry of this.entries) {
      if (entry.entryType !== 'actual' || !jobIdSet.has(entry.jobId)) {
        continue;
      }

      const current = summaries[entry.jobId] ?? {
        actualTranscriptionCostUsd: 0,
        hasUnpricedTranscriptionUsage: false,
        actualPunctuationCostUsd: 0,
        hasUnpricedPunctuationUsage: false,
        actualSummaryCostUsd: 0,
        hasUnpricedSummaryUsage: false,
        actualCloudCostUsd: 0,
        hasUnpricedUsage: false
      };

      if (entry.stage === 'transcription') {
        if (entry.pricingStatus === 'priced') {
          current.actualTranscriptionCostUsd = roundUsd(
            current.actualTranscriptionCostUsd + entry.costUsd
          );
        } else {
          current.hasUnpricedTranscriptionUsage = true;
        }
      }

      if (entry.stage === 'punctuation') {
        if (entry.pricingStatus === 'priced') {
          current.actualPunctuationCostUsd = roundUsd(
            current.actualPunctuationCostUsd + entry.costUsd
          );
        } else {
          current.hasUnpricedPunctuationUsage = true;
        }
      }

      if (entry.stage === 'summary') {
        if (entry.pricingStatus === 'priced') {
          current.actualSummaryCostUsd = roundUsd(current.actualSummaryCostUsd + entry.costUsd);
        } else {
          current.hasUnpricedSummaryUsage = true;
        }
      }

      current.hasUnpricedUsage =
        current.hasUnpricedTranscriptionUsage ||
        current.hasUnpricedPunctuationUsage ||
        current.hasUnpricedSummaryUsage;
      current.actualCloudCostUsd = current.hasUnpricedUsage
        ? null
        : roundUsd(
            current.actualTranscriptionCostUsd +
              current.actualPunctuationCostUsd +
              current.actualSummaryCostUsd
          );
      summaries[entry.jobId] = current;
    }

    return summaries;
  }
}
