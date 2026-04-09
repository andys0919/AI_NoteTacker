export type OperatorCloudQuotaOverride = {
  submitterId: string;
  dailyQuotaUsd: number;
  updatedAt: string;
  updatedBy?: string;
};

export interface OperatorCloudQuotaOverrideRepository {
  getBySubmitterId(submitterId: string): Promise<OperatorCloudQuotaOverride | undefined>;
  listAll(): Promise<OperatorCloudQuotaOverride[]>;
  upsert(input: {
    submitterId: string;
    dailyQuotaUsd: number;
    updatedBy?: string;
  }): Promise<OperatorCloudQuotaOverride>;
}
