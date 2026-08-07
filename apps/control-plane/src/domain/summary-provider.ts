export const summaryProviders = ['local-codex'] as const;

export type SummaryProvider = (typeof summaryProviders)[number] | 'azure-openai';

export const defaultSummaryProvider: SummaryProvider = 'local-codex';

export const isCloudSummaryProvider = (provider: SummaryProvider): boolean =>
  provider === 'azure-openai';

export const getSummaryProviderLabel = (provider: SummaryProvider): string =>
  provider === 'local-codex' ? 'Local Codex' : 'Azure OpenAI';
