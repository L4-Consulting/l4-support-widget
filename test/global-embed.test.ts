import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { normalizeGlobalEmbedHtml } from './embed-snapshot-normalize';

describe('global embed (CivicKit shape, chat flag absent)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ cases: [] }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll('l4-support-widget').forEach((el) => el.remove());
    document.querySelectorAll('script').forEach((el) => {
      if (el.src.includes('l4-support-widget')) el.remove();
    });
  });

  it('does not load chat script when chat flag is absent', async () => {
    const bundlePath = resolve('dist/l4-support-widget.js');
    if (!existsSync(bundlePath)) {
      throw new Error('Build dist/l4-support-widget.js first.');
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.example.test/widget/l4-support-widget.js';
    document.head.appendChild(script);
    Object.defineProperty(document, 'currentScript', { value: script, configurable: true });

    const code = readFileSync(bundlePath, 'utf8');
    const fn = new Function('window', 'document', `${code}\n;return window.L4Support;`);
    const api = fn(window, document) as {
      init: (o: unknown) => void;
      open: () => void;
      destroy: () => void;
    };
    api.init({
      productKey: 'civickit',
      apiBase: 'https://api.example.test',
      getToken: () => 'tok',
      tabs: ['support', 'help'],
    });
    api.open();

    await waitFor(() => {
      const panel = document.querySelector('l4-support-widget')?.shadowRoot?.querySelector('[data-l4-panel]');
      expect(panel).not.toBeNull();
      expect(panel?.querySelector('[data-l4-state="empty"]')).not.toBeNull();
    });

    const host = document.querySelector('l4-support-widget');
    const snapshot = normalizeGlobalEmbedHtml(host?.shadowRoot?.innerHTML ?? '');
    expect(snapshot).toMatchSnapshot('global-embed-flag-off');

    const chatScripts = Array.from(document.querySelectorAll('script')).filter((s) =>
      s.src.includes('l4-support-widget-chat.js'),
    );
    expect(chatScripts.length).toBe(0);

    api.destroy();
    expect(document.querySelector('l4-support-widget')).toBeNull();
  });
});
