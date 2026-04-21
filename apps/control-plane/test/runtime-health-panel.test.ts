import { describe, expect, it } from 'vitest';

import { getRuntimeHealthViewModel } from '../public/runtime-health-panel.js';

describe('runtime health panel helpers', () => {
  it('builds a compact admin runtime health view model', () => {
    const model = getRuntimeHealthViewModel({
      quotaDayKey: '2026-04-10',
      queues: {
        meeting: { active: 1, queued: 2, capacity: 1, saturated: true },
        transcription: { active: 1, queued: 0, capacity: 2, saturated: false },
        summary: { active: 0, queued: 1, capacity: 1, saturated: true }
      },
      leases: {
        active: [
          {
            jobId: 'job_lease',
            submitterId: 'operator-1',
            stage: 'summary',
            workerId: 'summary-worker',
            state: 'transcribing',
            processingStage: 'generating-summary',
            ageMs: 240000,
            heartbeatAgeMs: 15000,
            expiresInMs: 300000
          }
        ],
        oldestLeaseAgeMs: 240000,
        staleCount: 1,
        churnCount: 2
      },
      latency: {
        oldestActiveMs: 420000,
        averageTerminalMs: 180000,
        terminalSampleSize: 3
      },
      throughput: {
        uploadedToday: 7,
        completedToday: 4,
        completedUploadedToday: 3,
        completedMeetingToday: 1
      },
      failures: {
        failedToday: 2,
        terminalToday: 4,
        failureRate: 0.5,
        codes: [{ code: 'transcription-worker-stale', count: 2 }]
      },
      cleanup: {
        pendingJobs: 0,
        policyConfigured: false
      }
    });

    expect(model.summaryText).toContain('2026-04-10');
    expect(model.queueCards).toEqual([
      expect.objectContaining({
        label: '會議錄製',
        valueText: '1 active / 2 queued',
        tone: 'warn'
      }),
      expect.objectContaining({
        label: '轉寫',
        valueText: '1 active / 0 queued',
        tone: 'ok'
      }),
      expect.objectContaining({
        label: '摘要',
        valueText: '0 active / 1 queued',
        tone: 'warn'
      })
    ]);
    expect(model.leaseHeadline).toBe('最老 lease 4m');
    expect(model.leaseRows).toEqual([
      expect.objectContaining({
        stageLabel: 'SUMMARY',
        detailText: 'operator-1 / summary-worker / generating-summary',
        heartbeatText: 'hb 15s ago / exp 5m'
      })
    ]);
    expect(model.failureText).toContain('2 / 4');
    expect(model.cleanupText).toBe('Artifact cleanup policy 尚未啟用');
  });
});
