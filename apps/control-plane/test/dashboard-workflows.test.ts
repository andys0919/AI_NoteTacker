import { describe, expect, it } from 'vitest';

import {
  filterJobsByQuickFilter,
  getArchivePageState,
  getJobActionSet
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

  it('keeps pagination available when the loaded page has no quick-filter match', () => {
    expect(
      getArchivePageState(
        [{ id: 'job_failed', state: 'failed', createdAt: '2026-04-08T10:00:00.000Z' }],
        'completed',
        true,
        ''
      )
    ).toEqual({
      visibleJobs: [],
      canLoadMore: true
    });
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

  it('keeps heavy detail loading out of archive-card actions', () => {
    expect(
      getJobActionSet(
        {
          state: 'completed',
          inputSource: 'uploaded-audio',
          hasTranscript: true,
          hasSummary: true,
          transcriptArtifact: { storageKey: 'x' }
        },
        'completed'
      )
    ).toEqual(['delete-history', 'export-markdown']);
  });
});
