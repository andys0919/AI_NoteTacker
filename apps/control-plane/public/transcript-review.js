import { escapeHtml } from './escape-html.js';

const formatEvidenceTime = (milliseconds) => {
  const totalMilliseconds = Math.max(0, Math.round(Number(milliseconds) || 0));
  const minutes = Math.floor(totalMilliseconds / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const millisecondsPart = totalMilliseconds % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millisecondsPart).padStart(3, '0')}`;
};

const renderReviewFlag = (flag, segment) => {
  const startMs = flag.startMs ?? segment.startMs;
  const endMs = flag.endMs ?? segment.endMs;
  const candidates = Array.isArray(flag.candidates) ? flag.candidates : [];

  return `
    <li class="transcript-review-item">
      <p><strong>原因：</strong>${escapeHtml(flag.reason || 'uncertain')}</p>
      <p><strong>原始詞句：</strong>${escapeHtml(flag.originalText || '')}</p>
      ${candidates.length ? `<p><strong>候選：</strong>${candidates.map(escapeHtml).join('、')}</p>` : ''}
      <p><strong>時間：</strong>${formatEvidenceTime(startMs)}–${formatEvidenceTime(endMs)}</p>
      ${flag.evidence ? `<p><strong>依據：</strong>${escapeHtml(flag.evidence)}</p>` : ''}
    </li>
  `;
};

export const renderTranscriptReviewMarkup = (segments) =>
  segments
    .map((segment) => {
      const displayText = segment.displayText || segment.text || '';
      const reviewFlags = Array.isArray(segment.reviewFlags) ? segment.reviewFlags : [];
      const hasRawEvidence = typeof segment.rawText === 'string';
      const speaker = segment.speaker
        ? `<strong class="transcript-speaker">${escapeHtml(segment.speaker)}：</strong>`
        : '';

      if (!hasRawEvidence && reviewFlags.length === 0) {
        return `<p class="transcript-segment-text">${speaker}${escapeHtml(displayText)}</p>`;
      }

      return `
        <div class="transcript-segment">
          <p class="transcript-segment-text">${speaker}${escapeHtml(displayText)}</p>
          <details class="transcript-evidence">
            <summary>${reviewFlags.length ? `待確認（${reviewFlags.length}）` : '查看原始辨識'}</summary>
            ${hasRawEvidence ? `<p><strong>原始辨識：</strong>${escapeHtml(segment.rawText)}</p>` : ''}
            ${reviewFlags.length ? `<ul>${reviewFlags.map((flag) => renderReviewFlag(flag, segment)).join('')}</ul>` : ''}
          </details>
        </div>
      `;
    })
    .join('');
