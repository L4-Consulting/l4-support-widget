import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ConfigContext, type NormalizedConfig } from '../src/config';
import { TabStateContext } from '../src/tab-state';
import { SupportTab } from '../src/tabs/SupportTab';

const apiBase = 'https://api.example.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  server.resetHandlers();
});
afterAll(() => server.close());

function renderSupport(configOverrides: Partial<NormalizedConfig> = {}) {
  const baseConfig: NormalizedConfig = {
    productKey: 'civickit',
    productLabel: 'civickit',
    apiBase,
    getToken: () => 'tok',
    tabs: ['support'],
    theme: { accent: '#2563eb', mode: 'light' },
    launcher: { enabled: true, position: 'br', avatar: false },
    avatar: { enabled: false },
    voice: { enabled: false },
    ...configOverrides,
  };
  const config: NormalizedConfig = { ...baseConfig, productLabel: configOverrides.productLabel ?? baseConfig.productLabel };
  return render(
    <ConfigContext.Provider value={config}>
      <TabStateContext.Provider value={{ activeTab: 'support', supportDraftSubject: '', openSupportWith: () => undefined }}>
        <SupportTab />
      </TabStateContext.Provider>
    </ConfigContext.Provider>,
  );
}

describe('SupportTab', () => {
  it('keeps avatar and narration behavior off by default', async () => {
    const narrate = vi.fn();
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [supportCase('case-1')] })),
      http.get(`${apiBase}/api/client/support/cases/case-1`, () =>
        HttpResponse.json({
          case: supportCase('case-1'),
          messages: [
            message('msg-client', 'Customer message', 'client'),
            message('msg-agent', 'Agent message', 'agent'),
          ],
        }),
      ),
    );

    renderSupport({ onNarrate: narrate });

    expect(await screen.findByText('Agent message')).not.toBeNull();
    expect(document.querySelector('[data-l4-agent-avatar]')).toBeNull();
    expect(narrate).not.toHaveBeenCalled();
  });

  it('renders Vega only for agent messages and narrates each agent message once when opted in', async () => {
    const narrate = vi.fn();
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [supportCase('case-1')] })),
      http.get(`${apiBase}/api/client/support/cases/case-1`, () =>
        HttpResponse.json({
          case: supportCase('case-1'),
          messages: [
            message('msg-client', 'Customer message', 'client'),
            message('msg-agent', 'Agent message', 'agent'),
            message('msg-human', 'Human message', 'human', 'Jordan Lee'),
          ],
        }),
      ),
    );

    renderSupport({
      avatar: { enabled: true },
      voice: { enabled: true, provider: 'host' },
      onNarrate: narrate,
    });

    expect(await screen.findByText('Agent message')).not.toBeNull();
    expect(document.querySelectorAll('[data-l4-agent-avatar]')).toHaveLength(1);
    await waitFor(() => expect(narrate).toHaveBeenCalledOnce());
    expect(narrate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-agent',
      body: 'Agent message',
      author_type: 'agent',
    }));
  });

  it('renders list cases and appends a reply', async () => {
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [supportCase('case-1')] })),
      http.get(`${apiBase}/api/client/support/cases/case-1`, () =>
        HttpResponse.json({ case: supportCase('case-1'), messages: [message('msg-1', 'Initial message')] }),
      ),
      http.post(`${apiBase}/api/client/support/cases/case-1/messages`, async ({ request }) => {
        expect(await request.json()).toEqual({ body: 'Thanks for the update' });
        return HttpResponse.json({ message: message('msg-2', 'Thanks for the update') }, { status: 201 });
      }),
    );

    renderSupport();
    expect(await screen.findByText('Need help')).not.toBeNull();
    fireEvent.click(screen.getByText('Need help'));
    expect(await screen.findByText('Initial message')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Thanks for the update' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getAllByText('Thanks for the update').length).toBeGreaterThan(0));
  });

  it('creates cases with only allowed client fields and optimistically adds them', async () => {
    let posted: unknown = null;
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [] })),
      http.post(`${apiBase}/api/client/support/cases`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ case: supportCase('case-2', 'Billing question') }, { status: 201 });
      }),
      http.get(`${apiBase}/api/client/support/cases/case-2`, () =>
        HttpResponse.json({ case: supportCase('case-2', 'Billing question'), messages: [] }),
      ),
    );

    renderSupport();
    expect(await screen.findByText('No cases yet')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Billing question' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Refund details' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'refund' } });
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(posted).toEqual({
        subject: 'Billing question',
        description: 'Refund details',
        category: 'refund',
        severity: 'high',
      }),
    );
    await waitFor(() => expect(screen.getAllByText('Billing question').length).toBeGreaterThan(0));
  });

  it('filters cases, maps statuses, and renders safe status events', async () => {
    let docsCalls = 0;
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () =>
        HttpResponse.json({
          cases: [
            supportCase('case-1', 'Import failure', 'CASE-2026-01184', 'triaging', 'Vega traced the CSV row issue.'),
            supportCase('case-2', 'Roster update', 'CASE-2026-01179', 'waiting_on_customer', 'We need the final list.'),
            supportCase('case-3', 'Payout timing', 'CASE-2026-01158', 'resolved', 'Answered instantly.'),
          ],
        }),
      ),
      http.get(`${apiBase}/api/client/support/cases/case-1`, () =>
        HttpResponse.json({
          case: supportCase('case-1', 'Import failure', 'CASE-2026-01184', 'triaging'),
          messages: [
            message('msg-client', 'Import keeps failing', 'client'),
            message('msg-agent', 'I found duplicate emails', 'agent'),
            message('msg-human', 'I enabled multi-member email', 'human', 'Jordan Lee'),
          ],
          events: [
            {
              id: 'evt-1',
              event_type: 'agent_triage_completed',
              summary: 'Case updated',
              metadata: { next_status: 'triaging' },
              created_at: '2026-07-01T00:01:00.000Z',
            },
            {
              id: 'evt-skip',
              event_type: 'case_updated',
              summary: 'No status',
              metadata: { category: 'data' },
              created_at: '2026-07-01T00:02:00.000Z',
            },
            {
              id: 'evt-assign',
              event_type: 'case_assigned',
              summary: 'Assigned',
              metadata: { assignee_name: 'Jordan Lee' },
              created_at: '2026-07-01T00:03:00.000Z',
            },
          ],
        }),
      ),
      http.get(`${apiBase}/api/client/docs/search`, ({ request }) => {
        docsCalls += 1;
        expect(new URL(request.url).searchParams.get('q')).toBe('CSV');
        return HttpResponse.json({
          results: [
            {
              id: 'doc-1',
              title: 'Resolving duplicate members during import',
              url: 'https://docs.example.test/imports/duplicates',
              source_type: 'article',
              relationship: 'direct',
              match_score: 0.93,
              suggestion_source: 'search',
            },
          ],
        });
      }),
    );

    renderSupport();

    expect((await screen.findAllByText('Import failure')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Waiting on you · 1' }));
    const list = document.querySelector('[data-l4-cases-list]');
    if (!list) throw new Error('missing cases list');
    expect(within(list as HTMLElement).getByText('Roster update')).not.toBeNull();
    expect(within(list as HTMLElement).queryByText('Import failure')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open · 1' }));
    fireEvent.change(screen.getByLabelText('Search tickets & answers'), { target: { value: 'CSV' } });
    expect(await screen.findByText('Resolving duplicate members during import')).not.toBeNull();
    const answerLink = screen.getByRole('link', { name: 'Resolving duplicate members during import' });
    expect(answerLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(docsCalls).toBe(1);
    expect(within(list as HTMLElement).getByText('Import failure')).not.toBeNull();
    expect(within(list as HTMLElement).queryByText('Roster update')).toBeNull();
    fireEvent.click(screen.getAllByText('Import failure')[0]);

    expect(await screen.findByText('I found duplicate emails')).not.toBeNull();
    expect(screen.getByText('VEGA · AI')).not.toBeNull();
    expect(screen.getByText('Jordan Lee')).not.toBeNull();
    expect(screen.getByText('Status ->')).not.toBeNull();
    expect(screen.getByText('auto-triaged')).not.toBeNull();
    expect(screen.getByText('Escalated to a specialist')).not.toBeNull();
    expect(screen.queryByText('No status')).toBeNull();
  });

  it('renders empty, list error, and missing case states', async () => {
    server.use(http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [] })));
    const empty = renderSupport();
    expect(await screen.findByText('No cases yet')).not.toBeNull();
    empty.unmount();

    server.use(http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ error: 'down' }, { status: 500 })));
    const failed = renderSupport();
    expect(await screen.findByText('Could not load cases.')).not.toBeNull();
    failed.unmount();

    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [supportCase('case-404')] })),
      http.get(`${apiBase}/api/client/support/cases/case-404`, () => HttpResponse.json({ error: 'missing' }, { status: 404 })),
    );
    renderSupport();
    fireEvent.click(await screen.findByText('Need help'));
    expect(await screen.findByText("This case isn't available.")).not.toBeNull();
  });

  it('keeps the mobile ticket list visible after Back', async () => {
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [supportCase('case-1')] })),
      http.get(`${apiBase}/api/client/support/cases/case-1`, () =>
        HttpResponse.json({ case: supportCase('case-1'), messages: [message('msg-1', 'Initial message')] }),
      ),
    );

    renderSupport();
    expect(await screen.findByText('Initial message')).not.toBeNull();
    const consoleElement = document.querySelector('[data-l4-support-tab]');
    expect(consoleElement?.getAttribute('data-l4-mobile-view')).toBe('detail');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(consoleElement?.getAttribute('data-l4-mobile-view')).toBe('list'));
  });

  it('silently polls a visible selected case and pauses while hidden', async () => {
    let detailCalls = 0;
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [supportCase('case-1')] })),
      http.get(`${apiBase}/api/client/support/cases/case-1`, () => {
        detailCalls += 1;
        return HttpResponse.json({
          case: supportCase('case-1'),
          messages: [
            message('msg-1', 'Initial message'),
            ...(detailCalls > 1 ? [message('msg-2', 'New Vega reply', 'agent')] : []),
          ],
        });
      }),
    );

    renderSupport();
    expect(await screen.findByText('Initial message')).not.toBeNull();
    expect(detailCalls).toBe(1);
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Draft in progress' } });
    const messageList = document.querySelector('[data-l4-message-list]');
    if (!messageList) throw new Error('missing message list');
    messageList.scrollTop = 37;
    vi.useFakeTimers();

    const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(40_000));
    expect(detailCalls).toBe(1);

    visibilityState.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    vi.useRealTimers();

    expect(await screen.findByText('New Vega reply')).not.toBeNull();
    expect(screen.queryByText('Loading case...')).toBeNull();
    expect((screen.getByLabelText('Reply') as HTMLTextAreaElement).value).toBe('Draft in progress');
    expect(messageList.scrollTop).toBe(37);
    expect(detailCalls).toBe(2);
  });

  it('keeps the newest detail when an older fetch resolves out of order', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const firstResponse = deferred<Response>();
    const secondResponse = deferred<Response>();
    let detailCalls = 0;
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [supportCase('case-1')] })),
      http.get(`${apiBase}/api/client/support/cases/case-1`, () => {
        detailCalls += 1;
        return detailCalls === 1 ? firstResponse.promise : secondResponse.promise;
      }),
    );

    renderSupport();
    await waitFor(() => expect(detailCalls).toBe(1));
    vi.useFakeTimers();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(detailCalls).toBe(2);
    vi.useRealTimers();

    secondResponse.resolve(HttpResponse.json({
      case: supportCase('case-1'),
      messages: [message('msg-2', 'New Vega reply', 'agent')],
    }));
    expect(await screen.findByText('New Vega reply')).not.toBeNull();

    firstResponse.resolve(HttpResponse.json({
      case: supportCase('case-1'),
      messages: [message('msg-1', 'Older snapshot')],
    }));

    await waitFor(() => expect(screen.queryByText('Older snapshot')).toBeNull());
    expect(screen.getByText('New Vega reply')).not.toBeNull();
  });

  it('does not let an in-flight poll erase a just-sent reply', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    const pollResponse = deferred<Response>();
    let detailCalls = 0;
    server.use(
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [supportCase('case-1')] })),
      http.get(`${apiBase}/api/client/support/cases/case-1`, () => {
        detailCalls += 1;
        if (detailCalls === 1) {
          return HttpResponse.json({ case: supportCase('case-1'), messages: [message('msg-1', 'Initial message')] });
        }
        return pollResponse.promise;
      }),
      http.post(`${apiBase}/api/client/support/cases/case-1/messages`, () =>
        HttpResponse.json({ message: message('msg-2', 'Just sent reply') }, { status: 201 }),
      ),
    );

    renderSupport();
    expect(await screen.findByText('Initial message')).not.toBeNull();
    vi.useFakeTimers();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(detailCalls).toBe(2);
    vi.useRealTimers();

    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'Just sent reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const messageList = document.querySelector('[data-l4-message-list]');
    if (!messageList) throw new Error('missing message list');
    expect(await within(messageList as HTMLElement).findByText('Just sent reply')).not.toBeNull();

    await act(async () => {
      pollResponse.resolve(HttpResponse.json({
        case: supportCase('case-1'),
        messages: [message('msg-poll', 'Poll snapshot')],
      }));
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(within(messageList as HTMLElement).queryByText('Poll snapshot')).toBeNull();
    expect(within(messageList as HTMLElement).getByText('Just sent reply')).not.toBeNull();
  });

});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function supportCase(
  id: string,
  subject = 'Need help',
  caseNumber = 'CASE-2026-01000',
  status = 'triaging',
  preview?: string,
) {
  return {
    id,
    case_number: caseNumber,
    subject,
    status,
    category: 'how_to',
    severity: 'normal',
    created_at: '2026-07-01T00:00:00.000Z',
    last_public_message_at: '2026-07-01T00:05:00.000Z',
    last_customer_message_preview: preview,
  };
}

function message(id: string, body: string, authorType = 'client', authorName?: string) {
  return {
    id,
    body,
    author_type: authorType,
    author_name: authorName,
    visibility: 'public',
    created_at: '2026-07-01T00:00:00.000Z',
  };
}
