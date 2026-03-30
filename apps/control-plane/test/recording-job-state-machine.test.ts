import { describe, expect, it } from 'vitest';

import {
  attachRecordingArtifact,
  createRecordingJob,
  markRecordingJobFailed,
  releaseTranscriptionJobForRetry,
  transitionRecordingJobState
} from '../src/domain/recording-job.js';

describe('recording job lifecycle', () => {
  it('progresses through valid lifecycle states', () => {
    const job = createRecordingJob({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'google-meet'
    });

    const joining = transitionRecordingJobState(job, 'joining');
    const recording = transitionRecordingJobState(joining, 'recording');
    const transcribing = transitionRecordingJobState(recording, 'transcribing');
    const completed = transitionRecordingJobState(transcribing, 'completed');

    expect(completed.state).toBe('completed');
  });

  it('stores a failure reason when the job fails', () => {
    const job = createRecordingJob({
      meetingUrl: 'https://zoom.us/j/123456789',
      platform: 'zoom'
    });

    const failed = markRecordingJobFailed(job, {
      code: 'meeting-join-failed',
      message: 'The worker could not enter the waiting room.'
    });

    expect(failed.state).toBe('failed');
    expect(failed.failureCode).toBe('meeting-join-failed');
    expect(failed.failureMessage).toContain('waiting room');
  });

  it('keeps a transcription job retriable until max attempts are reached', () => {
    const created = createRecordingJob({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'google-meet'
    });

    const transcribing = attachRecordingArtifact(created, {
      storageKey: 'recordings/job_retry/meeting.webm',
      downloadUrl: 'https://storage.example.test/recordings/job_retry/meeting.webm',
      contentType: 'video/webm'
    });

    const firstFailure = releaseTranscriptionJobForRetry(
      {
        ...transcribing,
        assignedTranscriptionWorkerId: 'transcriber-alpha'
      },
      {
        code: 'transcription-failed',
        message: 'whisper crashed'
      },
      3
    );

    expect(firstFailure.state).toBe('transcribing');
    expect(firstFailure.transcriptionAttemptCount).toBe(1);
    expect(firstFailure.assignedTranscriptionWorkerId).toBeUndefined();

    const terminalFailure = releaseTranscriptionJobForRetry(
      {
        ...firstFailure,
        transcriptionAttemptCount: 2,
        assignedTranscriptionWorkerId: 'transcriber-alpha'
      },
      {
        code: 'transcription-failed',
        message: 'whisper crashed again'
      },
      3
    );

    expect(terminalFailure.state).toBe('failed');
    expect(terminalFailure.failureCode).toBe('transcription-failed');
    expect(terminalFailure.transcriptionAttemptCount).toBe(3);
  });
});
