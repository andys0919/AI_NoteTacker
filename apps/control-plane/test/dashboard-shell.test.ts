import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

describe('dashboard shell markup', () => {
  it('does not render the summary policy panel in the dashboard shell', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );

    expect(html).not.toContain('Summary Policy');
    expect(html).not.toContain('摘要說明');
    expect(html).not.toContain('固定使用完整詳細摘要');
    expect(html).not.toContain('系統預設產出完整詳細摘要');
    expect(html).not.toContain('admin-provider-panel');
    expect(html).not.toContain('admin-usage-report-list');
  });

  it('renders a left intake rail and a right jobs stage layout', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );

    expect(html).toContain('dashboard-left-rail');
    expect(html).toContain('dashboard-right-stage');
    expect(html).toContain('加入線上會議');
    expect(html).toContain('上傳錄音');
    expect(html).toContain('會議筆記');
    expect(html).toContain('class="panel-eyebrow"');
    expect(html).toContain('class="section-heading-icon"');
    expect(html).not.toContain('Meeting Capture');
    expect(html).not.toContain('Recording Intake');
    expect(html).not.toContain('Jobs & Archive');
    expect(html).not.toContain('background-grid');
    expect(html).not.toContain('background-glow');
  });

  it('removes the email login portal and quota card from the dashboard shell', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );

    expect(html).not.toContain('sign-in-button');
    expect(html).not.toContain('Email 驗證登入');
    expect(html).not.toContain('登入入口');
    expect(html).not.toContain('quota-card');
    expect(html).not.toContain('今日雲端額度');
  });

  it('links to the admin console from the dashboard shell', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );

    expect(html).toContain('admin-entry-link');
    expect(html).toContain('href="/admin"');
    expect(html).toContain('dashboard-admin-link');
  });

  it('removes redundant guest summary cards and obsolete guest-auth branches', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/app.js'),
      'utf-8'
    );

    expect(html).not.toContain('submitter-id');
    expect(html).not.toContain('default-join-name');
    expect(html).not.toContain('dashboard-topbar-meta');
    expect(javascript).not.toContain('authEnabled');
    expect(javascript).not.toContain('currentOperatorEmail');
    expect(javascript).not.toContain('updateIdentityDisplay');
  });

  it('exposes live status, busy forms, and selected filter state', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/app.js'),
      'utf-8'
    );

    expect(html).toContain('class="skip-link"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('id="clear-history-button"');
    expect(html).toContain('hidden');
    expect(html).toContain('id="meeting-form-status"');
    expect(html).toContain('id="upload-form-status"');
    expect(html).toContain('正在載入會議筆記…');
    expect(html).toContain('id="job-list" class="job-list" aria-busy="true"');
    expect(javascript).toContain("elements.jobList.setAttribute('aria-busy', 'false')");
    expect(javascript).toContain('無法載入會議筆記。請稍後重新整理頁面。');
    expect(javascript).toContain("button.setAttribute('aria-pressed', String(selected))");
    expect(javascript).toContain('setFormBusy(elements.meetingForm');
    expect(javascript).toContain('setFormBusy(elements.uploadForm');
    expect(javascript).toContain('setFormStatus(elements.meetingFormStatus');
    expect(javascript).toContain('setFormStatus(elements.uploadFormStatus');
  });

  it('keeps uploads generic and refreshes progress without repainting the full job list', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/app.js'),
      'utf-8'
    );

    expect(html).not.toContain('辨識詞彙');
    expect(html).not.toContain('transcription-glossary');
    expect(javascript).not.toContain('elements.transcriptionGlossary');
    expect(javascript).toContain('refreshJobProgress');
    expect(javascript).toContain('updateJobCardProgress');
    expect(javascript).toContain('elements.archiveControls.hidden = !showArchiveControls');
    expect(javascript).toContain('fetchJobsPayload({');
    expect(javascript).toContain('pendingJobIds');
    expect(javascript).not.toContain('Promise.allSettled');
    expect(javascript).toContain('artifactAvailabilityChanged');
    expect(javascript).toContain("progressBar.setAttribute('aria-valuenow'");
    expect(javascript).toContain('PROGRESS_POLL_INTERVAL_MS');
    expect(javascript).not.toContain('updateStatsForStateChange');
  });

  it('refreshes an active detail page through the full job snapshot path', async () => {
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/app.js'),
      'utf-8'
    );
    const start = javascript.indexOf('const refreshJobProgress = async () => {');
    const end = javascript.indexOf('\n};\n\nconst submitMeetingJob', start) + 3;
    const source = javascript
      .slice(start, end)
      .replace('const refreshJobProgress =', 'globalThis.refreshJobProgress =');
    const refreshedDetails: string[] = [];
    let listFetches = 0;
    const context = {
      applyPolledJob() {},
      currentJobs: [{ id: 'job-detail', state: 'summarizing' }],
      currentJobsPageInfo: { pageSize: 25 },
      currentJobStats: {},
      document: { hidden: false },
      fetchJobsPayload: async () => {
        listFetches += 1;
        return { jobs: [], stats: {} };
      },
      isTerminalJob: () => false,
      meetingDetailJobId: 'job-detail',
      progressPollInFlight: false,
      refreshJobsView: async (jobId: string) => {
        refreshedDetails.push(jobId);
      },
      renderJobStats() {}
    } as Record<string, unknown> & {
      refreshJobProgress?: () => Promise<void>;
    };

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    runInNewContext(source, context);
    await context.refreshJobProgress?.();

    expect(refreshedDetails).toEqual(['job-detail']);
    expect(listFetches).toBe(0);
  });

  it('keeps inline expansion off the dashboard and retains the owner-page reader', () => {
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/app.js'),
      'utf-8'
    );
    const transcriptRenderer = readFileSync(
      resolve(import.meta.dirname, '../public/artifact-reader.js'),
      'utf-8'
    );

    expect(javascript).toContain('class="transcript-reader"');
    expect(javascript).toContain('完整逐字稿，可上下捲動');
    expect(javascript).toContain('role="tablist"');
    expect(javascript).toContain('data-artifact-tab="summary"');
    expect(javascript).toContain('data-artifact-tab="transcript"');
    expect(javascript).toContain('data-artifact-panel="summary"');
    expect(javascript).toContain('data-artifact-panel="transcript"');
    expect(javascript).toContain('保留時間與逐字內容');
    expect(transcriptRenderer).not.toContain('transcript-speaker');
    expect(transcriptRenderer).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']");
    expect(javascript).not.toContain('data-action="view-details"');
    expect(javascript).not.toContain('fetchJobDetails');
    expect(javascript).not.toContain('job.transcriptPreview');
    expect(javascript).not.toContain('job.summaryPreview');
    expect(javascript).not.toContain('<details open>');
    expect(transcriptRenderer).not.toContain('查看原始辨識');
    expect(
      transcriptRenderer.slice(transcriptRenderer.indexOf('export const renderTranscriptMarkup'))
    ).not.toContain('<details');
  });

  it('keeps notes before intake in DOM order and respects reduced-motion scrolling', () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../public/index.html'),
      'utf-8'
    );
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/app.js'),
      'utf-8'
    );

    expect(html.indexOf('dashboard-right-stage')).toBeLessThan(
      html.indexOf('dashboard-left-rail')
    );
    expect(javascript).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)').matches");
    expect(javascript).not.toContain("scrollIntoView({ behavior: 'smooth'");
    expect(javascript).toContain("classList.add('summary-deep-link-target')");
    expect(javascript).toContain('target?.focus({ preventScroll: true })');
    expect(javascript).toContain('document.title = `${meetingTitle}｜Solomon NoteTaker`');
    expect(javascript).toContain("document.querySelector('#dashboard-title').textContent = meetingTitle");
    expect(javascript).toContain('<details class="meeting-detail-controls">');
    expect(javascript).toContain('</details>\n      ${artifactReader}');
  });

  it('renders topic-based summaries and omits unsupported empty sections', () => {
    const javascript = readFileSync(
      resolve(import.meta.dirname, '../public/app.js'),
      'utf-8'
    );
    const artifactReader = readFileSync(
      resolve(import.meta.dirname, '../public/artifact-reader.js'),
      'utf-8'
    );

    expect(javascript).toContain('renderStructuredSummaryMarkup');
    expect(artifactReader).toContain('summary-topic-card');
    expect(artifactReader).toContain("confirmed: '已確認'");
    expect(artifactReader).toContain("mixed: '部分確認'");
    expect(artifactReader).toContain("open: '待確認'");
    expect(artifactReader).toContain('summary-subtopic');
    expect(artifactReader).toContain('structured.followUpGroups');
    expect(artifactReader).toContain(
      "{ key: 'analysis', title: 'AI 分析', items: structured.analysisNotes }"
    );
    expect(artifactReader).toContain('class="summary-toc" aria-label="摘要目錄"');
    expect(javascript).toContain('configureSummaryNavigation(card)');
    expect(artifactReader).toContain('.filter((section) => section.items.length)');
    expect(artifactReader).toContain('sanitizeAnonymousSpeakerLabels');
    expect(artifactReader).not.toContain('<p>目前沒有。</p>');
  });
});
