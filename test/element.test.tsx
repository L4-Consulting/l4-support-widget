import { describe, it, expect, beforeEach } from 'vitest';
import { ELEMENT_NAME, registerElement } from '../src/element';

describe('l4-support-widget custom element', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('registers the custom element idempotently', () => {
    registerElement();
    registerElement();
    expect(customElements.get(ELEMENT_NAME)).toBeTypeOf('function');
  });

  it('attaches a shadow root and mounts the React hello tree', async () => {
    registerElement();
    const el = document.createElement(ELEMENT_NAME);
    document.body.appendChild(el);

    // React render is async; wait a tick for the root to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(el.shadowRoot).not.toBeNull();
    const text = el.shadowRoot?.textContent ?? '';
    expect(text).toContain('L4 Support Widget');
  });

  it('stamps the version onto a data attribute', async () => {
    registerElement();
    const el = document.createElement(ELEMENT_NAME);
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));

    expect(el.getAttribute('data-l4-widget-version')).toBe('0.1.0-test');
  });
});
