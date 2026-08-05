import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { RecordingJob, SummaryArtifact, TranscriptSegment } from './recording-job.js';

export const MEETING_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type MeetingShareLink = {
  jobId: string;
  shareId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
};

const anonymousSpeakerCode = String.raw`Speaker\s+<?[A-Z0-9]>?(?:\/<?[A-Z0-9]>?)*`;
const anonymousSpeakerLabelPattern = new RegExp(
  String.raw`\b${anonymousSpeakerCode}(?![A-Za-z0-9])`,
  'gi'
);
const anonymousSpeakerPrefixPattern = new RegExp(
  String.raw`^${anonymousSpeakerCode}\s*[:：]\s*`,
  'i'
);

export const sanitizeAnonymousSpeakerLabels = (value: string): string =>
  value.replace(anonymousSpeakerLabelPattern, '與會者');

export const isMeetingShareSecretConfigured = (secret: string): boolean =>
  Buffer.byteLength(secret, 'utf8') >= 32;

export const toReadableTranscriptText = (segment: TranscriptSegment): string => {
  const text = (segment.displayText || segment.text || '').trim();
  const speaker = segment.speaker?.trim();
  const prefix = speaker
    ? [`${speaker}：`, `${speaker}:`].find((candidate) => text.startsWith(candidate))
    : undefined;

  const withoutPrefix = prefix
    ? text.slice(prefix.length).trim()
    : text.replace(anonymousSpeakerPrefixPattern, '').trim();
  return sanitizeAnonymousSpeakerLabels(withoutPrefix);
};

const sanitizeStringList = (value: string[] | undefined): string[] =>
  (value ?? []).map(sanitizeAnonymousSpeakerLabels);

const toPublicStructuredSummary = (structured: NonNullable<SummaryArtifact['structured']>) => ({
  ...(structured.title
    ? { title: sanitizeAnonymousSpeakerLabels(structured.title) }
    : {}),
  summary: sanitizeAnonymousSpeakerLabels(structured.summary),
  ...(structured.topics
    ? {
        topics: structured.topics.map((topic) => ({
          title: sanitizeAnonymousSpeakerLabels(topic.title),
          status: topic.status,
          ...(topic.subtopics
            ? {
                subtopics: topic.subtopics.map((subtopic) => ({
                  title: sanitizeAnonymousSpeakerLabels(subtopic.title),
                  details: sanitizeStringList(subtopic.details)
                }))
              }
            : {}),
          points: sanitizeStringList(topic.points),
          conclusion: sanitizeAnonymousSpeakerLabels(topic.conclusion)
        }))
      }
    : {}),
  ...(structured.followUpGroups
    ? {
        followUpGroups: structured.followUpGroups.map((group) => ({
          title: sanitizeAnonymousSpeakerLabels(group.title),
          items: sanitizeStringList(group.items)
        }))
      }
    : {}),
  keyPoints: sanitizeStringList(structured.keyPoints),
  actionItems: sanitizeStringList(structured.actionItems),
  decisions: sanitizeStringList(structured.decisions),
  risks: sanitizeStringList(structured.risks),
  openQuestions: sanitizeStringList(structured.openQuestions)
});

export const createMeetingShareLink = (jobId: string, at = new Date()): MeetingShareLink => ({
  jobId,
  shareId: randomBytes(24).toString('base64url'),
  createdAt: at.toISOString(),
  expiresAt: new Date(at.getTime() + MEETING_SHARE_TTL_MS).toISOString()
});

export const isMeetingShareLinkActive = (link: MeetingShareLink, at = new Date()): boolean =>
  !link.revokedAt && Date.parse(link.expiresAt) > at.getTime();

const hasReadableSummary = (artifact: SummaryArtifact | undefined): boolean =>
  Boolean(
    artifact &&
      (artifact.text.trim() ||
        artifact.structured?.title?.trim() ||
        artifact.structured?.summary.trim())
  );

export const isMeetingShareEligible = (job: RecordingJob): boolean =>
  job.state === 'completed' &&
  (job.transcriptArtifact?.segments.some((segment) => toReadableTranscriptText(segment)) === true ||
    hasReadableSummary(job.summaryArtifact));

const signatureFor = (link: MeetingShareLink, secret: string): Buffer =>
  createHmac('sha256', secret)
    .update(['v1', link.shareId, link.jobId, link.expiresAt].join('\0'))
    .digest();

export const createMeetingShareToken = (link: MeetingShareLink, secret: string): string =>
  `v1.${link.shareId}.${signatureFor(link, secret).toString('base64url')}`;

export const parseMeetingShareToken = (
  token: string
): { shareId: string; signature: string } | undefined => {
  const match = /^v1\.([A-Za-z0-9_-]{22,})\.([A-Za-z0-9_-]{43})$/.exec(token);
  return match ? { shareId: match[1], signature: match[2] } : undefined;
};

export const verifyMeetingShareToken = (
  token: string,
  link: MeetingShareLink,
  secret: string
): boolean => {
  const parsed = parseMeetingShareToken(token);
  if (!parsed || parsed.shareId !== link.shareId) {
    return false;
  }

  const received = Buffer.from(parsed.signature, 'base64url');
  const expected = signatureFor(link, secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
};

export const toPublicMeeting = (job: RecordingJob) => {
  const segments = (job.transcriptArtifact?.segments ?? [])
    .map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: toReadableTranscriptText(segment)
    }))
    .filter((segment) => segment.text);
  const durationMs = segments.length
    ? Math.max(...segments.map((segment) => segment.endMs)) -
      Math.min(...segments.map((segment) => segment.startMs))
    : undefined;
  const structured = job.summaryArtifact?.structured;

  return {
    title: structured?.title
      ? sanitizeAnonymousSpeakerLabels(structured.title)
      : '會議紀錄',
    createdAt: job.createdAt,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(job.summaryArtifact
      ? {
          summary: structured
            ? { structured: toPublicStructuredSummary(structured) }
            : { text: sanitizeAnonymousSpeakerLabels(job.summaryArtifact.text) }
        }
      : {}),
    ...(job.transcriptArtifact ? { transcript: { segments } } : {})
  };
};
