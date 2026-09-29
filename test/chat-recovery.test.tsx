import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ChatPane } from '../src/chat/ChatPane';
import { normalizeConfig } from '../src/config';
import { ApiClient } from '../src/api/client';
import { runCaseStream, type CaseStreamOptions } from '../src/chat/stream';
vi.mock('../src/chat/stream', async (original) => ({ ...await original<object>(), runCaseStream: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('keeps fallback polling on schedule despite repeated stream failures', async () => {
  vi.useFakeTimers();
  let options!: CaseStreamOptions;
  vi.mocked(runCaseStream).mockImplementation(async (opts) => { options = opts; });
  const getCase = vi.spyOn(ApiClient.prototype, 'getCase').mockResolvedValue({ case: { id: 'c1' }, messages: [] } as never);
  const config = normalizeConfig({ productKey: 'pk', apiBase: 'https://api.example.test', getToken: () => 'token', chat: { enabled: true } });
  const container = document.createElement('div');
  await act(async () => { render(<ChatPane config={config} caseId="c1" container={container} />); });
  expect(getCase).toHaveBeenCalledTimes(1);
  act(() => options.handlers.onError?.('network'));
  for (let i = 0; i < 4; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    act(() => options.handlers.onError?.('network'));
  }
  expect(getCase).toHaveBeenCalledTimes(2);
});

it('shows recovered messages after the first detail request fails', async () => {
  vi.useFakeTimers();
  let options!: CaseStreamOptions;
  vi.mocked(runCaseStream).mockImplementation(async (opts) => { options = opts; });
  vi.spyOn(ApiClient.prototype, 'getCase').mockRejectedValueOnce(new Error('network')).mockResolvedValue({ case: { id: 'c1' }, messages: [{ id: 'm1', author_type: 'agent', body: 'Recovered conversation' }] } as never);
  const config = normalizeConfig({ productKey: 'pk', apiBase: 'https://api.example.test', getToken: () => 'token', chat: { enabled: true } });
  await act(async () => { render(<ChatPane config={config} caseId="c1" container={document.createElement('div')} />); });
  expect(screen.getByRole('alert').textContent).toContain('Unable to load');
  act(() => options.handlers.onError?.('network'));
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Recovered conversation')).toBeTruthy();
});

it('refreshes authoritative detail after a short reconnect even if the stream closes again', async () => {
  vi.useFakeTimers();
  let options!: CaseStreamOptions;
  vi.mocked(runCaseStream).mockImplementation(async (opts) => { options = opts; });
  const getCase = vi.spyOn(ApiClient.prototype, 'getCase').mockResolvedValue({ case: { id: 'c1' }, messages: [] } as never);
  const config = normalizeConfig({ productKey: 'pk', apiBase: 'https://api.example.test', getToken: () => 'token', chat: { enabled: true } });
  await act(async () => { render(<ChatPane config={config} caseId="c1" container={document.createElement('div')} />); });
  act(() => options.handlers.onError?.('network'));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  act(() => { options.handlers.onOpen?.(); options.handlers.onError?.('eof_paused'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(getCase).toHaveBeenCalledTimes(2);
});
