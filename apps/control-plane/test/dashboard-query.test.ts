import { describe, expect, it } from 'vitest';

import { getDashboardPrefill } from '../public/dashboard-query.js';

describe('operator dashboard query prefill', () => {
  it('extracts meetingUrl and requestedJoinName from the page query', () => {
    const result = getDashboardPrefill(
      'http://10.1.2.158:3000/?meetingUrl=https%3A%2F%2Fteams.live.com%2Fmeet%2F9343114235416%3Fp%3DI4yS5pia1gFxNYOOsV&requestedJoinName=Solomon+-+ANdy',
      'Solomon - NoteTaker'
    );

    expect(result).toEqual({
      meetingUrl: 'https://teams.live.com/meet/9343114235416?p=I4yS5pia1gFxNYOOsV',
      jobId: '',
      requestedJoinName: 'Solomon - ANdy',
      shouldAutoQueue: true
    });
  });

  it('falls back to the default join name when only meetingUrl is provided', () => {
    const result = getDashboardPrefill(
      'http://10.1.2.158:3000/?meetingUrl=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij',
      'Solomon - NoteTaker'
    );

    expect(result).toEqual({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      jobId: '',
      requestedJoinName: 'Solomon - NoteTaker',
      shouldAutoQueue: true
    });
  });

  it('extracts a shared job deep link without auto-queueing a new meeting job', () => {
    const result = getDashboardPrefill(
      'http://10.1.2.158:3000/?jobId=job_shared_123',
      'Solomon - NoteTaker'
    );

    expect(result).toEqual({
      meetingUrl: '',
      jobId: 'job_shared_123',
      requestedJoinName: 'Solomon - NoteTaker',
      shouldAutoQueue: false
    });
  });
});
