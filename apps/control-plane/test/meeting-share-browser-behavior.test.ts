import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('public meeting reader behavior', () => {
  it('preserves the loading skip target and rejects stale token responses', async () => {
    const listeners = new Map<string, () => void>();
    const makeElement = () => ({
      hidden: false,
      focused: false,
      innerHTML: '',
      textContent: '',
      addEventListener() {},
      replaceChildren() {
        this.innerHTML = '';
      },
      classList: {
        add() {},
        remove() {}
      },
      focus() {
        if (!this.hidden) this.focused = true;
      },
      scrollIntoView() {}
    });
    const elements = new Map(
      [
        'shared-meeting-content',
        'shared-meeting-status',
        'shared-title',
        'shared-meta',
        'shared-summary',
        'shared-summary-content',
        'shared-transcript',
        'shared-transcript-content',
        'print-shared-meeting'
      ].map((id) => [id, makeElement()])
    );
    const skipLink = {
      dataset: {} as Record<string, string>,
      hash: '#shared-meeting-content',
      href: '#shared-meeting-content',
      setAttribute(_name: string, value: string) {
        this.href = value;
      }
    };
    const location = { hash: '#token-a' };
    const document = {
      title: '共享會議紀錄',
      querySelector(selector: string) {
        if (selector.startsWith('#')) return elements.get(selector.slice(1));
        return null;
      },
      querySelectorAll(selector: string) {
        return selector === 'a[href^="#"]' ? [skipLink] : [];
      },
      getElementById(id: string) {
        return elements.get(id) ?? null;
      },
      addEventListener() {}
    };
    const window = {
      location,
      print() {},
      addEventListener(name: string, listener: () => void) {
        listeners.set(name, listener);
      }
    };
    const requests = new Map<
      string,
      ReturnType<typeof deferred<{ ok: boolean; json: () => Promise<unknown> }>>
    >();
    const fetch = (_url: string, options: { headers: { Authorization: string } }) => {
      const token = options.headers.Authorization.replace('Bearer ', '');
      const request = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
      requests.set(token, request);
      return request.promise;
    };
    const source = readFileSync(
      resolve(import.meta.dirname, '../public/share.js'),
      'utf-8'
    ).replace(/^import \{[\s\S]*?\} from '\.\/artifact-reader\.js';\n/, '');

    runInNewContext(source, {
      Date,
      Intl,
      clearTimeout,
      decodeURIComponent,
      document,
      encodeURIComponent,
      fetch,
      renderStructuredSummaryMarkup: () => '',
      renderTranscriptMarkup: () => '',
      configureSummaryNavigation() {},
      setTimeout,
      window
    });

    expect(skipLink.href).toBe('#token-a::shared-meeting-content');

    location.hash = '#token-b';
    listeners.get('hashchange')?.();
    expect(skipLink.href).toBe('#token-b::shared-meeting-content');

    location.hash = '#token-b::shared-meeting-content';
    listeners.get('hashchange')?.();
    expect(elements.get('shared-meeting-content')?.focused).toBe(false);

    requests.get('token-b')?.resolve({
      ok: true,
      json: async () => ({
        title: 'B 會議',
        createdAt: '2026-07-31T08:00:00.000Z'
      })
    });
    await flushPromises();
    expect(elements.get('shared-title')?.textContent).toBe('B 會議');
    expect(elements.get('shared-meeting-content')?.focused).toBe(true);

    requests.get('token-a')?.resolve({
      ok: true,
      json: async () => ({
        title: 'A 會議',
        createdAt: '2026-07-31T07:00:00.000Z'
      })
    });
    await flushPromises();
    expect(elements.get('shared-title')?.textContent).toBe('B 會議');
    expect(document.title).toBe('B 會議｜共享會議紀錄');
  });
});
