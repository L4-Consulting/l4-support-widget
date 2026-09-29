import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { NormalizedConfig } from '../src/config';
import { ChatPane } from '../src/chat/ChatPane';
import { resetStreamAuthContext } from '../src/chat/stream';

const apiBase = 'https://api.example.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  resetStreamAuthContext();
  vi.useRealTimers();
  vi.restoreAllMocks();
  server.resetHandlers();
});
afterAll(() => server.close());

function baseConfig(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return {
    productKey: 'civickit',
    productLabel: 'civickit',
    apiBase,
    getToken: () => 'tok',
    tabs: ['support'],
    theme: { accent: '#2563eb', mode: 'light' },
    launcher: { enabled: true, position: 'br', avatar: false },
    avatar: { enabled: false },
    voice: { enabled: false },
    chat: { enabled: true },
    ...overrides,
  };
}

function caseDetail(caseId: string, body: string) {
  return {
    case: {
      id: caseId,
      subject: 'Subject',
      status: 'open',
      category: 'how_to',
      severity: 'normal',
      created_at: '2026-01-01T00:00:00Z',
    },
    messages: [{ id: 'm1', body, author_type: 'agent', created_at: '2026-01-01T00:00:00Z' }],
  };
}

function renderPane(caseId: string | null, config = baseConfig()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = render(
    <ChatPane config={config} caseId={caseId} container={container} />,
  );
  return { ...view, container };
}

describe('ChatPane lifecycle', () => {
  it('clears prior messages when switching cases before the next fetch resolves', async () => {
    server.use(
      http.get(`${apiBase}/api/client/support/cases/case-a`, () =>
        HttpResponse.json(caseDetail('case-a', 'Message A')),
      ),
      http.get(`${apiBase}/api/client/support/cases/case-b`, async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json(caseDetail('case-b', 'Message B'));
      }),
      http.get(`${apiBase}/api/client/support/cases/:id/stream`, () =>
        new HttpResponse(null, { status: 503 }),
      ),
    );

    const { rerender, container } = renderPane('case-a');
    expect(await screen.findByText('Message A')).toBeTruthy();

    rerender(<ChatPane config={baseConfig()} caseId="case-b" container={container} />);
    expect(screen.queryByText('Message A')).toBeNull();
    expect(await screen.findByText('Message B')).toBeTruthy();
  });

  it('ignores stale getCase completion after switching cases', async () => {
    let resolveA!: (value: ReturnType<typeof HttpResponse.json>) => void;
    server.use(
      http.get(`${apiBase}/api/client/support/cases/case-a`, () =>
        new Promise((r) => {
          resolveA = r;
        }),
      ),
      http.get(`${apiBase}/api/client/support/cases/case-b`, () =>
        HttpResponse.json(caseDetail('case-b', 'Message B')),
      ),
      http.get(`${apiBase}/api/client/support/cases/:id/stream`, () =>
        new HttpResponse(null, { status: 503 }),
      ),
    );

    const { rerender, container } = renderPane('case-a');
    rerender(<ChatPane config={baseConfig()} caseId="case-b" container={container} />);
    expect(await screen.findByText('Message B')).toBeTruthy();

    await act(async () => {
      resolveA(HttpResponse.json(caseDetail('case-a', 'Stale A')));
    });
    expect(screen.queryByText('Stale A')).toBeNull();
  });

  it('resets composer draft when the case changes', async () => {
    server.use(
      http.get(`${apiBase}/api/client/support/cases/case-a`, () =>
        HttpResponse.json(caseDetail('case-a', 'Message A')),
      ),
      http.get(`${apiBase}/api/client/support/cases/case-b`, () =>
        HttpResponse.json(caseDetail('case-b', 'Message B')),
      ),
      http.get(`${apiBase}/api/client/support/cases/:id/stream`, () =>
        new HttpResponse(null, { status: 503 }),
      ),
    );

    const { rerender, container } = renderPane('case-a');
    await screen.findByText('Message A');
    const textarea = screen.getByLabelText('Reply') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'draft for A' } });
    expect(textarea.value).toBe('draft for A');

    rerender(<ChatPane config={baseConfig()} caseId="case-b" container={container} />);
    await screen.findByText('Message B');
    expect((screen.getByLabelText('Reply') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows live paused on stream failure and avoids duplicate sends', async () => {
    let posts = 0;
    server.use(
      http.get(`${apiBase}/api/client/support/cases/case-1`, () =>
        HttpResponse.json(caseDetail('case-1', 'Hello')),
      ),
      http.get(`${apiBase}/api/client/support/cases/case-1/stream`, () =>
        new HttpResponse(null, { status: 503 }),
      ),
      http.post(`${apiBase}/api/client/support/cases/case-1/messages`, async () => {
        posts += 1;
        await new Promise((r) => setTimeout(r, 80));
        return HttpResponse.json({
          message: { id: 'm2', body: 'x', author_type: 'client', created_at: '2026-01-02T00:00:00Z' },
        });
      }),
    );

    renderPane('case-1');
    await screen.findByText('Hello');
    await waitFor(() => expect(screen.getByText('Live updates paused')).toBeTruthy());

    const textarea = screen.getByLabelText('Reply');
    fireEvent.change(textarea, { target: { value: 'one' } });
    const form = textarea.closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
    });
    expect(posts).toBe(1);
  });

  it('coalesces authoritative refetches within 400ms', async () => {
    vi.useFakeTimers();
    let getCaseCalls = 0;
    server.use(
      http.get(`${apiBase}/api/client/support/cases/case-1`, () => {
        getCaseCalls += 1;
        return HttpResponse.json(caseDetail('case-1', `Hello ${getCaseCalls}`));
      }),
      http.get(`${apiBase}/api/client/support/cases/case-1/stream`, () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: message\ndata: {"id":"1"}\n\n' +
                  'event: message\ndata: {"id":"2"}\n\n' +
                  'event: status\ndata: {"s":1}\n\n',
              ),
            );
            controller.close();
          },
        });
        return new HttpResponse(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    renderPane('case-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const callsAfterBurst = getCaseCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(getCaseCalls - callsAfterBurst).toBeLessThanOrEqual(1);
  });
});
