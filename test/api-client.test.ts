import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  ApiClient,
  NotEnabledError,
  RateLimitedError,
  ServerError,
  SessionExpiredError,
  ValidationError,
} from '../src/api/client';
import type { NormalizedConfig } from '../src/config';

const apiBase = 'https://api.example.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function config(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  const baseConfig: NormalizedConfig = {
    productKey: 'civickit',
    productLabel: 'civickit',
    apiBase,
    getToken: () => 'tok-1',
    tabs: ['support'],
    theme: { accent: '#2563eb', mode: 'light' },
    launcher: { enabled: true, position: 'br' },
    ...overrides,
  };
  return { ...baseConfig, productLabel: overrides.productLabel ?? baseConfig.productLabel };
}

describe('ApiClient', () => {
  it('sends auth, product key, JSON headers, and credentials omit', async () => {
    expect.assertions(5);
    server.use(
      http.post(`${apiBase}/api/client/support/cases`, async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer tok-1');
        expect(request.headers.get('x-product-key')).toBe('civickit');
        expect(request.headers.get('content-type')).toContain('application/json');
        expect(request.credentials).toBe('omit');
        return HttpResponse.json({ case: supportCase('case-1') }, { status: 201 });
      }),
    );

    const created = await new ApiClient(config()).createCase({
      subject: 'Need help',
      description: 'Body',
      category: 'how_to',
      severity: 'normal',
    });

    expect(created.id).toBe('case-1');
  });

  it('fetches docs search and roadmap responses', async () => {
    server.use(
      http.get(`${apiBase}/api/client/docs/search`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('q')).toBe('billing question');
        return HttpResponse.json({
          results: [
            {
              id: 'doc-1',
              slug: 'billing-help',
              title: 'Billing help',
              url: '/api/client/docs/articles/billing-help',
              source_type: 'article',
              relationship: 'direct',
              match_score: 0.92,
              suggestion_source: 'search',
            },
          ],
        });
      }),
      http.get(`${apiBase}/api/client/docs/articles/billing-help`, () =>
        HttpResponse.json({
          article: {
            id: 'doc-1',
            slug: 'billing-help',
            title: 'Billing help',
            url: '/api/client/docs/articles/billing-help',
            source_type: 'article',
            relationship: 'direct',
            match_score: 0.92,
            suggestion_source: 'search',
            body_markdown: '# Billing help\n\nOpen Payments.',
          },
        }),
      ),
      http.get(`${apiBase}/api/client/roadmap`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'road-1',
              title: 'Better exports',
              description: 'Add CSV exports.',
              category: 'reporting',
              status: 'planned',
              priority: 'medium',
              target_date: null,
              quarter: 'Q3 2026',
              phase: null,
            },
          ],
        }),
      ),
    );

    const client = new ApiClient(config());
    await expect(client.searchDocs('billing question')).resolves.toMatchObject({ results: [{ id: 'doc-1' }] });
    await expect(client.getDocArticle('billing-help')).resolves.toMatchObject({ article: { slug: 'billing-help' } });
    await expect(client.getRoadmap()).resolves.toMatchObject({ items: [{ id: 'road-1' }] });
  });

  it('re-calls getToken once after a 401 and succeeds with the new token', async () => {
    const getToken = vi.fn().mockResolvedValueOnce('expired').mockResolvedValueOnce('fresh');
    const seen: string[] = [];
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, ({ request }) => {
        seen.push(request.headers.get('authorization') ?? '');
        return seen.length === 1
          ? HttpResponse.json({ error: 'expired' }, { status: 401 })
          : HttpResponse.json({ cases: [supportCase('case-1')] });
      }),
    );

    const result = await new ApiClient(config({ getToken })).listCases();

    expect(result.cases).toHaveLength(1);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['Bearer expired', 'Bearer fresh']);
  });

  it('throws SessionExpiredError and emits when auth retry still fails', async () => {
    const onEvent = vi.fn();
    server.use(http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ error: 'no' }, { status: 401 })));

    await expect(new ApiClient(config({ onEvent })).listCases()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(onEvent).toHaveBeenCalledWith({ type: 'session_expired', status: 401 });
  });

  it('maps missing token to SessionExpiredError', async () => {
    const onEvent = vi.fn();
    await expect(new ApiClient(config({ getToken: () => null, onEvent })).listCases()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(onEvent).toHaveBeenCalledWith({ type: 'session_expired', reason: 'missing_token' });
  });

  it('maps 403, 429, 400, 5xx, and network errors', async () => {
    server.use(http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ error: 'disabled' }, { status: 403 })));
    await expect(new ApiClient(config()).listCases()).rejects.toMatchObject(new NotEnabledError());

    server.use(http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ error: 'slow' }, { status: 429, headers: { 'Retry-After': '12' } })));
    await expect(new ApiClient(config()).listCases()).rejects.toMatchObject(new RateLimitedError(12));

    server.use(http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ error: 'bad subject', details: { subject: 'required' } }, { status: 400 })));
    await expect(new ApiClient(config()).listCases()).rejects.toMatchObject(
      Object.assign(new ValidationError({ error: 'bad subject' }), { details: { subject: 'required' } }),
    );

    let serverAttempts = 0;
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => {
        serverAttempts += 1;
        return HttpResponse.json({ error: 'down' }, { status: 500 });
      }),
    );
    await expect(new ApiClient(config()).listCases()).rejects.toBeInstanceOf(ServerError);
    expect(serverAttempts).toBe(2);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'));
    await expect(new ApiClient(config()).listCases()).rejects.toBeInstanceOf(ServerError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry a POST that returns a server error', async () => {
    let postAttempts = 0;
    server.use(
      http.post(`${apiBase}/api/client/support/cases`, () => {
        postAttempts += 1;
        return HttpResponse.json({ error: 'down' }, { status: 500 });
      }),
    );

    await expect(
      new ApiClient(config()).createCase({
        subject: 'Need help',
        category: 'how_to',
        severity: 'normal',
      }),
    ).rejects.toBeInstanceOf(ServerError);
    expect(postAttempts).toBe(1);
  });

  it('maps a fetch timeout to ServerError instead of hanging', async () => {
    const timeoutSignal = AbortSignal.abort();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      expect(init?.signal).toBe(timeoutSignal);
      return Promise.reject(new DOMException('Timed out', 'TimeoutError'));
    });

    await expect(new ApiClient(config()).listCases()).rejects.toBeInstanceOf(ServerError);
    expect(timeoutSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 10_000);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('emits rate_limited and server_error telemetry for typed API failures', async () => {
    const onEvent = vi.fn();
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () =>
        HttpResponse.json({ error: 'slow' }, { status: 429, headers: { 'Retry-After': '15' } }),
      ),
    );

    await expect(new ApiClient(config({ onEvent })).listCases()).rejects.toBeInstanceOf(RateLimitedError);
    expect(onEvent).toHaveBeenCalledWith({ type: 'rate_limited', status: 429, retryAfter: 15 });

    onEvent.mockClear();
    server.use(http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ error: 'down' }, { status: 503 })));

    await expect(new ApiClient(config({ onEvent })).listCases()).rejects.toBeInstanceOf(ServerError);
    expect(onEvent).toHaveBeenCalledWith({ type: 'server_error', status: 503 });
  });
});

function supportCase(id: string) {
  return {
    id,
    subject: 'Need help',
    status: 'open',
    category: 'how_to',
    severity: 'normal',
    created_at: '2026-07-01T00:00:00.000Z',
  };
}
