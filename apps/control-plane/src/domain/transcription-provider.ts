export const transcriptionProviders = [
  'self-hosted-whisper',
  'qwen3-asr-1.7b',
  'azure-speech-mai-transcribe-1.5',
  'azure-openai-gpt-4o-transcribe'
] as const;

export type TranscriptionProvider = (typeof transcriptionProviders)[number];

export const defaultTranscriptionProvider: TranscriptionProvider = 'self-hosted-whisper';

export const isCloudTranscriptionProvider = (provider: TranscriptionProvider): boolean =>
  provider === 'azure-openai-gpt-4o-transcribe' ||
  provider === 'azure-speech-mai-transcribe-1.5';

export const getTranscriptionProviderLabel = (provider: TranscriptionProvider): string =>
  provider === 'self-hosted-whisper'
    ? 'Self-hosted Whisper'
    : provider === 'qwen3-asr-1.7b'
      ? 'Qwen3-ASR 1.7B'
      : provider === 'azure-speech-mai-transcribe-1.5'
        ? 'Azure Speech MAI-Transcribe 1.5'
        : 'Azure OpenAI gpt-4o-transcribe';
