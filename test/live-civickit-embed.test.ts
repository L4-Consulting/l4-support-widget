import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('live CivicKit standalone embed contract', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    delete (window as unknown as { L4Support?: unknown }).L4Support;
    vi.resetModules();
  });

  it('publishes the flat global API and mounts the production CivicKit element shape', async () => {
    await import('../src/global');
    const api = window.L4Support;

    expect(api).toEqual(expect.objectContaining({
      init: expect.any(Function),
      open: expect.any(Function),
      destroy: expect.any(Function),
      setTokenProvider: expect.any(Function),
      version: expect.any(String),
    }));
    expect((api as unknown as { L4Support?: unknown }).L4Support).toBeUndefined();

    api.setTokenProvider(() => 'civickit-live-token');
    api.init({
      productKey: 'civickit',
      apiBase: 'https://api.l4consulting.net',
    });

    const element = document.querySelector('l4-support-widget');
    expect(element).not.toBeNull();
    expect(element?.getAttribute('product-key')).toBe('civickit');
    expect(element?.getAttribute('api-base')).toBe('https://api.l4consulting.net');
    expect(element?.getAttribute('data-l4-widget-version')).toBe(api.version);
    expect(document.head.querySelector('link[href*="fonts.googleapis.com"]')).toBeNull();
  });
});
