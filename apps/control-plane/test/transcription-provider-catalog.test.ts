import { describe, expect, it } from 'vitest';

import { createTranscriptionProviderCatalog } from '../src/infrastructure/transcription-provider-catalog.js';

describe('transcription provider catalog deployment defaults', () => {
  it('defaults local deployments to self-hosted whisper', () => {
    const catalog = createTranscriptionProviderCatalog({
      deploymentMode: 'local',
      whisperModel: 'large-v3'
    });

    expect(catalog.defaultProvider).toBe('self-hosted-whisper');
  });

  it('defaults cloud deployments to Azure OpenAI when Azure is configured', () => {
    const catalog = createTranscriptionProviderCatalog({
      deploymentMode: 'cloud',
      whisperModel: 'large-v3',
      azureOpenAiEndpoint: 'https://azure.example.test',
      azureOpenAiDeployment: 'gpt-4o-transcribe',
      azureOpenAiApiKey: 'secret'
    });

    expect(catalog.defaultProvider).toBe('azure-openai-gpt-4o-transcribe');
  });

  it('uses an explicitly configured ready Qwen default', () => {
    const catalog = createTranscriptionProviderCatalog({
      deploymentMode: 'cloud',
      whisperModel: 'large-v3',
      defaultProvider: 'qwen3-asr-1.7b',
      qwenAsrEndpoint: 'http://qwen3-asr:8000',
      qwenAsrModel: 'qwen3-asr-1.7b'
    });

    expect(catalog.defaultProvider).toBe('qwen3-asr-1.7b');
    expect(catalog.isReady('qwen3-asr-1.7b')).toBe(true);
  });

  it('uses an explicitly configured ready MAI default', () => {
    const catalog = createTranscriptionProviderCatalog({
      deploymentMode: 'cloud',
      whisperModel: 'large-v3',
      defaultProvider: 'azure-speech-mai-transcribe-1.5',
      azureSpeechMaiEndpoint: 'https://speech.example.test',
      azureSpeechMaiModel: 'mai-transcribe-1.5',
      azureSpeechMaiApiKey: 'secret'
    });

    expect(catalog.defaultProvider).toBe('azure-speech-mai-transcribe-1.5');
    expect(catalog.isReady('azure-speech-mai-transcribe-1.5')).toBe(true);
  });
});
