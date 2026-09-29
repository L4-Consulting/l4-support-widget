import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectChatStyles, releaseChatStyles } from '../src/chat/chat-styles';

describe('chat scoped styles', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('prefers adopted stylesheets on capable shadow roots without duplicate inline tags', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    mount.setAttribute('data-l4-chat-host', '');
    shadow.append(mount);

    const result = injectChatStyles(mount);

    if (result.mode === 'adoptedStyleSheets') {
      expect(shadow.querySelector('[data-l4-chat-style]')).toBeNull();
      expect(shadow.adoptedStyleSheets.length).toBeGreaterThan(0);
      injectChatStyles(mount);
      expect(shadow.adoptedStyleSheets.length).toBe(1);
      releaseChatStyles(mount);
      expect(shadow.adoptedStyleSheets.length).toBe(0);
      return;
    }

    expect(result.mode).toBe('style');
    injectChatStyles(mount);
    expect(mount.querySelectorAll('[data-l4-chat-style]').length).toBe(1);
    releaseChatStyles(mount);
    expect(mount.querySelector('[data-l4-chat-style]')).toBeNull();
  });

  it('falls back to a scoped style tag when constructable sheets are unavailable', () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    const result = injectChatStyles(mount, { forceFallback: true });
    expect(result.mode).toBe('style');
    expect(mount.querySelector('[data-l4-chat-style]')).not.toBeNull();

    releaseChatStyles(mount);
    expect(mount.querySelector('[data-l4-chat-style]')).toBeNull();
  });
  it('removes its adopted sheet after the mount has detached, preserving host sheets', () => {
    vi.stubGlobal('CSSStyleSheet', class { replaceSync() {} });
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const hostSheet = {};
    Object.defineProperty(shadow, 'adoptedStyleSheets', { value: [hostSheet], writable: true });
    const mount = document.createElement('div');
    shadow.append(mount);
    expect(injectChatStyles(mount).mode).toBe('adoptedStyleSheets');
    expect(shadow.adoptedStyleSheets).toHaveLength(2);
    mount.remove();
    releaseChatStyles(mount);
    expect(shadow.adoptedStyleSheets).toEqual([hostSheet]);
  });

});
