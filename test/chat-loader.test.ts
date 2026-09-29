import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedConfig } from '../src/config';

vi.mock('../src/widget-asset-base', () => ({
  getWidgetAssetDirectory: () => 'https://cdn.example.test/widget/',
  logChatUnavailableOnce: () => undefined,
}));

const baseConfig: NormalizedConfig = {
  productKey: 'pk',
  productLabel: 'pk',
  apiBase: 'https://api.example.test',
  getToken: () => 'tok',
  tabs: ['support'],
  theme: { accent: '#10b981', mode: 'light' },
  launcher: { enabled: true, position: 'br', avatar: false },
  avatar: { enabled: false },
  voice: { enabled: false },
  chat: { enabled: true },
};

describe('chat-loader lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { destroyChatLoader } = await import('../src/chat-loader');
    destroyChatLoader();
  });

  afterEach(async () => {
    const { destroyChatLoader } = await import('../src/chat-loader');
    destroyChatLoader();
    document.querySelectorAll('script[src*="l4-support-widget-chat"]').forEach((el) => el.remove());
  });

  it('shares one in-flight promise for concurrent loads', async () => {
    const { loadChatRuntime } = await import('../src/chat-loader');
    const p1 = loadChatRuntime(baseConfig);
    const p2 = loadChatRuntime(baseConfig);
    expect(p1).toBe(p2);
    const script = document.querySelector('script[src*="l4-support-widget-chat"]') as HTMLScriptElement;
    script?.dispatchEvent(new Event('load'));
    const { destroyChatLoader } = await import('../src/chat-loader');
    destroyChatLoader();
    await Promise.allSettled([p1, p2]);
  });

  it('allows retry after a failed load', async () => {
    const { loadChatRuntime, destroyChatLoader } = await import('../src/chat-loader');
    const first = loadChatRuntime(baseConfig);
    const script = document.querySelector('script[src*="l4-support-widget-chat"]') as HTMLScriptElement;
    script?.dispatchEvent(new Event('error'));
    await first;
    destroyChatLoader();
    const second = loadChatRuntime(baseConfig);
    expect(second).not.toBe(first);
    destroyChatLoader();
    await second;
  });

  it('emits chat_blocked_by_csp only for chat script violations', async () => {
    const events: Array<{ type: string }> = [];
    const config = { ...baseConfig, onEvent: (e: { type: string }) => events.push(e) };
    const { loadChatRuntime } = await import('../src/chat-loader');
    void loadChatRuntime(config);
    const chatViolation = new Event('securitypolicyviolation') as SecurityPolicyViolationEvent;
    Object.defineProperties(chatViolation, {
      blockedURI: { value: 'https://cdn.example.test/widget/l4-support-widget-chat.js' },
      violatedDirective: { value: 'script-src' },
    });
    document.dispatchEvent(chatViolation);
    const otherViolation = new Event('securitypolicyviolation') as SecurityPolicyViolationEvent;
    Object.defineProperties(otherViolation, {
      blockedURI: { value: 'https://cdn.example.test/widget/unrelated.js' },
      violatedDirective: { value: 'script-src' },
    });
    document.dispatchEvent(otherViolation);
    expect(events).toEqual([
      {
        type: 'chat_blocked_by_csp',
        blockedURI: 'https://cdn.example.test/widget/l4-support-widget-chat.js',
      },
    ]);
  });

  it('settles pending load when destroyed', async () => {
    const { loadChatRuntime, destroyChatLoader } = await import('../src/chat-loader');
    const pending = loadChatRuntime(baseConfig);
    destroyChatLoader();
    const runtime = await pending;
    expect(runtime).toBeNull();
  });
  it('ignores an old script failure after destroy and a new load', async () => {
    const { loadChatRuntime, destroyChatLoader } = await import('../src/chat-loader');
    const first = loadChatRuntime(baseConfig);
    const oldScript = document.querySelector('script[src*="l4-support-widget-chat"]') as HTMLScriptElement;
    destroyChatLoader();
    expect(await first).toBeNull();
    const current = loadChatRuntime(baseConfig);
    oldScript.dispatchEvent(new Event('error'));
    expect(loadChatRuntime(baseConfig)).toBe(current);
    destroyChatLoader();
    expect(await current).toBeNull();
  });

  it('does not attribute another origin with the same filename to this chat load', async () => {
    const events: Array<{ type: string }> = [];
    const { loadChatRuntime } = await import('../src/chat-loader');
    void loadChatRuntime({ ...baseConfig, onEvent: (event) => events.push(event) });
    const event = new Event('securitypolicyviolation');
    Object.defineProperties(event, {
      blockedURI: { value: 'https://other.example.test/widget/l4-support-widget-chat.js' },
      violatedDirective: { value: 'script-src' },
    });
    document.dispatchEvent(event);
    expect(events).toEqual([]);
  });

  it('removes CSP listener when load is destroyed', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { loadChatRuntime, destroyChatLoader } = await import('../src/chat-loader');
    void loadChatRuntime(baseConfig);
    destroyChatLoader();
    expect(removeSpy).toHaveBeenCalledWith('securitypolicyviolation', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('uses explicit assetUrl instead of captured global directory', async () => {
    const explicit = 'https://assets.example.test/v1/l4-support-widget-chat.js';
    const config = { ...baseConfig, chat: { enabled: true, assetUrl: explicit } };
    const { loadChatRuntime } = await import('../src/chat-loader');
    void loadChatRuntime(config);
    const script = document.querySelector('script[src*="l4-support-widget-chat"]') as HTMLScriptElement;
    expect(script?.src).toBe(explicit);
  });

});
