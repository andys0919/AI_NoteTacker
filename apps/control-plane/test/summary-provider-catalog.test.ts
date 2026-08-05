import { describe, expect, it } from 'vitest';

import {
  createSummaryProviderCatalog,
  createSummaryProviderCatalogFromEnvironment
} from '../src/infrastructure/summary-provider-catalog.js';

describe('summary provider catalog', () => {
  it('defaults to local codex when azure summary is not configured', () => {
    const catalog = createSummaryProviderCatalog();

    expect(catalog.defaultProvider).toBe('local-codex');
    expect(catalog.isReady('local-codex')).toBe(true);
    expect(catalog.isReady('azure-openai')).toBe(false);
    expect(catalog.readinessReason('azure-openai')).toContain(
      'AZURE_OPENAI_SUMMARY_ENDPOINT'
    );
  });

  it('allows azure summary as the default when endpoint and api key exist', () => {
    const catalog = createSummaryProviderCatalog({
      defaultProvider: 'azure-openai',
      azureOpenAiSummaryEndpoint: 'https://azure.example.test/openai/v1/responses',
      azureOpenAiSummaryApiKey: 'secret'
    });

    expect(catalog.defaultProvider).toBe('azure-openai');
    expect(catalog.isReady('azure-openai')).toBe(true);
    expect(catalog.readinessReason('azure-openai')).toBeUndefined();
  });

  it('rejects a chat completions endpoint for the responses provider', () => {
    const catalog = createSummaryProviderCatalog({
      defaultProvider: 'azure-openai',
      azureOpenAiSummaryEndpoint: 'https://azure.example.test/openai/v1/chat/completions',
      azureOpenAiSummaryApiKey: 'secret'
    });

    expect(catalog.defaultProvider).toBe('local-codex');
    expect(catalog.isReady('azure-openai')).toBe(false);
    expect(catalog.readinessReason('azure-openai')).toContain('/openai/v1/responses');
  });

  it('rejects a non-https responses endpoint', () => {
    const catalog = createSummaryProviderCatalog({
      defaultProvider: 'azure-openai',
      azureOpenAiSummaryEndpoint: 'http://azure.example.test/openai/v1/responses',
      azureOpenAiSummaryApiKey: 'secret'
    });

    expect(catalog.isReady('azure-openai')).toBe(false);
  });

  it('does not reuse azure transcription credentials for summary readiness', () => {
    const catalog = createSummaryProviderCatalogFromEnvironment({
      DEFAULT_SUMMARY_PROVIDER: 'azure-openai',
      AZURE_OPENAI_ENDPOINT: 'https://azure.example.test/',
      AZURE_OPENAI_API_KEY: 'secret'
    });

    expect(catalog.defaultProvider).toBe('local-codex');
    expect(catalog.isReady('azure-openai')).toBe(false);
  });
});
