import type {
  OperatorCloudQuotaOverride,
  OperatorCloudQuotaOverrideRepository
} from '../domain/operator-cloud-quota-override-repository.js';

const now = (): string => new Date().toISOString();

export class InMemoryOperatorCloudQuotaOverrideRepository
  implements OperatorCloudQuotaOverrideRepository
{
  private readonly overrides = new Map<string, OperatorCloudQuotaOverride>();

  async getBySubmitterId(
    submitterId: string
  ): Promise<OperatorCloudQuotaOverride | undefined> {
    return this.overrides.get(submitterId);
  }

  async listAll(): Promise<OperatorCloudQuotaOverride[]> {
    return [...this.overrides.values()].sort((left, right) =>
      left.submitterId.localeCompare(right.submitterId)
    );
  }

  async upsert(input: {
    submitterId: string;
    dailyQuotaUsd: number;
    updatedBy?: string;
  }): Promise<OperatorCloudQuotaOverride> {
    const saved: OperatorCloudQuotaOverride = {
      submitterId: input.submitterId,
      dailyQuotaUsd: input.dailyQuotaUsd,
      updatedAt: now(),
      updatedBy: input.updatedBy
    };

    this.overrides.set(saved.submitterId, saved);
    return saved;
  }
}
