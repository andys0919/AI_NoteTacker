import type {
  CloudUsageCostSummary,
  CloudUsageLedgerEntry,
  CloudUsageLedgerEntryInput,
  CloudUsageLedgerRepository,
  ProviderRequestAudit,
  ProviderRequestFinishInput,
  ProviderRequestStartInput
} from '../domain/cloud-usage-ledger-repository.js';
import {
  CloudUsageLedgerConflictError,
  isSameCloudUsageLedgerPayload,
  isSameProviderRequestFinish,
  isSameProviderRequestStart,
  ProviderRequestAuditConflictError
} from '../domain/cloud-usage-ledger-repository.js';
import { summarizeActualCostsByJobIds } from '../domain/cloud-usage.js';

const now = (): string => new Date().toISOString();
const nextId = (): string => `usage_${crypto.randomUUID().replace(/-/g, '')}`;

export class InMemoryCloudUsageLedgerRepository implements CloudUsageLedgerRepository {
  private readonly entries: CloudUsageLedgerEntry[] = [];
  private readonly providerRequests: ProviderRequestAudit[] = [];

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

  async listProviderRequestsByQuotaDayKey(
    quotaDayKey: string
  ): Promise<ProviderRequestAudit[]> {
    return this.providerRequests.filter((request) => request.quotaDayKey === quotaDayKey);
  }

  async startProviderRequest(input: ProviderRequestStartInput): Promise<ProviderRequestAudit> {
    const existing = this.providerRequests.find((request) => request.requestId === input.requestId);
    if (existing) {
      if (isSameProviderRequestStart(existing, input)) {
        return existing;
      }
      throw new ProviderRequestAuditConflictError(input.requestId);
    }

    const request: ProviderRequestAudit = {
      ...input,
      status: 'started',
      pricingStatus: input.billingClass === 'metered-api' ? 'pending' : 'not-applicable',
      knownCostUsd: 0,
      costUsd: null
    };
    this.providerRequests.push(request);
    return request;
  }

  async finishProviderRequest(input: ProviderRequestFinishInput): Promise<ProviderRequestAudit> {
    const index = this.providerRequests.findIndex(
      (request) => request.requestId === input.requestId
    );
    const existing = this.providerRequests[index];
    if (!existing) {
      throw new Error(`Provider request audit not found: ${input.requestId}`);
    }
    if (existing.status !== 'started') {
      if (isSameProviderRequestFinish(existing, input)) {
        return existing;
      }
      throw new ProviderRequestAuditConflictError(input.requestId);
    }

    const finished: ProviderRequestAudit = { ...existing, ...input };
    this.providerRequests[index] = finished;
    return finished;
  }

  async getProviderRequest(requestId: string): Promise<ProviderRequestAudit | undefined> {
    return this.providerRequests.find((request) => request.requestId === requestId);
  }

  async listProviderRequestsByJob(jobId: string): Promise<ProviderRequestAudit[]> {
    return this.providerRequests.filter((request) => request.jobId === jobId);
  }

  async listProviderRequestsBySubmitterAndDay(
    submitterId: string,
    quotaDayKey: string
  ): Promise<ProviderRequestAudit[]> {
    return this.providerRequests.filter(
      (request) => request.submitterId === submitterId && request.quotaDayKey === quotaDayKey
    );
  }

  async listRecentProviderRequests(limit: number): Promise<ProviderRequestAudit[]> {
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : this.providerRequests.length;
    return [...this.providerRequests]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, safeLimit);
  }

  async summarizeActualCostByJobIds(
    jobIds: string[]
  ): Promise<Record<string, CloudUsageCostSummary>> {
    return summarizeActualCostsByJobIds(this.entries, jobIds, this.providerRequests);
  }
}
