import { describe, it, expect, beforeEach } from 'vitest';
import { init, setTokenProvider, version, getTokenProvider, getConfig } from '../src/public-api';
import { ELEMENT_NAME } from '../src/element';

describe('public API', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('exposes a semver version string', () => {
    expect(version).toBe('0.1.0-test');
  });

  it('init registers the element and mounts a single instance', () => {
    init({ productKey: 'civickit', apiBase: 'https://api.l4consulting.net', getToken: () => null });
    const els = document.querySelectorAll(ELEMENT_NAME);
    expect(els.length).toBe(1);
    expect(els[0].getAttribute('product-key')).toBe('civickit');
    expect(els[0].getAttribute('api-base')).toBe('https://api.l4consulting.net');
  });

  it('init is idempotent — a second call updates config, not instance count', () => {
    init({ productKey: 'civickit', apiBase: 'https://a.example', getToken: () => null });
    init({ productKey: 'agencyhub', apiBase: 'https://b.example', getToken: () => null });
    expect(document.querySelectorAll(ELEMENT_NAME).length).toBe(1);
    expect(document.querySelector(ELEMENT_NAME)?.getAttribute('product-key')).toBe('agencyhub');
    expect(getConfig()?.apiBase).toBe('https://b.example');
  });

  it('setTokenProvider stores the host token getter', () => {
    const fn = () => 'tok-123';
    setTokenProvider(fn);
    expect(getTokenProvider()).toBe(fn);
  });
});
