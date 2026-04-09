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

type CatalogInput = {
  defaultProvider?: string;
  summaryEnabled?: boolean;
  azureOpenAiSummaryEndpoint?: string;
  azureOpenAiSummaryApiKey?: string;
};

const hasValue = (value: string | undefined): boolean => (value ?? '').trim().length > 0;

export const createSummaryProviderCatalog = (
  input: CatalogInput = {}
): SummaryProviderCatalog => {
  const localReady = input.summaryEnabled ?? true;
  const azureReady =
    hasValue(input.azureOpenAiSummaryEndpoint) && hasValue(input.azureOpenAiSummaryApiKey);

  const options: SummaryProviderOption[] = [
    {
      value: 'local-codex',
      label: getSummaryProviderLabel('local-codex'),
      ready: localReady,
      reason: localReady ? undefined : 'SUMMARY_ENABLED must be true.'
    },
    {
      value: 'azure-openai',
      label: getSummaryProviderLabel('azure-openai'),
      ready: azureReady,
      reason: azureReady
        ? undefined
        : 'AZURE_OPENAI_SUMMARY_ENDPOINT and AZURE_OPENAI_SUMMARY_API_KEY are required.'
    }
  ];

  return {
    defaultProvider:
      input.defaultProvider === 'azure-openai' && azureReady
        ? 'azure-openai'
        : defaultSummaryProvider,
    options,
    isReady(provider: SummaryProvider): boolean {
      return options.find((option) => option.value === provider)?.ready ?? false;
    },
    readinessReason(provider: SummaryProvider): string | undefined {
      return options.find((option) => option.value === provider)?.reason;
    }
  };
};

export const createSummaryProviderCatalogFromEnvironment = (
  environment: NodeJS.ProcessEnv = process.env
): SummaryProviderCatalog =>
  createSummaryProviderCatalog({
    defaultProvider: environment.DEFAULT_SUMMARY_PROVIDER,
    summaryEnabled: (environment.SUMMARY_ENABLED ?? 'true').toLowerCase() === 'true',
    azureOpenAiSummaryEndpoint:
      environment.AZURE_OPENAI_SUMMARY_ENDPOINT ||
      (environment.AZURE_OPENAI_ENDPOINT
        ? `${environment.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '')}/openai/v1/chat/completions`
        : undefined),
    azureOpenAiSummaryApiKey:
      environment.AZURE_OPENAI_SUMMARY_API_KEY || environment.AZURE_OPENAI_API_KEY
  });
