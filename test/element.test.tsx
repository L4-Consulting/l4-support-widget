import { describe, it, expect, beforeEach } from 'vitest';
import { ELEMENT_NAME, registerElement } from '../src/element';
import { setTokenProvider } from '../src/public-api';

describe('l4-support-widget custom element', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('registers the custom element idempotently', () => {
    registerElement();
    registerElement();
    expect(customElements.get(ELEMENT_NAME)).toBeTypeOf('function');
  });

  it('attaches a shadow root and mounts the support launcher', async () => {
    registerElement();
    setTokenProvider(() => 'tok');
    const el = document.createElement(ELEMENT_NAME);
    el.setAttribute('product-key', 'civickit');
    el.setAttribute('api-base', 'https://api.example.test');
    document.body.appendChild(el);

    // React render is async; wait a tick for the root to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(el.shadowRoot).not.toBeNull();
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('Support');
    expect(el.shadowRoot?.querySelector('[data-l4-widget-root]')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('[data-l4-portal-root]')).not.toBeNull();
  });

  it('stamps the version onto a data attribute', async () => {
    registerElement();
    setTokenProvider(() => 'tok');
    const el = document.createElement(ELEMENT_NAME);
    el.setAttribute('product-key', 'civickit');
    el.setAttribute('api-base', 'https://api.example.test');
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));

    expect(el.getAttribute('data-l4-widget-version')).toBe('0.1.0-test');
  });

  it('can use the style-tag fallback mode for non-constructable stylesheet engines', async () => {
    registerElement();
    setTokenProvider(() => 'tok');
    const el = document.createElement(ELEMENT_NAME);
    el.setAttribute('style-mode', 'fallback');
    el.setAttribute('product-key', 'civickit');
    el.setAttribute('api-base', 'https://api.example.test');
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));

    expect(el.getAttribute('data-l4-style-mode')).toBe('style');
    expect(el.shadowRoot?.querySelector('style[data-l4-widget-styles]')).not.toBeNull();
  });
});
