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
  qwenAsrEndpoint?: string;
  qwenAsrModel?: string;
  azureSpeechMaiEndpoint?: string;
  azureSpeechMaiModel?: string;
  azureSpeechMaiApiKey?: string;
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
  const qwenReady = hasValue(input.qwenAsrEndpoint) && hasValue(input.qwenAsrModel);
  const maiReady =
    hasValue(input.azureSpeechMaiEndpoint) &&
    hasValue(input.azureSpeechMaiModel) &&
    hasValue(input.azureSpeechMaiApiKey);
  const deploymentMode = (input.deploymentMode ?? '').trim().toLowerCase();

  const options: TranscriptionProviderOption[] = [
    {
      value: 'self-hosted-whisper',
      label: getTranscriptionProviderLabel('self-hosted-whisper'),
      ready: localReady,
      reason: localReady ? undefined : 'WHISPER_MODEL is not configured.'
    },
    {
      value: 'qwen3-asr-1.7b',
      label: getTranscriptionProviderLabel('qwen3-asr-1.7b'),
      ready: qwenReady,
      reason: qwenReady
        ? undefined
        : 'QWEN_ASR_ENDPOINT and QWEN_ASR_MODEL are required.'
    },
    {
      value: 'azure-speech-mai-transcribe-1.5',
      label: getTranscriptionProviderLabel('azure-speech-mai-transcribe-1.5'),
      ready: maiReady,
      reason: maiReady
        ? undefined
        : 'AZURE_SPEECH_MAI_ENDPOINT, AZURE_SPEECH_MAI_MODEL, and AZURE_SPEECH_MAI_API_KEY are required.'
    },
    {
      value: 'azure-openai-gpt-4o-transcribe',
      label: getTranscriptionProviderLabel('azure-openai-gpt-4o-transcribe'),
      ready: azureReady,
      reason: azureReady
        ? undefined
        : 'AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, and AZURE_OPENAI_API_KEY are required.'
    }
  ];

  return {
    defaultProvider:
      input.defaultProvider === 'azure-speech-mai-transcribe-1.5'
        ? 'azure-speech-mai-transcribe-1.5'
        : input.defaultProvider === 'qwen3-asr-1.7b'
          ? 'qwen3-asr-1.7b'
          : input.defaultProvider === 'azure-openai-gpt-4o-transcribe' ||
              (deploymentMode === 'cloud' && azureReady)
            ? 'azure-openai-gpt-4o-transcribe'
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
    azureOpenAiApiKey: environment.AZURE_OPENAI_API_KEY,
    qwenAsrEndpoint: environment.QWEN_ASR_ENDPOINT,
    qwenAsrModel: environment.QWEN_ASR_MODEL,
    azureSpeechMaiEndpoint: environment.AZURE_SPEECH_MAI_ENDPOINT,
    azureSpeechMaiModel: environment.AZURE_SPEECH_MAI_MODEL,
    azureSpeechMaiApiKey: environment.AZURE_SPEECH_MAI_API_KEY
  });
