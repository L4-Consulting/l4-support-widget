import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { App } from '../src/App';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('launcher unread activity', () => {
  it('shows an accessible badge from unanswered customer activity while the panel is closed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(casesResponse(true));
    vi.stubGlobal('fetch', fetchMock);
    const { view } = renderApp();

    await waitFor(() => expect(view.container.querySelector('[data-l4-launcher-unread]')).not.toBeNull());
    const launcher = view.container.querySelector('[data-l4-launcher]');
    expect(launcher?.getAttribute('aria-label')).toBe('Open support, unread activity');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/client/support/cases',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('polls on the closed visible cadence, stops while open, and refreshes immediately on close', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(casesResponse(false));
    vi.stubGlobal('fetch', fetchMock);
    const { portalContainer, view } = renderApp();

    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(view.container.querySelector('[data-l4-launcher]') as HTMLElement);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(3); // SupportTab's initial list request.
    await act(() => vi.advanceTimersByTimeAsync(40_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fireEvent.click(portalContainer.querySelector('[data-l4-close-panel]') as HTMLElement);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('pauses while hidden and refreshes immediately when visibility returns', async () => {
    vi.useFakeTimers();
    const visibilityState = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const fetchMock = vi.fn().mockResolvedValue(casesResponse(false));
    vi.stubGlobal('fetch', fetchMock);
    renderApp();

    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(40_000));
    expect(fetchMock).not.toHaveBeenCalled();

    visibilityState.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    visibilityState.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(40_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prevents overlap while a request is in flight', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(casesResponse(false));
    vi.stubGlobal('fetch', fetchMock);
    renderApp();

    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.resolve(casesResponse(false));
    await flushPromises();
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves unread state on rejection and recovers on a later poll', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(casesResponse(true))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(casesResponse(false));
    vi.stubGlobal('fetch', fetchMock);
    const { view } = renderApp();

    await flushPromises();
    expect(view.container.querySelector('[data-l4-launcher-unread]')).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(3); // One request plus ApiClient's GET retry.
    expect(view.container.querySelector('[data-l4-launcher-unread]')).not.toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(20_000));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(view.container.querySelector('[data-l4-launcher-unread]')).toBeNull();
  });

  it('cleans up its interval and visibility listener on unmount', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(casesResponse(false));
    vi.stubGlobal('fetch', fetchMock);
    const { view } = renderApp();

    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(40_000));
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch unread state when support is not an enabled tab', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { view } = renderApp({ tabs: ['help'] });

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-l4-launcher-unread]')).toBeNull();
    expect(view.container.querySelector('[data-l4-launcher]')?.getAttribute('aria-label')).toBe('Open support');
  });
});

function renderApp(config: { tabs?: Array<'help' | 'support' | 'roadmap'> } = {}) {
  const host = document.createElement('div');
  const shadowRoot = host.attachShadow({ mode: 'open' });
  const portalContainer = document.createElement('div');
  const view = render(
    <App
      config={{
        productKey: 'civickit',
        apiBase: 'https://api.example.test',
        getToken: () => 'tok',
        ...config,
      }}
      openSignal={0}
      shadowRoot={shadowRoot}
      portalContainer={portalContainer}
    />,
  );
  return { portalContainer, view };
}

function casesResponse(hasUnread: boolean): Response {
  return new Response(JSON.stringify({
    cases: hasUnread ? [{
      id: 'case-1',
      case_number: 'CASE-2026-01000',
      subject: 'Need help',
      status: 'triaging',
      category: 'how_to',
      severity: 'normal',
      created_at: '2026-07-01T00:00:00.000Z',
      has_unanswered_customer_activity: hasUnread,
    }] : [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
