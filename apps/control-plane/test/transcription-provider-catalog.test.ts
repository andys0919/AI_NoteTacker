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
      azureOpenAiDeployment: 'gpt-4o-mini-transcribe',
      azureOpenAiApiKey: 'secret'
    });

    expect(catalog.defaultProvider).toBe('azure-openai-gpt-4o-mini-transcribe');
  });
});
