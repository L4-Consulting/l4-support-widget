/**
 * Client SSE transport via streaming fetch (not EventSource).
 * Server event shapes for W2.1 are not deployed in this repo — refresh detail on allowed events.
 */

export interface StreamHandlers {
  onEvent: (event: { type: string; data: Record<string, unknown> }) => void;
  onOpen?: () => void;
  onError?: (reason: string) => void;
}

export interface CaseStreamOptions {
  apiBase: string;
  caseId: string;
  productKey: string;
  getToken: () => string | null | Promise<string | null>;
  cursor: string | null;
  onCursor: (cursor: string | null) => void;
  signal: AbortSignal;
  handlers: StreamHandlers;
}

const MAX_AUTH_REFRESH_ATTEMPTS = 2;
const MAX_DEDUPE_ENTRIES = 1000;

/** Max wait for response headers after starting fetch (header-only hang). */
export const CONNECT_HEADER_TIMEOUT_MS = 30_000;
/** Max silence on the body before treating the stream as stalled (heartbeats count as activity). */
export const IDLE_READ_TIMEOUT_MS = 30_000;

const CLIENT_FORWARDED_EVENT_TYPES = new Set(['message', 'status']);

class BoundedDedupe {
  private readonly keys = new Set<string>();
  private readonly order: string[] = [];

  has(key: string): boolean {
    return this.keys.has(key);
  }

  add(key: string): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.order.push(key);
    while (this.order.length > MAX_DEDUPE_ENTRIES) {
      const evict = this.order.shift();
      if (evict !== undefined) this.keys.delete(evict);
    }
  }
}

interface CaseStreamState {
  cursor: string | null;
  dedupe: BoundedDedupe;
}

interface AuthStreamStore {
  cases: Map<string, CaseStreamState>;
}

let activeAuthKey = '';
let authStore: AuthStreamStore = { cases: new Map() };
const providerIdentities = new WeakMap<CaseStreamOptions['getToken'], number>();
let nextProviderIdentity = 0;

/** @internal */
export function streamAuthKey(
  apiBase: string,
  productKey: string,
  getToken: CaseStreamOptions['getToken'],
): string {
  let identity = providerIdentities.get(getToken);
  if (identity === undefined) {
    identity = ++nextProviderIdentity;
    providerIdentities.set(getToken, identity);
  }
  return JSON.stringify([apiBase, productKey, identity]);
}

/** @internal */
export function ensureStreamAuthContext(authKey: string): void {
  if (authKey === activeAuthKey) return;
  activeAuthKey = authKey;
  authStore = { cases: new Map() };
}

/** @internal */
export function resetStreamAuthContext(): void {
  activeAuthKey = '';
  authStore = { cases: new Map() };
}

function caseStreamState(caseId: string): CaseStreamState {
  let state = authStore.cases.get(caseId);
  if (!state) {
    state = { cursor: null, dedupe: new BoundedDedupe() };
    authStore.cases.set(caseId, state);
  }
  return state;
}

/** @internal test hook */
export function getCaseCursorForTests(caseId: string): string | null {
  return authStore.cases.get(caseId)?.cursor ?? null;
}

export function parseSseChunk(buffer: string): {
  events: Array<{ id?: string; type: string; data: string }>;
  rest: string;
} {
  const events: Array<{ id?: string; type: string; data: string }> = [];
  let eventStart = 0;
  let pos = 0;
  let id: string | undefined;
  let type = 'message';
  const dataLines: string[] = [];

  const flushEvent = (): void => {
    if (dataLines.length) events.push({ id, type, data: dataLines.join('\n') });
    id = undefined;
    type = 'message';
    dataLines.length = 0;
  };

  while (pos < buffer.length) {
    const lineEnd = findLineEnd(buffer, pos);
    if (lineEnd === null) break;
    const line = buffer.slice(pos, lineEnd.contentEnd);
    pos = lineEnd.nextPos;

    if (line.length === 0) {
      flushEvent();
      eventStart = pos;
      continue;
    }
    if (line.startsWith(':')) continue;
    if (line.startsWith('id:')) id = line.slice(3).trimStart();
    else if (line.startsWith('event:')) type = line.slice(6).trimStart();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  return { events, rest: buffer.slice(eventStart) };
}

function findLineEnd(
  buffer: string,
  start: number,
): { contentEnd: number; nextPos: number } | null {
  for (let i = start; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (ch === '\n') return { contentEnd: i, nextPos: i + 1 };
    if (ch === '\r') {
      const next = buffer[i + 1];
      if (next === '\n') return { contentEnd: i, nextPos: i + 2 };
      return { contentEnd: i, nextPos: i + 1 };
    }
  }
  return null;
}

/** @internal */
export function backoffMs(attempt: number): number {
  const exp = Math.min(30_000, 1000 * 2 ** attempt);
  const jitter = Math.random() * Math.min(1000, Math.max(0, 30_000 - exp));
  return Math.min(30_000, Math.max(1_000, exp + jitter));
}

function linkParentAbort(parent: AbortSignal, child: AbortController): () => void {
  if (parent.aborted) {
    child.abort();
    return () => undefined;
  }
  const onAbort = (): void => {
    child.abort();
  };
  parent.addEventListener('abort', onAbort);
  return () => parent.removeEventListener('abort', onAbort);
}

async function resolveToken(
  getToken: CaseStreamOptions['getToken'],
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise<string | null>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort);
    void Promise.resolve().then(getToken).then(
      (value) => {
        cleanup();
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readErrorSnippet(response: Response, signal: AbortSignal): Promise<string> {
  try {
    const text = await response.text();
    if (signal.aborted) return '';
    return text.slice(0, 512);
  } catch {
    return '';
  }
}

function isEventStreamContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'text/event-stream';
}

async function cancelResponseBody(body: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await body.cancel();
  } catch {
    // ignore
  }
}

function isInvalidCursorResponse(status: number, body: string): boolean {
  if (status !== 400) return false;
  try {
    const parsed: unknown = JSON.parse(body.trim());
    return isPlainObject(parsed) && parsed.error === 'invalid_cursor';
  } catch {
    return false;
  }
}

function applyCursor(
  next: string | null,
  caseState: CaseStreamState,
  opts: CaseStreamOptions,
  signal: AbortSignal,
): string | null {
  if (signal.aborted) return next;
  caseState.cursor = next;
  opts.onCursor(next);
  return next;
}

export async function runCaseStream(opts: CaseStreamOptions): Promise<void> {
  const authKey = streamAuthKey(opts.apiBase, opts.productKey, opts.getToken);
  ensureStreamAuthContext(authKey);
  const caseState = caseStreamState(opts.caseId);

  let attempt = 0;
  let cursor = opts.cursor ?? caseState.cursor;
  if (cursor !== null && caseState.cursor === null) {
    caseState.cursor = cursor;
  }
  let invalidCursorResyncUsed = false;
  let authRefreshAttempts = 0;

  while (!opts.signal.aborted) {
    const attemptAbort = new AbortController();
    const unlinkParent = linkParentAbort(opts.signal, attemptAbort);
    let connectTimeoutId: number | undefined = window.setTimeout(() => {
      attemptAbort.abort();
    }, CONNECT_HEADER_TIMEOUT_MS);

    const clearConnectTimeout = (): void => {
      if (connectTimeoutId !== undefined) {
        window.clearTimeout(connectTimeoutId);
        connectTimeoutId = undefined;
      }
    };

    const endAttempt = (): void => {
      clearConnectTimeout();
      unlinkParent();
    };

    let token: string | null;
    try {
      token = await resolveToken(opts.getToken, opts.signal);
    } catch (error) {
      endAttempt();
      if (opts.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      opts.handlers.onError?.('token_provider');
      return;
    }
    if (opts.signal.aborted) {
      endAttempt();
      return;
    }

    if (!token) {
      endAttempt();
      opts.handlers.onError?.('missing_token');
      return;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
      'X-Product-Key': opts.productKey,
    };
    if (cursor) headers['Last-Event-ID'] = cursor;

    let response: Response;
    let connectTimedOut = false;
    try {
      response = await fetch(
        `${opts.apiBase}/api/client/support/cases/${encodeURIComponent(opts.caseId)}/stream`,
        { headers, signal: attemptAbort.signal, credentials: 'omit' },
      );
    } catch {
      connectTimedOut = attemptAbort.signal.aborted && !opts.signal.aborted;
      endAttempt();
      if (opts.signal.aborted) return;
      opts.handlers.onError?.(connectTimedOut ? 'connect_timeout' : 'network');
      await sleep(backoffMs(attempt++), opts.signal);
      continue;
    }
    clearConnectTimeout();
    if (opts.signal.aborted) {
      endAttempt();
      return;
    }

    if (response.status === 401) {
      authRefreshAttempts += 1;
      cursor = applyCursor(null, caseState, opts, opts.signal);
      caseState.dedupe = new BoundedDedupe();
      endAttempt();
      if (authRefreshAttempts > MAX_AUTH_REFRESH_ATTEMPTS) {
        opts.handlers.onError?.('auth');
        return;
      }
      opts.handlers.onError?.('auth_retry');
      await sleep(backoffMs(attempt++), opts.signal);
      continue;
    }

    if (response.status === 400) {
      const body = await readErrorSnippet(response, opts.signal);
      endAttempt();
      if (opts.signal.aborted) return;
      if (cursor !== null && !invalidCursorResyncUsed && isInvalidCursorResponse(400, body)) {
        cursor = applyCursor(null, caseState, opts, opts.signal);
        invalidCursorResyncUsed = true;
        attempt = 0;
        continue;
      }
      opts.handlers.onError?.('paused');
      return;
    }

    if (!response.ok || !response.body) {
      endAttempt();
      opts.handlers.onError?.(`http_${response.status}`);
      await sleep(backoffMs(attempt++), opts.signal);
      continue;
    }

    if (!isEventStreamContentType(response.headers.get('Content-Type'))) {
      await cancelResponseBody(response.body);
      endAttempt();
      if (opts.signal.aborted) return;
      opts.handlers.onError?.('invalid_content_type');
      await sleep(backoffMs(attempt++), opts.signal);
      continue;
    }

    if (opts.signal.aborted) {
      endAttempt();
      return;
    }
    opts.handlers.onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let healthyProgress = false;
    let idleTimeoutId: number | undefined;

    const clearIdleWatchdog = (): void => {
      if (idleTimeoutId !== undefined) {
        window.clearTimeout(idleTimeoutId);
        idleTimeoutId = undefined;
      }
    };

    const bumpIdleWatchdog = (): void => {
      clearIdleWatchdog();
      idleTimeoutId = window.setTimeout(() => {
        attemptAbort.abort();
      }, IDLE_READ_TIMEOUT_MS);
    };

    const markHealthyProgress = (): void => {
      if (healthyProgress) return;
      healthyProgress = true;
      attempt = 0;
      authRefreshAttempts = 0;
    };

    let readFailed = false;
    try {
      bumpIdleWatchdog();
      while (!opts.signal.aborted && !attemptAbort.signal.aborted) {
        const { done, value } = await reader.read();
        if (opts.signal.aborted || attemptAbort.signal.aborted) break;
        if (done) break;
        if (!value?.length) continue;
        bumpIdleWatchdog();
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        if (parsed.events.length > 0) markHealthyProgress();
        for (const frame of parsed.events) {
          if (opts.signal.aborted) break;
          if (frame.id) {
            cursor = applyCursor(frame.id, caseState, opts, opts.signal);
          }
          const dedupeKey = frame.id ?? `${frame.type}:${frame.data}`;
          const dedupe = caseState.dedupe;
          if (dedupe.has(dedupeKey)) continue;
          dedupe.add(dedupeKey);

          if (frame.type === 'read') continue;
          if (!CLIENT_FORWARDED_EVENT_TYPES.has(frame.type)) continue;

          let payload: Record<string, unknown>;
          try {
            const parsedJson: unknown = JSON.parse(frame.data);
            if (!isPlainObject(parsedJson)) continue;
            payload = parsedJson;
          } catch {
            continue;
          }

          if (opts.signal.aborted) break;
          opts.handlers.onEvent({ type: frame.type, data: payload });
        }
      }
    } catch {
      readFailed = true;
      if (opts.signal.aborted) {
        // parent cancelled — no error surface
      } else if (attemptAbort.signal.aborted) {
        opts.handlers.onError?.('idle_timeout');
      } else {
        opts.handlers.onError?.('stream_read');
      }
    } finally {
      clearIdleWatchdog();
      try {
        reader.cancel().catch(() => undefined);
      } catch {
        // ignore
      }
      reader.releaseLock();
    }

    const idleTimedOut = attemptAbort.signal.aborted && !opts.signal.aborted;
    endAttempt();

    if (opts.signal.aborted) return;
    if (!readFailed) {
      if (idleTimedOut) opts.handlers.onError?.('idle_timeout');
      else opts.handlers.onError?.('eof_paused');
    }
    await sleep(backoffMs(attempt++), opts.signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort);
  });
}
