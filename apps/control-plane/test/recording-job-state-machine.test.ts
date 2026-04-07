import { describe, expect, it } from 'vitest';

import {
  attachRecordingArtifact,
  attachSummaryArtifact,
  attachTranscriptArtifact,
  createRecordingJob,
  markRecordingJobFailed,
  releaseTranscriptionJobForRetry,
  transitionRecordingJobState,
  updateRecordingJobProgress
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

  it('stores a summary artifact on a completed job', () => {
    const created = createRecordingJob({
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      platform: 'google-meet'
    });

    const withRecording = attachRecordingArtifact(created, {
      storageKey: 'recordings/job_summary/meeting.webm',
      downloadUrl: 'https://storage.example.test/recordings/job_summary/meeting.webm',
      contentType: 'video/webm'
    });

    const withTranscript = attachTranscriptArtifact(withRecording, {
      storageKey: 'transcripts/job_summary/transcript.json',
      downloadUrl: 'https://storage.example.test/transcripts/job_summary/transcript.json',
      contentType: 'application/json',
      language: 'en',
      segments: [
        {
          startMs: 0,
          endMs: 1200,
          text: 'hello everyone'
        }
      ]
    });

    const summarized = attachSummaryArtifact(withTranscript, {
      model: 'gpt-5.3-codex-spark',
      reasoningEffort: 'medium',
      text: 'Short summary'
    });

    expect(summarized.state).toBe('completed');
    expect(summarized.summaryArtifact?.model).toBe('gpt-5.3-codex-spark');
    expect(summarized.summaryArtifact?.reasoningEffort).toBe('medium');
    expect(summarized.summaryArtifact?.text).toBe('Short summary');
  });

  it('stores a processing stage and message without changing lifecycle state', () => {
    const created = createRecordingJob({
      meetingUrl: 'uploaded://example.mp4',
      platform: 'uploaded-audio',
      inputSource: 'uploaded-audio'
    });

    const updated = updateRecordingJobProgress(created, {
      processingStage: 'preparing-media',
      processingMessage: 'Extracting audio track from uploaded video.'
    });

    expect(updated.state).toBe('queued');
    expect(updated.processingStage).toBe('preparing-media');
    expect(updated.processingMessage).toBe('Extracting audio track from uploaded video.');
    expect(updated.jobHistory?.at(-1)?.stage).toBe('preparing-media');
    expect(updated.jobHistory?.at(-1)?.message).toBe('Extracting audio track from uploaded video.');
  });

  it('creates and appends durable history entries while deduplicating repeated progress updates', () => {
    const created = createRecordingJob({
      meetingUrl: 'uploaded://history-demo.mp4',
      platform: 'uploaded-audio',
      inputSource: 'uploaded-audio'
    });

    expect(created.jobHistory).toHaveLength(1);
    expect(created.jobHistory?.[0]?.stage).toBe('queued');

    const withStage = updateRecordingJobProgress(created, {
      processingStage: 'preparing-media',
      processingMessage: 'Extracting audio track from uploaded video.'
    });

    const repeatedProgress = updateRecordingJobProgress(withStage, {
      processingStage: 'preparing-media',
      processingMessage: 'Extracting audio track from uploaded video.',
      progressPercent: 24
    });

    const withSummary = attachSummaryArtifact(
      attachTranscriptArtifact(
        attachRecordingArtifact(withStage, {
          storageKey: 'recordings/job_history/meeting.webm',
          downloadUrl: 'https://storage.example.test/recordings/job_history/meeting.webm',
          contentType: 'video/webm'
        }),
        {
          storageKey: 'transcripts/job_history/transcript.json',
          downloadUrl: 'https://storage.example.test/transcripts/job_history/transcript.json',
          contentType: 'application/json',
          language: 'en',
          segments: [
            {
              startMs: 0,
              endMs: 1000,
              text: 'hello timeline'
            }
          ]
        }
      ),
      {
        model: 'gpt-5.3-codex-spark',
        reasoningEffort: 'medium',
        text: 'Timeline summary'
      }
    );

    expect(repeatedProgress.jobHistory).toHaveLength(2);
    expect(withSummary.jobHistory?.at(-1)?.stage).toBe('completed');
    expect(withSummary.jobHistory?.at(-1)?.message).toBe(
      'Transcript and summary generation completed.'
    );
  });
});
