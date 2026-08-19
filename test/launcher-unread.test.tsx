import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { App } from '../src/App';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('launcher unread activity', () => {
  it('shows an accessible badge from unanswered customer activity while the panel is closed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      cases: [{
        id: 'case-1',
        case_number: 'CASE-2026-01000',
        subject: 'Need help',
        status: 'triaging',
        category: 'how_to',
        severity: 'normal',
        created_at: '2026-07-01T00:00:00.000Z',
        has_unanswered_customer_activity: true,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });

    const view = render(
      <App
        config={{ productKey: 'civickit', apiBase: 'https://api.example.test', getToken: () => 'tok' }}
        openSignal={0}
        shadowRoot={shadowRoot}
        portalContainer={document.createElement('div')}
      />,
    );

    await waitFor(() => expect(view.container.querySelector('[data-l4-launcher-unread]')).not.toBeNull());
    const launcher = view.container.querySelector('[data-l4-launcher]');
    expect(launcher?.getAttribute('aria-label')).toBe('Open support, unread activity');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/client/support/cases',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('does not fetch unread state when support is not an enabled tab', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });

    const view = render(
      <App
        config={{
          productKey: 'civickit',
          apiBase: 'https://api.example.test',
          getToken: () => 'tok',
          tabs: ['help'],
        }}
        openSignal={0}
        shadowRoot={shadowRoot}
        portalContainer={document.createElement('div')}
      />,
    );

    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-l4-launcher-unread]')).toBeNull();
    expect(view.container.querySelector('[data-l4-launcher]')?.getAttribute('aria-label')).toBe('Open support');
  });
});
