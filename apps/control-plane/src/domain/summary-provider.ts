export const summaryProviders = ['local-codex', 'azure-openai'] as const;

export type SummaryProvider = (typeof summaryProviders)[number];

export const defaultSummaryProvider: SummaryProvider = 'local-codex';

export const isSummaryProvider = (value: string): value is SummaryProvider =>
  summaryProviders.includes(value as SummaryProvider);

export const isCloudSummaryProvider = (provider: SummaryProvider): boolean =>
  provider === 'azure-openai';

export const getSummaryProviderLabel = (provider: SummaryProvider): string =>
  provider === 'local-codex' ? 'Local Codex' : 'Azure OpenAI';
