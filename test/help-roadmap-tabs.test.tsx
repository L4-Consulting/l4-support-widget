import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { App } from '../src/App';
import { ConfigContext, type L4SupportInit, type NormalizedConfig } from '../src/config';
import { TabStateContext } from '../src/tab-state';
import { HelpTab } from '../src/tabs/HelpTab';
import { RoadmapTab } from '../src/tabs/RoadmapTab';
import { groupRoadmapItems } from '../src/tabs/roadmap-groups';

const apiBase = 'https://api.example.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function config(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return {
    productKey: 'civickit',
    apiBase,
    getToken: () => 'tok',
    tabs: ['help', 'support', 'roadmap'],
    theme: { accent: '#2563eb', mode: 'light' },
    launcher: { enabled: true, position: 'br' },
    ...overrides,
  };
}

function renderHelp() {
  return render(
    <ConfigContext.Provider value={config()}>
      <TabStateContext.Provider value={{ activeTab: 'help', supportDraftSubject: '', openSupportWith: () => undefined }}>
        <HelpTab supportEnabled />
      </TabStateContext.Provider>
    </ConfigContext.Provider>,
  );
}

function renderRoadmap() {
  return render(
    <ConfigContext.Provider value={config()}>
      <RoadmapTab />
    </ConfigContext.Provider>,
  );
}

describe('HelpTab', () => {
  it('does not fetch below 3 characters and shows a type-to-search hint', async () => {
    let requests = 0;
    server.use(
      http.get(`${apiBase}/api/client/docs/search`, () => {
        requests += 1;
        return HttpResponse.json({ results: [] });
      }),
    );

    renderHelp();
    fireEvent.change(screen.getByLabelText('Search help articles'), { target: { value: 'ab' } });
    await waitForDebounce();

    expect(requests).toBe(0);
    expect(screen.getByText('Type at least 3 characters to search.')).not.toBeNull();
  });

  it('debounces docs search and renders title links without snippets', async () => {
    let requests = 0;
    server.use(
      http.get(`${apiBase}/api/client/docs/search`, ({ request }) => {
        requests += 1;
        expect(new URL(request.url).searchParams.get('q')).toBe('billing');
        return HttpResponse.json({
          results: [
            {
              id: 'doc-1',
              title: 'Billing guide',
              url: 'https://docs.example.test/billing',
              source_type: 'bookstack',
              relationship: 'direct',
              match_score: 0.98,
              suggestion_source: 'search',
            },
          ],
        });
      }),
    );

    renderHelp();
    const input = screen.getByLabelText('Search help articles');
    fireEvent.change(input, { target: { value: 'bil' } });
    fireEvent.change(input, { target: { value: 'billing' } });
    await waitForDebounceWindow();
    expect(requests).toBe(0);
    await waitForDebounceRemainder();

    const link = await screen.findByRole('link', { name: 'Billing guide' });
    expect(requests).toBe(1);
    expect(link.getAttribute('href')).toBe('https://docs.example.test/billing');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByText(/snippet|excerpt/i)).toBeNull();
  });

  it('renders the honest empty state', async () => {
    server.use(http.get(`${apiBase}/api/client/docs/search`, () => HttpResponse.json({ results: [] })));

    renderHelp();
    fireEvent.change(screen.getByLabelText('Search help articles'), { target: { value: 'refund' } });
    await waitForDebounce();

    expect(await screen.findByText('No help articles yet')).not.toBeNull();
  });

  it('switches to My Support with the current search query prefilled', async () => {
    server.use(
      http.get(`${apiBase}/api/client/docs/search`, () => HttpResponse.json({ results: [] })),
      http.get(`${apiBase}/api/client/support/cases`, () => HttpResponse.json({ cases: [] })),
    );
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const portalContainer = document.createElement('div');
    document.body.appendChild(portalContainer);
    const init: L4SupportInit = {
      productKey: 'civickit',
      apiBase,
      getToken: () => 'tok',
      tabs: ['help', 'support', 'roadmap'],
      launcher: { enabled: false },
    };

    render(<App config={init} openSignal={1} shadowRoot={shadowRoot} portalContainer={portalContainer} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Help' }));
    fireEvent.change(screen.getByLabelText('Search help articles'), { target: { value: 'refund problem' } });
    await waitForDebounce();
    await screen.findByText('No help articles yet');
    fireEvent.click(screen.getByRole('button', { name: 'Still stuck? File a case' }));

    expect(screen.getByRole('tab', { name: 'My Support' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('refund problem'));
  });
});

describe('RoadmapTab', () => {
  it('groups by returned status and buckets unknown statuses under Other', async () => {
    server.use(
      http.get(`${apiBase}/api/client/roadmap`, () =>
        HttpResponse.json({
          items: [
            roadmapItem('road-1', 'Export center', 'planned', 'Q3 2026'),
            roadmapItem('road-2', 'Portal refresh', 'customer_validating', 'Q4 2026'),
          ],
        }),
      ),
    );

    renderRoadmap();
    expect(await screen.findByText('Planned')).not.toBeNull();
    expect(screen.getByText('Other')).not.toBeNull();
    expect(screen.getByText('Export center')).not.toBeNull();
    expect(screen.getByText('Portal refresh')).not.toBeNull();
    expect(screen.getByText('2026-09-30 · Q3 2026')).not.toBeNull();
  });

  it('renders the empty roadmap state', async () => {
    server.use(http.get(`${apiBase}/api/client/roadmap`, () => HttpResponse.json({ items: [] })));

    renderRoadmap();
    expect(await screen.findByText('No public roadmap yet')).not.toBeNull();
  });

  it('keeps grouped data available for logic-level assertions', () => {
    const groups = groupRoadmapItems([
      roadmapItem('road-1', 'Known', 'in_progress', 'Q3 2026'),
      roadmapItem('road-2', 'Unknown', 'pilot_review', 'Q4 2026'),
    ]);

    expect(groups.map((group) => group.heading)).toEqual(['In progress', 'Other']);
    expect(groups[1].items[0].title).toBe('Unknown');
  });
});

function roadmapItem(id: string, title: string, status: string, quarter: string) {
  return {
    id,
    title,
    description: `${title} description`,
    category: 'core',
    status,
    priority: 'medium',
    target_date: '2026-09-30',
    quarter,
    phase: null,
  };
}

function waitForDebounce() {
  return act(() => wait(350));
}

function waitForDebounceWindow() {
  return act(() => wait(250));
}

function waitForDebounceRemainder() {
  return act(() => wait(100));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
