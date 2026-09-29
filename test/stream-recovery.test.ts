import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECT_HEADER_TIMEOUT_MS,
  IDLE_READ_TIMEOUT_MS,
  resetStreamAuthContext,
  runCaseStream,
} from '../src/chat/stream';

const SSE_HEADERS = { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : null) };

function waitForAbort(signal?: AbortSignal | null): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = (): void => {
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort);
  });
}

function hangUntilAbort(init?: RequestInit): Promise<Response> {
  return waitForAbort(init?.signal);
}

function immediateEofBody() {
  return {
    getReader: () => ({
      read: async () => ({ done: true, value: undefined }),
      releaseLock: () => undefined,
      cancel: async () => undefined,
    }),
  };
}

describe('stream recovery (M1/M2)', () => {
  beforeEach(() => {
    resetStreamAuthContext();
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('surfaces connect_timeout when headers never arrive', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) => hangUntilAbort(init));

    const errors: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: (r) => errors.push(r) },
    });

    await vi.advanceTimersByTimeAsync(CONNECT_HEADER_TIMEOUT_MS);
    expect(errors).toContain('connect_timeout');
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
  });

  it('surfaces idle_timeout when the body read stalls', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: SSE_HEADERS,
        body: {
          getReader: () => ({
            read: () => waitForAbort(init?.signal),
            releaseLock: () => undefined,
            cancel: async () => undefined,
          }),
        },
      } as unknown as Response),
    );

    const errors: string[] = [];
    const onOpen = vi.fn();
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onOpen, onError: (r) => errors.push(r) },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onOpen).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(IDLE_READ_TIMEOUT_MS);
    expect(errors).toContain('idle_timeout');
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
  });

  it('treats SSE comment heartbeats as read activity', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let reads = 0;
    vi.mocked(fetch).mockImplementation((_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: SSE_HEADERS,
        body: {
          getReader: () => ({
            read: async () => {
              reads += 1;
              if (reads === 1) return { done: false, value: encoder.encode(': hb\n\n') };
              return waitForAbort(init?.signal);
            },
            releaseLock: () => undefined,
            cancel: async () => undefined,
          }),
        },
      } as unknown as Response),
    );

    const errors: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: (r) => errors.push(r) },
    });

    await vi.advanceTimersByTimeAsync(IDLE_READ_TIMEOUT_MS - 1);
    expect(errors).not.toContain('idle_timeout');
    await vi.advanceTimersByTimeAsync(2);
    expect(errors).toContain('idle_timeout');
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
  });

  it('does not reset exponential backoff on headers alone (rapid EOF)', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: SSE_HEADERS,
      body: immediateEofBody(),
    } as unknown as Response);

    const errors: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: (r) => errors.push(r) },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(errors.filter((e) => e === 'eof_paused').length).toBe(1);
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(errors.filter((e) => e === 'eof_paused')).toHaveLength(6);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(6);
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
  });

  it('stops without late errors when aborted during header wait', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) => hangUntilAbort(init));

    const errors: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: (r) => errors.push(r) },
    });

    await vi.advanceTimersByTimeAsync(5_000);
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
    expect(errors).toEqual([]);
  });

  it('stops without late errors when aborted during read stall', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: SSE_HEADERS,
        body: {
          getReader: () => ({
            read: () => waitForAbort(init?.signal),
            releaseLock: () => undefined,
            cancel: async () => undefined,
          }),
        },
      } as unknown as Response),
    );

    const errors: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: (r) => errors.push(r) },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
    expect(errors).toEqual([]);
  });

  it('does not leak after abort while getToken is pending', async () => {
    vi.useFakeTimers();
    const errors: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => new Promise((resolve) => setTimeout(() => resolve('tok'), 60_000)),
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: (r) => errors.push(r) },
    });

    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
    expect(fetch).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('cancels the reader when idle timeout fires', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    vi.mocked(fetch).mockImplementation((_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: SSE_HEADERS,
        body: {
          getReader: () => ({
            read: () => waitForAbort(init?.signal),
            releaseLock: () => undefined,
            cancel,
          }),
        },
      } as unknown as Response),
    );

    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: () => undefined },
    });

    await vi.advanceTimersByTimeAsync(IDLE_READ_TIMEOUT_MS);
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
    expect(cancel).toHaveBeenCalled();
  });
});
