import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ConfigContext, normalizeConfig, type NormalizedConfig } from '../src/config';
import { ChatConversationHost } from '../src/chat-bridge';
import { loadChatRuntime } from '../src/chat-loader';

const runtime = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn(), setCaseId: vi.fn() }));
vi.mock('../src/chat-loader', () => ({ loadChatRuntime: vi.fn(async () => runtime) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(loadChatRuntime).mockImplementation(async () => runtime);
});

function chatConfig(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
  return normalizeConfig({
    productKey: 'civickit',
    apiBase: 'https://api.example.test',
    getToken: () => 'test',
    chat: { enabled: true },
    ...overrides,
  });
}

function renderHost(
  caseId: string | null,
  config: NormalizedConfig,
  callbacks: {
    onRuntimeUnavailable?: () => void;
    onLivePausedChange?: (paused: boolean) => void;
  } = {},
) {
  return render(
    <ConfigContext.Provider value={config}>
      <ChatConversationHost caseId={caseId} {...callbacks} />
    </ConfigContext.Provider>,
  );
}

it('preserves the chat mount across callback changes and forwards case changes', async () => {
  const config = chatConfig();
  const view = (caseId: string) => renderHost(caseId, config, { onRuntimeUnavailable: () => undefined });
  const { rerender } = view('case-a');
  await waitFor(() => expect(runtime.mount).toHaveBeenCalledTimes(1));
  rerender(
    <ConfigContext.Provider value={config}>
      <ChatConversationHost caseId="case-a" onRuntimeUnavailable={() => undefined} />
    </ConfigContext.Provider>,
  );
  await waitFor(() => expect(runtime.unmount).not.toHaveBeenCalled());
  rerender(
    <ConfigContext.Provider value={config}>
      <ChatConversationHost caseId="case-b" onRuntimeUnavailable={() => undefined} />
    </ConfigContext.Provider>,
  );
  await waitFor(() => expect(runtime.setCaseId).toHaveBeenLastCalledWith('case-b'));
  expect(runtime.mount).toHaveBeenCalledTimes(1);
});

it('invokes the latest live-paused callback without remounting', async () => {
  const config = chatConfig();
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = renderHost('case-a', config, { onLivePausedChange: first });
  await waitFor(() => expect(runtime.mount).toHaveBeenCalledTimes(1));
  const onPaused = runtime.mount.mock.calls[0][0].onLivePausedChange;
  onPaused?.(true);
  expect(first).toHaveBeenCalledWith(true);

  rerender(
    <ConfigContext.Provider value={config}>
      <ChatConversationHost caseId="case-a" onLivePausedChange={second} />
    </ConfigContext.Provider>,
  );
  expect(runtime.unmount).not.toHaveBeenCalled();
  onPaused?.(false);
  expect(second).toHaveBeenCalledWith(false);
  expect(first).toHaveBeenCalledTimes(1);
});

it('mounts the latest case id when the loader resolves after case switches', async () => {
  const config = chatConfig();
  let resolveLoad: (value: typeof runtime) => void = () => undefined;
  vi.mocked(loadChatRuntime).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
  );

  const { rerender } = renderHost('case-a', config);
  rerender(
    <ConfigContext.Provider value={config}>
      <ChatConversationHost caseId="case-b" />
    </ConfigContext.Provider>,
  );
  resolveLoad(runtime);
  await waitFor(() => expect(runtime.mount).toHaveBeenCalledTimes(1));
  expect(runtime.mount).toHaveBeenCalledWith(
    expect.objectContaining({ caseId: 'case-b' }),
  );
  expect(runtime.unmount).not.toHaveBeenCalled();
});

it('remounts when config changes and calls the latest unavailable handler on load failure', async () => {
  const firstUnavailable = vi.fn();
  const secondUnavailable = vi.fn();
  const configA = chatConfig();
  const configB = chatConfig({ apiBase: 'https://api.other.test' });

  vi.mocked(loadChatRuntime)
    .mockResolvedValueOnce(runtime)
    .mockResolvedValueOnce(null);

  const { rerender } = renderHost('case-a', configA, { onRuntimeUnavailable: firstUnavailable });
  await waitFor(() => expect(runtime.mount).toHaveBeenCalledTimes(1));

  rerender(
    <ConfigContext.Provider value={configB}>
      <ChatConversationHost caseId="case-a" onRuntimeUnavailable={secondUnavailable} />
    </ConfigContext.Provider>,
  );
  await waitFor(() => expect(runtime.unmount).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(secondUnavailable).toHaveBeenCalledTimes(1));
  expect(firstUnavailable).not.toHaveBeenCalled();
  expect(runtime.mount).toHaveBeenCalledTimes(1);
});
