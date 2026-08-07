import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  calculateAzureResponsesCost,
  calculateAzureResponsesKnownCost,
  calculateAzureTranscriptionActualCost
} from '../domain/cloud-usage.js';
import type {
  ProviderRequestAudit,
  ProviderRequestFinishInput
} from '../domain/cloud-usage-ledger-repository.js';

export const providerRequestIdSchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/);

export const providerRequestAuditIdsSchema = z
  .array(providerRequestIdSchema)
  .refine((requestIds) => new Set(requestIds).size === requestIds.length, {
    message: 'Provider request audit IDs must be unique.'
  });

const providerRequestProviderSchema = z.enum([
  'qwen3-asr-1.7b',
  'azure-speech-mai-transcribe-1.5',
  'azure-openai-gpt-4o-transcribe',
  'local-codex',
  'azure-openai'
]);

export const providerRequestStartSchema = z.object({
  stage: z.enum(['transcription', 'summary']),
  leaseToken: z.string().min(1),
  provider: providerRequestProviderSchema,
  model: z.string().trim().min(1).max(120),
  operation: z.string().trim().min(1).max(120).optional(),
  audioMs: z.number().int().nonnegative().optional()
});

const providerRequestUsageSchema = z
  .object({
    audioMs: z.number().int().nonnegative().optional(),
    billedAudioMs: z.number().int().nonnegative().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    cacheWriteInputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    reasoningOutputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional()
  })
  .superRefine((usage, context) => {
    const tokenValues = [
      usage.inputTokens,
      usage.cachedInputTokens,
      usage.outputTokens,
      usage.totalTokens
    ];
    if (
      tokenValues.some((value) => value !== undefined) &&
      tokenValues.some((value) => value === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['totalTokens'],
        message: 'Input, cached input, output, and total tokens must be reported together.'
      });
      return;
    }
    if (
      usage.inputTokens !== undefined &&
      usage.cachedInputTokens !== undefined &&
      usage.outputTokens !== undefined &&
      usage.totalTokens !== undefined
    ) {
      if (
        usage.cachedInputTokens + (usage.cacheWriteInputTokens ?? 0) >
        usage.inputTokens
      ) {
        context.addIssue({
          code: 'custom',
          path: ['cachedInputTokens'],
          message: 'Cached and cache-write input tokens cannot exceed input tokens.'
        });
      }
      if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
        context.addIssue({
          code: 'custom',
          path: ['totalTokens'],
          message: 'Total tokens must equal input tokens plus output tokens.'
        });
      }
      if ((usage.reasoningOutputTokens ?? 0) > usage.outputTokens) {
        context.addIssue({
          code: 'custom',
          path: ['reasoningOutputTokens'],
          message: 'Reasoning output tokens cannot exceed output tokens.'
        });
      }
    }
  });

export const providerRequestFinishSchema = z.object({
  leaseToken: z.string().min(1),
  status: z.enum(['succeeded', 'failed']),
  providerRequestId: z.string().trim().min(1).max(500).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  errorCode: z.string().trim().min(1).max(200).optional(),
  usage: providerRequestUsageSchema.optional()
});

export const hashLeaseToken = (leaseToken: string): string =>
  createHash('sha256').update(leaseToken).digest('hex');

export const providerRequestBillingClass = (
  provider: z.infer<typeof providerRequestProviderSchema>
): ProviderRequestAudit['billingClass'] =>
  provider === 'local-codex'
    ? 'subscription'
    : provider === 'qwen3-asr-1.7b'
      ? 'self-hosted'
      : 'metered-api';

export const toProviderRequestApi = (request: ProviderRequestAudit) => ({
  requestId: request.requestId,
  jobId: request.jobId,
  submitterId: request.submitterId,
  quotaDayKey: request.quotaDayKey,
  stage: request.stage,
  provider: request.provider,
  model: request.model,
  pricingVersion: request.pricingVersion,
  billingClass: request.billingClass,
  status: request.status,
  providerRequestId: request.providerRequestId,
  httpStatus: request.httpStatus,
  errorCode: request.errorCode,
  usageQuantity: request.usageQuantity,
  usageUnit: request.usageUnit,
  pricingStatus: request.pricingStatus,
  knownCostUsd: request.knownCostUsd,
  costUsd: request.costUsd,
  detail: request.detail,
  startedAt: request.startedAt,
  finishedAt: request.finishedAt
});

export const settleProviderRequest = (
  request: ProviderRequestAudit,
  input: z.infer<typeof providerRequestFinishSchema>,
  finishedAt: string
): ProviderRequestFinishInput => {
  const usage = input.usage;
  const detail = { ...(request.detail ?? {}), ...(usage ?? {}) };
  const base = {
    requestId: request.requestId,
    status: input.status,
    providerRequestId: input.providerRequestId,
    httpStatus: input.httpStatus,
    errorCode: input.errorCode,
    detail: Object.keys(detail).length > 0 ? detail : undefined,
    finishedAt
  };

  if (request.billingClass !== 'metered-api') {
    const usageQuantity = usage?.totalTokens ?? usage?.billedAudioMs ?? usage?.audioMs;
    return {
      ...base,
      usageQuantity,
      usageUnit:
        usageQuantity === undefined
          ? undefined
          : usage?.totalTokens === undefined
            ? 'audio-ms'
            : 'tokens',
      pricingStatus: 'not-applicable',
      knownCostUsd: 0,
      costUsd: null
    };
  }

  if (request.provider === 'azure-speech-mai-transcribe-1.5') {
    const billedAudioMs = usage?.billedAudioMs;
    const pricing =
      input.status === 'succeeded' && billedAudioMs !== undefined
        ? calculateAzureTranscriptionActualCost({
            audioMs: billedAudioMs,
            provider: request.provider,
            model: request.model,
            pricingVersion: request.pricingVersion
          })
        : ({ costUsd: null, pricingStatus: 'unpriced' } as const);

    return {
      ...base,
      usageQuantity: billedAudioMs ?? usage?.audioMs,
      usageUnit: 'audio-ms',
      pricingStatus: pricing.pricingStatus,
      knownCostUsd: pricing.costUsd ?? 0,
      costUsd: pricing.costUsd
    };
  }

  if (
    request.provider === 'azure-openai' &&
    usage?.inputTokens !== undefined &&
    usage.cachedInputTokens !== undefined &&
    usage.outputTokens !== undefined
  ) {
    const knownCostUsd =
      calculateAzureResponsesKnownCost({
        model: request.model,
        pricingVersion: request.pricingVersion,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens
      }) ?? 0;
    const pricing = calculateAzureResponsesCost({
      model: request.model,
      pricingVersion: request.pricingVersion,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteInputTokens,
      outputTokens: usage.outputTokens,
      reasoningOutputTokens: usage.reasoningOutputTokens
    });

    return {
      ...base,
      usageQuantity: usage.totalTokens,
      usageUnit: 'tokens',
      pricingStatus: pricing.pricingStatus,
      knownCostUsd: pricing.costUsd ?? knownCostUsd,
      costUsd: pricing.costUsd
    };
  }

  return {
    ...base,
    usageQuantity: usage?.audioMs,
    usageUnit: 'audio-ms',
    pricingStatus: 'unpriced',
    knownCostUsd: 0,
    costUsd: null
  };
};
