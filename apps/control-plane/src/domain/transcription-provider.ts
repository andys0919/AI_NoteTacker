export const transcriptionProviders = [
  'self-hosted-whisper',
  'azure-openai-gpt-4o-mini-transcribe'
] as const;

export type TranscriptionProvider = (typeof transcriptionProviders)[number];

export const defaultTranscriptionProvider: TranscriptionProvider = 'self-hosted-whisper';

export const isTranscriptionProvider = (value: string): value is TranscriptionProvider =>
  transcriptionProviders.includes(value as TranscriptionProvider);

export const isCloudTranscriptionProvider = (provider: TranscriptionProvider): boolean =>
  provider === 'azure-openai-gpt-4o-mini-transcribe';

export const getTranscriptionProviderLabel = (provider: TranscriptionProvider): string =>
  provider === 'self-hosted-whisper'
    ? 'Self-hosted Whisper'
    : 'Azure OpenAI gpt-4o-mini-transcribe';
