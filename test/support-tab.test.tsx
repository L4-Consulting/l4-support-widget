import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ConfigContext, type NormalizedConfig } from '../src/config';
import { SupportTab } from '../src/tabs/SupportTab';

const apiBase = 'https://api.example.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderSupport(configOverrides: Partial<NormalizedConfig> = {}) {
  const config: NormalizedConfig = {
    productKey: 'civickit',
    apiBase,
    getToken: () => 'tok',
    tabs: ['support'],
    theme: { accent: '#2563eb', mode: 'light' },
    launcher: { enabled: true, position: 'br' },
    ...configOverrides,
  };
  return render(
    <ConfigContext.Provider value={config}>
      <SupportTab />
    </ConfigContext.Provider>,
  );
}

describe('SupportTab', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(await screen.findByText('Thanks for the update')).not.toBeNull();
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
});

function supportCase(id: string, subject = 'Need help') {
  return {
    id,
    subject,
    status: 'open',
    category: 'how_to',
    severity: 'normal',
    created_at: '2026-07-01T00:00:00.000Z',
  };
}

function message(id: string, body: string) {
  return {
    id,
    body,
    author_type: 'client',
    visibility: 'public',
    created_at: '2026-07-01T00:00:00.000Z',
  };
}
