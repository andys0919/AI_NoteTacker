import { describe, expect, it } from 'vitest';

import {
  buildJobSharePayload,
  filterJobsByQuickFilter,
  getJobActionSet,
  getPreferredQuickExportFormat
} from '../public/dashboard-workflows.js';

describe('dashboard workflow helpers', () => {
  const jobs = [
    {
      id: 'job_active',
      state: 'transcribing',
      createdAt: '2026-04-08T10:00:00.000Z'
    },
    {
      id: 'job_completed',
      state: 'completed',
      createdAt: '2026-04-07T10:00:00.000Z'
    },
    {
      id: 'job_failed',
      state: 'failed',
      createdAt: '2026-03-20T10:00:00.000Z'
    }
  ];

  it('filters jobs by quick-filter state and recency', () => {
    expect(filterJobsByQuickFilter(jobs, 'completed', '2026-04-08T12:00:00.000Z')).toEqual([
      jobs[1]
    ]);
    expect(filterJobsByQuickFilter(jobs, 'failed', '2026-04-08T12:00:00.000Z')).toEqual([
      jobs[2]
    ]);
    expect(filterJobsByQuickFilter(jobs, 'recent', '2026-04-08T12:00:00.000Z')).toEqual([
      jobs[0],
      jobs[1]
    ]);
  });

  it('builds share-ready summary, key-points, and deep-link payloads', () => {
    const payload = buildJobSharePayload(
      {
        id: 'job_share_1',
        requestedJoinName: 'Sales NoteTaker',
        meetingUrl: 'https://meet.google.com/share-demo',
        summaryArtifact: {
          text: '## Summary\n- 已確認客戶需求',
          structured: {
            summary: '已確認客戶需求',
            keyPoints: ['客戶希望四月上線', '需要補正式報價'],
            actionItems: [],
            decisions: [],
            risks: [],
            openQuestions: []
          }
        }
      },
      'http://localhost:3000'
    );

    expect(payload.summaryText).toContain('已確認客戶需求');
    expect(payload.keyPointsText).toContain('客戶希望四月上線');
    expect(payload.shareUrl).toBe('http://localhost:3000/?jobId=job_share_1');
  });

  it('prefers the persisted export format when present', () => {
    expect(getPreferredQuickExportFormat({ preferredExportFormat: 'json' })).toBe('json');
    expect(getPreferredQuickExportFormat({})).toBe('markdown');
  });

  it('reduces terminal job actions to markdown export and delete only', () => {
    expect(
      getJobActionSet(
        {
          state: 'completed',
          inputSource: 'uploaded-audio',
          transcriptArtifact: { storageKey: 'x' }
        },
        'completed'
      )
    ).toEqual(['delete-history', 'export-markdown']);
  });
});
