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
  azureOpenAiSummaryEndpoint?: string;
  azureOpenAiSummaryApiKey?: string;
};

const hasValue = (value: string | undefined): boolean => (value ?? '').trim().length > 0;

const isResponsesEndpoint = (value: string | undefined): boolean => {
  if (!hasValue(value)) {
    return false;
  }

  try {
    const endpoint = new URL(value ?? '');
    return (
      endpoint.protocol === 'https:' &&
      endpoint.pathname.replace(/\/+$/, '') === '/openai/v1/responses'
    );
  } catch {
    return false;
  }
};

export const createSummaryProviderCatalog = (
  input: CatalogInput = {}
): SummaryProviderCatalog => {
  const azureReady =
    isResponsesEndpoint(input.azureOpenAiSummaryEndpoint) &&
    hasValue(input.azureOpenAiSummaryApiKey);

  const options: SummaryProviderOption[] = [
    {
      value: 'local-codex',
      label: getSummaryProviderLabel('local-codex'),
      ready: true
    },
    {
      value: 'azure-openai',
      label: getSummaryProviderLabel('azure-openai'),
      ready: azureReady,
      reason: azureReady
        ? undefined
        : 'AZURE_OPENAI_SUMMARY_ENDPOINT must target /openai/v1/responses and AZURE_OPENAI_SUMMARY_API_KEY is required.'
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
    azureOpenAiSummaryEndpoint: environment.AZURE_OPENAI_SUMMARY_ENDPOINT,
    azureOpenAiSummaryApiKey: environment.AZURE_OPENAI_SUMMARY_API_KEY
  });
