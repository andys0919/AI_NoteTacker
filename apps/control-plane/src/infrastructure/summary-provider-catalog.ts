import {
  defaultSummaryProvider,
  getSummaryProviderLabel,
  type SummaryProvider
} from '../domain/summary-provider.js';

export type SummaryProviderOption = {
  value: SummaryProvider;
  label: string;
  ready: boolean;
  reason?: string;
};

export type SummaryProviderCatalog = {
  defaultProvider: SummaryProvider;
  options: SummaryProviderOption[];
  isReady(provider: SummaryProvider): boolean;
  readinessReason(provider: SummaryProvider): string | undefined;
};

export const createSummaryProviderCatalog = (): SummaryProviderCatalog => {
  const options: SummaryProviderOption[] = [
    {
      value: 'local-codex',
      label: getSummaryProviderLabel('local-codex'),
      ready: true
    }
  ];

  return {
    defaultProvider: defaultSummaryProvider,
    options,
    isReady(provider: SummaryProvider): boolean {
      return provider === defaultSummaryProvider;
    },
    readinessReason(provider: SummaryProvider): string | undefined {
      return provider === defaultSummaryProvider
        ? undefined
        : 'Azure OpenAI summaries are retired; use Local Codex.';
    }
  };
};

export const createSummaryProviderCatalogFromEnvironment = (): SummaryProviderCatalog =>
  createSummaryProviderCatalog();
