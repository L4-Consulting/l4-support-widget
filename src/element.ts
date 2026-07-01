import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HelloWidget } from './HelloWidget';
import { version } from './version';

/** Tag name for the widget custom element. */
export const ELEMENT_NAME = 'l4-support-widget';

/**
 * The custom element. Creates a shadow root and mounts a minimal React tree.
 *
 * Scope for THIS task: shadow root + React "hello" render + version wiring only.
 * The Tailwind-in-shadow / adopted-stylesheet proof is deliberately deferred to
 * the next task (v2 plan, Task 1b spike gate).
 */
export class L4SupportElement extends HTMLElement {
  #root: Root | null = null;

  connectedCallback(): void {
    if (this.#root) return;

    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });

    // Version diagnostics surfaced on the element (v2 plan §2, runtime-drift note).
    this.setAttribute('data-l4-widget-version', version);

    const mount = document.createElement('div');
    mount.setAttribute('data-l4-widget-root', '');
    shadow.appendChild(mount);

    this.#root = createRoot(mount);
    this.#root.render(createElement(HelloWidget));
  }

  disconnectedCallback(): void {
    this.#root?.unmount();
    this.#root = null;
  }
}

/**
 * Register the custom element. Idempotent and SSR-safe: no-ops when there is no
 * DOM or when the element is already defined. Callers in the side-effect-free
 * ESM path must invoke this lazily (never at module top level).
 */
export function registerElement(): void {
  if (typeof window === 'undefined') return;
  if (customElements.get(ELEMENT_NAME)) return;
  customElements.define(ELEMENT_NAME, L4SupportElement);
}
