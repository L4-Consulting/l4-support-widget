import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShadowFocusTrap } from '../src/focus-trap';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('createShadowFocusTrap', () => {
  it('restores focus to the opener when the trap deactivates', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const opener = document.createElement('button');
    const panel = document.createElement('section');
    const first = document.createElement('button');
    shadowRoot.append(opener, panel);
    panel.append(first);
    vi.spyOn(first, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);

    opener.focus();
    const trap = createShadowFocusTrap(shadowRoot, panel);
    trap.activate();
    await Promise.resolve();
    expect(shadowRoot.activeElement).toBe(first);

    trap.deactivate();
    expect(shadowRoot.activeElement).toBe(opener);
  });

  it('does not focus a disconnected opener during cleanup', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const opener = document.createElement('button');
    const panel = document.createElement('section');
    shadowRoot.append(opener, panel);

    opener.focus();
    const trap = createShadowFocusTrap(shadowRoot, panel);
    trap.activate();
    await Promise.resolve();
    opener.remove();

    expect(() => trap.deactivate()).not.toThrow();
    expect(shadowRoot.activeElement).not.toBe(opener);
  });
});
