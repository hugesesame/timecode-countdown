import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import source from '../../public/sw.js?raw';

const SCOPE = 'https://example.test/app/';

type Handler = (event: never) => void;

/** 公開する sw.js そのものを、偽のブラウザの上で動かす */
function boot(fetchImpl: (request: unknown, init?: { signal?: AbortSignal }) => Promise<Response>) {
  const handlers = new Map<string, Handler>();
  const stored = new Map<string, Response>();
  const cache = {
    add: async (url: string) => {
      stored.set(url, await fetchImpl(url));
    },
    put: async (url: string, response: Response) => {
      stored.set(url, response);
    },
    match: async (url: string) => stored.get(url)?.clone(),
  };
  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  const caches = { open: async () => cache };
  new Function('self', 'caches', 'fetch', source)(self, caches, fetchImpl);

  return {
    stored,
    async install(): Promise<void> {
      let done: Promise<unknown> = Promise.resolve();
      handlers.get('install')?.({ waitUntil: (p: Promise<unknown>) => (done = p) } as never);
      await done;
    },
    /** 応答しなかった時は null */
    open(mode = 'navigate'): Promise<Response> | null {
      let answer: Promise<Response> | null = null;
      const request = { mode, url: `${SCOPE}?x=1` };
      handlers.get('fetch')?.({ request, respondWith: (p: Promise<Response>) => (answer = p) } as never);
      return answer;
    },
  };
}

const page = (text: string, status = 200): Response => new Response(text, { status });

describe('sw.js', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('インストールの時にページを保存する', async () => {
    const sw = boot(async () => page('v1'));
    await sw.install();
    expect(await sw.stored.get(SCOPE)?.text()).toBe('v1');
  });

  test('回線がある時は新しい版を返し、保存した版も入れ替える', async () => {
    let text = 'v1';
    const sw = boot(async () => page(text));
    await sw.install();
    text = 'v2';
    expect(await (await sw.open())?.text()).toBe('v2');
    expect(await sw.stored.get(SCOPE)?.text()).toBe('v2');
  });

  test('回線がない時は保存した版を返す', async () => {
    let online = true;
    const sw = boot(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return page('v1');
    });
    await sw.install();
    online = false;
    expect(await (await sw.open())?.text()).toBe('v1');
  });

  test('応答が 3 秒来ない時は保存した版を返す', async () => {
    let slow = false;
    const sw = boot((_request, init) => {
      if (!slow) return Promise.resolve(page('v1'));
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    await sw.install();
    slow = true;
    const answer = sw.open();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await (await answer)?.text()).toBe('v1');
  });

  test('サーバーがエラーを返した時は保存した版を返し、保存した版は入れ替えない', async () => {
    let status = 200;
    const sw = boot(async () => page(status === 200 ? 'v1' : 'error', status));
    await sw.install();
    status = 503;
    expect(await (await sw.open())?.text()).toBe('v1');
    expect(await sw.stored.get(SCOPE)?.text()).toBe('v1');
  });

  test('保存した版がない時は、失敗をそのまま返す', async () => {
    const sw = boot(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(sw.open()).rejects.toThrow('Failed to fetch');
  });

  test('ページを開く以外の通信には手を出さない', async () => {
    const sw = boot(async () => page('v1'));
    expect(sw.open('cors')).toBeNull();
  });
});
