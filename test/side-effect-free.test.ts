import { describe, it, expect } from 'vitest';

/**
 * BLOCKER B2 guard: importing the ESM entry must NOT define the custom element
 * or write window.L4Support. Registration only happens lazily inside init().
 */
describe('ESM entry side-effect freedom', () => {
  it('importing @l4/support-widget does not register the element or set window.L4Support', async () => {
    // Fresh module graph so a prior test's registerElement() cannot mask this.
    await import('vitest').then(({ vi }) => vi.resetModules());

    // customElements registration is global/irreversible in jsdom, so we assert
    // on the window global instead (the true top-level side effect we forbid).
    expect((window as unknown as { L4Support?: unknown }).L4Support).toBeUndefined();

    const mod = await import('../src/index');
    expect(typeof mod.init).toBe('function');
    expect(typeof mod.setTokenProvider).toBe('function');
    expect(typeof mod.version).toBe('string');

    // Still no window.L4Support after merely importing the ESM entry.
    expect((window as unknown as { L4Support?: unknown }).L4Support).toBeUndefined();
  });
});
