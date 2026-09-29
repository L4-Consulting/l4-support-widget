import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  runCaseStream,
  parseSseChunk,
  resetStreamAuthContext,
  getCaseCursorForTests,
  streamAuthKey,
} from '../src/chat/stream';

describe('parseSseChunk', () => {
  it('reassembles frames split across arbitrary chunk boundaries', () => {
    const chunks = [
      'id: a\nevent: mess',
      'age\ndata: {"ok":true}\n\n',
      'event: status\ndata: {"s":1}\r\n',
      '\r\n',
    ];
    let buffer = '';
    const types: string[] = [];
    for (const chunk of chunks) {
      buffer += chunk;
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const e of parsed.events) types.push(e.type);
    }
    expect(types).toEqual(['message', 'status']);
    expect(parseSseChunk(buffer).events).toEqual([]);
  });

  it('supports CR-only line endings inside a frame', () => {
    const { events } = parseSseChunk('event: ping\rdata: {}\r\r');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ping');
  });

  it('handles mixed line endings and CRLF split across chunks', () => {
    const parts = [
      'event: message\rdata: {"a":1}\n',
      '\nevent: status\r\n',
      'data: {"b":2}\n',
      '\n',
    ];
    let buffer = '';
    const types: string[] = [];
    for (const part of parts) {
      buffer += part;
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const e of parsed.events) types.push(e.type);
    }
    expect(types).toEqual(['message', 'status']);
  });

  it('ignores comment lines and coalesces multiline data', () => {
    const { events } = parseSseChunk(
      ': keep-alive\nevent: message\ndata: line1\ndata: line2\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('line1\nline2');
  });
});

const SSE_HEADERS = { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : null) };

describe('runCaseStream', () => {
  beforeEach(() => {
    resetStreamAuthContext();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('deduplicates by event id within one stream session', async () => {
    const encoder = new TextEncoder();
    const frame = 'id: evt-1\nevent: message\ndata: {"x":1}\n\n';
    const body = {
      getReader: () => {
        let i = 0;
        return {
          read: async () => {
            if (i > 0) return { done: true, value: undefined };
            i += 1;
            return { done: false, value: encoder.encode(frame + frame) };
          },
          releaseLock: () => undefined,
          cancel: async () => undefined,
        };
      },
    };

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: SSE_HEADERS,
      body,
    });

    const events: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: (e) => events.push(e.type) },
    });

    await Promise.race([done, new Promise((r) => setTimeout(r, 100))]);
    controller.abort();
    await done;
    expect(events).toEqual(['message']);
  });

  it('reassembles UTF-8 split inside a multibyte code point across stream reads', async () => {
    const encoder = new TextEncoder();
    const frame = 'event: message\ndata: {"body":"😀ok"}\n\n';
    const bytes = encoder.encode(frame);
    const emojiByte = bytes.indexOf(0xf0);
    expect(emojiByte).toBeGreaterThan(-1);
    const splitAt = emojiByte + 2;

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: SSE_HEADERS,
      body: {
        getReader: () => {
          let chunk = 0;
          return {
            read: async () => {
              if (chunk === 0) {
                chunk += 1;
                return { done: false, value: bytes.slice(0, splitAt) };
              }
              if (chunk === 1) {
                chunk += 1;
                return { done: false, value: bytes.slice(splitAt) };
              }
              return { done: true, value: undefined };
            },
            releaseLock: () => undefined,
            cancel: async () => undefined,
          };
        },
      },
    });

    const payloads: Record<string, unknown>[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: {
        onEvent: (e) => {
          payloads.push(e.data);
          controller.abort();
        },
      },
    });
    await done;
    expect(payloads).toEqual([{ body: '😀ok' }]);
  });

  it('resyncs once on invalid_cursor 400 then pauses on repeated 400', async () => {
    let calls = 0;
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url, init) => {
      calls += 1;
      const hadCursor = Boolean(
        init && typeof init === 'object' && (init.headers as Record<string, string>)['Last-Event-ID'],
      );
      if (calls === 1) {
        expect(hadCursor).toBe(true);
      }
      return {
        ok: false,
        status: 400,
        body: null,
        text: async () => JSON.stringify({ error: 'invalid_cursor' }),
      };
    });

    const errors: string[] = [];
    const controller = new AbortController();
    const cursors: Array<string | null> = [];
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: 'stale',
      onCursor: (c) => cursors.push(c),
      signal: controller.signal,
      handlers: {
        onEvent: () => undefined,
        onError: (r) => errors.push(r),
      },
    });

    await Promise.race([done, new Promise((r) => setTimeout(r, 200))]);
    await done;
    expect(cursors).toContain(null);
    expect(calls).toBe(2);
    expect(errors).toContain('paused');
  });

  it('does not treat generic 400 bodies as invalid_cursor resync', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      body: null,
      text: async () => JSON.stringify({ error: 'bad_request' }),
    });

    const errors: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: 'keep-me',
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: (r) => errors.push(r) },
    });
    await done;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getCaseCursorForTests('case-1')).toBe('keep-me');
    expect(errors).toEqual(['paused']);
  });

  it('bounds 401 refresh attempts then stops', async () => {
    vi.useFakeTimers();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      body: null,
    });

    const errors: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: 'c1',
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: (r) => errors.push(r) },
    });

    await vi.runAllTimersAsync();
    await done;
    expect(errors.filter((e) => e === 'auth_retry').length).toBe(2);
    expect(errors).toContain('auth');
    expect(getCaseCursorForTests('case-1')).toBeNull();
  });

  it('surfaces token provider rejection without looping', async () => {
    const errors: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => Promise.reject(new Error('denied')),
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: () => undefined, onError: (r) => errors.push(r) },
    });
    await done;
    expect(errors).toEqual(['token_provider']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not invoke handlers after abort resolves getToken', async () => {
    const errors: string[] = [];
    const events: string[] = [];
    const controller = new AbortController();
    controller.abort();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => new Promise((r) => setTimeout(() => r('tok'), 50)),
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: {
        onEvent: (e) => events.push(e.type),
        onError: (r) => errors.push(r),
      },
    });
    await done;
    expect(fetch).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('does not share dedupe across separate stream sessions for different cases', async () => {
    const encoder = new TextEncoder();
    const frame = 'id: shared\nevent: message\ndata: {"x":1}\n\n';
    const makeBody = () => ({
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: encoder.encode(frame) };
          },
          releaseLock: () => undefined,
          cancel: async () => undefined,
        };
      },
    });

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: SSE_HEADERS,
      body: makeBody(),
    });

    const events: string[] = [];
    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-a',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: c1.signal,
      handlers: { onEvent: (e) => events.push(`a:${e.type}`) },
    });
    await Promise.race([p1, new Promise((r) => setTimeout(r, 50))]);
    c1.abort();
    await p1;

    const p2 = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-b',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: c2.signal,
      handlers: { onEvent: (e) => events.push(`b:${e.type}`) },
    });
    await Promise.race([p2, new Promise((r) => setTimeout(r, 50))]);
    c2.abort();
    await p2;

    expect(events).toContain('a:message');
    expect(events).toContain('b:message');
  });

  it('preserves cursor across case switches within the same auth context', async () => {
    const encoder = new TextEncoder();
    const frame = 'id: cur-9\nevent: message\ndata: {"x":1}\n\n';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: SSE_HEADERS,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: encoder.encode(frame) };
            },
            releaseLock: () => undefined,
            cancel: async () => undefined,
          };
        },
      },
    });

    const getToken = () => 'tok';
    const base = {
      apiBase: 'https://api.example.test',
      productKey: 'pk',
      getToken,
      cursor: null as string | null,
      onCursor: () => undefined,
    };
    const key = streamAuthKey(base.apiBase, base.productKey, getToken);

    const c1 = new AbortController();
    await Promise.race([
      runCaseStream({ ...base, caseId: 'case-a', signal: c1.signal, handlers: { onEvent: () => undefined } }),
      new Promise((r) => setTimeout(r, 50)),
    ]);
    c1.abort();
    expect(getCaseCursorForTests('case-a')).toBe('cur-9');

    const c2 = new AbortController();
    await Promise.race([
      runCaseStream({ ...base, caseId: 'case-b', signal: c2.signal, handlers: { onEvent: () => undefined } }),
      new Promise((r) => setTimeout(r, 50)),
    ]);
    c2.abort();

    const headers: string[] = [];
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (_url, init?: RequestInit) => {
      const raw = init?.headers;
      const lastEventId =
        raw instanceof Headers
          ? raw.get('Last-Event-ID')
          : (raw as Record<string, string> | undefined)?.['Last-Event-ID'];
      headers.push(lastEventId ?? '');
      return {
        ok: true,
        status: 200,
        headers: SSE_HEADERS,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
            releaseLock: () => undefined,
            cancel: async () => undefined,
          }),
        },
      };
    });

    const c3 = new AbortController();
    const p3 = runCaseStream({
      ...base,
      caseId: 'case-a',
      signal: c3.signal,
      handlers: { onEvent: () => undefined, onError: () => undefined },
    });
    await Promise.race([p3, new Promise((r) => setTimeout(r, 50))]);
    c3.abort();
    expect(streamAuthKey(base.apiBase, base.productKey, getToken)).toBe(key);
    expect(headers[0]).toBe('cur-9');
  });

  it('drops all read events and ignores unknown event types', async () => {
    const encoder = new TextEncoder();
    const chunk =
      'event: read\ndata: {"participant_type":"client"}\n\n' +
      'event: typing\ndata: {"x":1}\n\n' +
      'event: bad\ndata: "not-an-object"\n\n' +
      'event: message\ndata: {"ok":true}\n\n';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: SSE_HEADERS,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true, value: undefined };
              sent = true;
              return { done: false, value: encoder.encode(chunk) };
            },
            releaseLock: () => undefined,
            cancel: async () => undefined,
          };
        },
      },
    });

    const types: string[] = [];
    const controller = new AbortController();
    const done = runCaseStream({
      apiBase: 'https://api.example.test',
      caseId: 'case-1',
      productKey: 'pk',
      getToken: () => 'tok',
      cursor: null,
      onCursor: () => undefined,
      signal: controller.signal,
      handlers: { onEvent: (e) => types.push(e.type) },
    });
    await Promise.race([done, new Promise((r) => setTimeout(r, 100))]);
    controller.abort();
    await done;
    expect(types).toEqual(['message']);
  });

  it('announces paused on EOF while reconnecting', async () => {
    vi.useFakeTimers();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: SSE_HEADERS,
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          releaseLock: () => undefined,
          cancel: async () => undefined,
        }),
      },
    });

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
    expect(errors).toContain('eof_paused');
    controller.abort();
    await vi.runAllTimersAsync();
    await done;
  });
  it('does not send an old cursor after the token provider identity changes', async () => {
    const first = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('id: old-auth\nevent: message\ndata: {}\n\n')); c.close(); },
    }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const base = { apiBase: 'https://api.example.test', productKey: 'pk', caseId: 'same-case', cursor: null, onCursor: () => undefined };
    await runCaseStream({ ...base, getToken: () => 'account-a', signal: first.signal, handlers: { onEvent: () => first.abort() } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"error":"bad_request"}', { status: 400 }));
    await runCaseStream({ ...base, getToken: () => 'account-b', signal: new AbortController().signal, handlers: { onEvent: () => undefined } });
    expect(new Headers(vi.mocked(fetch).mock.calls[1][1]?.headers).get('Last-Event-ID')).toBeNull();
  });

  it('stores the cursor delivered after a 401 refresh for the next connection', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('id: after-refresh\nevent: message\ndata: {}\n\n')); c.close(); },
    }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const pending = runCaseStream({ apiBase: 'https://api.example.test', productKey: 'pk', caseId: 'refresh-case', cursor: 'old', onCursor: () => undefined, getToken: () => 'token', signal: controller.signal, handlers: { onEvent: () => controller.abort() } });
    await vi.runAllTimersAsync();
    await pending;
    expect(getCaseCursorForTests('refresh-case')).toBe('after-refresh');
  });

});
