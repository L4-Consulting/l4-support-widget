import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ApiClient } from '../src/api/client';
import { CsatPanel } from '../src/tabs/CsatPanel';
import type { CaseCsat } from '../src/api/types';

const apiBase = 'https://api.example.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

interface RenderPanelOptions {
  initialCsat?: CaseCsat | null;
  onSubmitted?: (csat: CaseCsat) => void;
}

function renderPanel({ initialCsat = null, onSubmitted = vi.fn() }: RenderPanelOptions = {}) {
  const client = new ApiClient({
    productKey: 'civickit',
    productLabel: 'civickit',
    apiBase,
    getToken: () => 'tok-csat',
    tabs: ['support'],
    theme: { accent: '#2563eb', mode: 'light' },
    launcher: { enabled: true, position: 'br' },
  });
  return {
    client,
    onSubmitted,
    ...render(<CsatPanel api={client} caseId="case-1" initialCsat={initialCsat} onSubmitted={onSubmitted} />),
  };
}

describe('CsatPanel', () => {
  it('submits a rating and optional comment via POST /support/cases/:id/csat', async () => {
    let posted: unknown = null;
    server.use(
      http.post(`${apiBase}/api/client/support/cases/case-1/csat`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { csat: { rating: 4, comment: 'Quick turnaround.', submitted_at: '2026-07-03T12:00:00.000Z' } satisfies CaseCsat },
          { status: 201 },
        );
      }),
    );

    const { onSubmitted } = renderPanel();
    const fourStar = screen.getByLabelText('4 of 5 stars') as HTMLInputElement;
    fireEvent.click(fourStar);
    fireEvent.change(screen.getByRole('textbox', { name: /Anything we should know/ }), {
      target: { value: 'Quick turnaround.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));

    await waitFor(() => expect(screen.getByText('Thanks for your feedback.')).not.toBeNull());
    expect(posted).toEqual({ rating: 4, comment: 'Quick turnaround.' });
    expect(onSubmitted).toHaveBeenCalledWith({
      rating: 4,
      comment: 'Quick turnaround.',
      submitted_at: '2026-07-03T12:00:00.000Z',
    });
  });

  it('keyboard navigation: ArrowRight moves rating focus and selection', () => {
    renderPanel();
    const three = screen.getByLabelText('3 of 5 stars') as HTMLInputElement;
    three.focus();
    fireEvent.keyDown(three, { key: 'ArrowRight' });
    const four = screen.getByLabelText('4 of 5 stars') as HTMLInputElement;
    expect(document.activeElement).toBe(four);
    expect(four.checked).toBe(true);
  });

  it('keyboard navigation: ArrowLeft wraps from 1 to 5', () => {
    renderPanel();
    const one = screen.getByLabelText('1 of 5 stars') as HTMLInputElement;
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowLeft' });
    const five = screen.getByLabelText('5 of 5 stars') as HTMLInputElement;
    expect(document.activeElement).toBe(five);
    expect(five.checked).toBe(true);
  });

  it('keyboard navigation: Home jumps to 1 and End to 5', () => {
    renderPanel();
    const three = screen.getByLabelText('3 of 5 stars') as HTMLInputElement;
    three.focus();
    fireEvent.keyDown(three, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByLabelText('1 of 5 stars'));

    const one = screen.getByLabelText('1 of 5 stars') as HTMLInputElement;
    fireEvent.keyDown(one, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByLabelText('5 of 5 stars'));
  });

  it('surfaces a 409 inline without unmounting the panel', async () => {
    server.use(
      http.post(`${apiBase}/api/client/support/cases/case-1/csat`, () =>
        HttpResponse.json({ error: 'case not resolved' }, { status: 409 }),
      ),
    );

    renderPanel();
    fireEvent.click(screen.getByLabelText('5 of 5 stars'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toMatch(/resolved/i);
    // Panel still mounted — submit button still in the tree.
    expect(screen.getByRole('button', { name: 'Submit rating' })).not.toBeNull();
  });

  it('surfaces network errors inline via ServerError path', async () => {
    server.use(
      http.post(`${apiBase}/api/client/support/cases/case-1/csat`, () => HttpResponse.json({ error: 'down' }, { status: 500 })),
    );

    renderPanel();
    fireEvent.click(screen.getByLabelText('2 of 5 stars'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit rating' }));

    const error = await screen.findByRole('alert');
    expect(error).not.toBeNull();
  });

  it('refuses to submit when no rating is chosen', () => {
    renderPanel();
    const submit = screen.getByRole('button', { name: 'Submit rating' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('renders the submitted state when initialCsat is provided and allows editing', () => {
    const onSubmitted = vi.fn();
    const initial: CaseCsat = { rating: 3, comment: 'It was fine.', submitted_at: '2026-07-02T10:00:00.000Z' };
    renderPanel({ initialCsat: initial, onSubmitted });

    expect(screen.getByText('Thanks for your feedback.')).not.toBeNull();
    expect(screen.getByText('It was fine.')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit rating' }));
    expect(screen.getByRole('button', { name: 'Submit rating' })).not.toBeNull();
    // onSubmitted is only fired on a NEW submission, not on edit-button click.
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});