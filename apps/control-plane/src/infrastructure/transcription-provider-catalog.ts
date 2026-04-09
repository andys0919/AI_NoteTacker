import {
  defaultTranscriptionProvider,
  getTranscriptionProviderLabel,
  type TranscriptionProvider
} from '../domain/transcription-provider.js';

export type TranscriptionProviderOption = {
  value: TranscriptionProvider;
  label: string;
  ready: boolean;
  reason?: string;
};

export type TranscriptionProviderCatalog = {
  defaultProvider: TranscriptionProvider;
  options: TranscriptionProviderOption[];
  isReady(provider: TranscriptionProvider): boolean;
  readinessReason(provider: TranscriptionProvider): string | undefined;
};

type CatalogInput = {
  deploymentMode?: string;
  whisperModel?: string;
  defaultProvider?: string;
  azureOpenAiEndpoint?: string;
  azureOpenAiDeployment?: string;
  azureOpenAiApiKey?: string;
};

const hasValue = (value: string | undefined): boolean => (value ?? '').trim().length > 0;

export const createTranscriptionProviderCatalog = (
  input: CatalogInput = {}
): TranscriptionProviderCatalog => {
  const localReady = hasValue(input.whisperModel);
  const azureReady =
    hasValue(input.azureOpenAiEndpoint) &&
    hasValue(input.azureOpenAiDeployment) &&
    hasValue(input.azureOpenAiApiKey);
  const deploymentMode = (input.deploymentMode ?? '').trim().toLowerCase();

  const options: TranscriptionProviderOption[] = [
    {
      value: 'self-hosted-whisper',
      label: getTranscriptionProviderLabel('self-hosted-whisper'),
      ready: localReady,
      reason: localReady ? undefined : 'WHISPER_MODEL is not configured.'
    },
    {
      value: 'azure-openai-gpt-4o-mini-transcribe',
      label: getTranscriptionProviderLabel('azure-openai-gpt-4o-mini-transcribe'),
      ready: azureReady,
      reason: azureReady
        ? undefined
        : 'AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, and AZURE_OPENAI_API_KEY are required.'
    }
  ];

  return {
    defaultProvider:
      input.defaultProvider === 'azure-openai-gpt-4o-mini-transcribe' ||
      (deploymentMode === 'cloud' && azureReady)
        ? 'azure-openai-gpt-4o-mini-transcribe'
        : defaultTranscriptionProvider,
    options,
    isReady(provider: TranscriptionProvider): boolean {
      return options.find((option) => option.value === provider)?.ready ?? false;
    },
    readinessReason(provider: TranscriptionProvider): string | undefined {
      return options.find((option) => option.value === provider)?.reason;
    }
  };
};

export const createTranscriptionProviderCatalogFromEnvironment = (
  environment: NodeJS.ProcessEnv = process.env
): TranscriptionProviderCatalog =>
  createTranscriptionProviderCatalog({
    deploymentMode: environment.DEPLOYMENT_MODE,
    whisperModel: environment.WHISPER_MODEL,
    defaultProvider: environment.DEFAULT_TRANSCRIPTION_PROVIDER,
    azureOpenAiEndpoint: environment.AZURE_OPENAI_ENDPOINT,
    azureOpenAiDeployment: environment.AZURE_OPENAI_DEPLOYMENT,
    azureOpenAiApiKey: environment.AZURE_OPENAI_API_KEY
  });
