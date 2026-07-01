import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DemoWidget } from './DemoWidget';
import { injectDocumentFonts, injectWidgetStyles, type StyleInjectionMode } from './styles';
import { version } from './version';

/** Tag name for the widget custom element. */
export const ELEMENT_NAME = 'l4-support-widget';

/**
 * The custom element. Creates a shadow root, injects compiled Tailwind CSS, and
 * mounts a minimal React spike tree. This stays intentionally below real tab UI:
 * it proves the shell mechanics that the later widget can build on.
 */
export class L4SupportElement extends HTMLElement {
  #root: Root | null = null;
  #mount: HTMLDivElement | null = null;
  #portalContainer: HTMLDivElement | null = null;

  connectedCallback(): void {
    if (this.#root) return;

    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    injectDocumentFonts(document);
    const styleResult = injectWidgetStyles(shadow, {
      forceFallback: this.getAttribute('style-mode') === 'fallback',
    });

    // Version diagnostics surfaced on the element (v2 plan §2, runtime-drift note).
    this.setAttribute('data-l4-widget-version', version);
    this.setAttribute('data-l4-style-mode', styleResult.mode);

    const mount = document.createElement('div');
    mount.setAttribute('data-l4-widget-root', '');
    mount.setAttribute('data-l4-style-mode', styleResult.mode);
    shadow.appendChild(mount);

    const portalContainer = document.createElement('div');
    portalContainer.setAttribute('data-l4-portal-root', '');
    shadow.appendChild(portalContainer);

    this.#mount = mount;
    this.#portalContainer = portalContainer;

    this.#root = createRoot(mount);
    this.#root.render(createElement(DemoWidget, { shadowRoot: shadow, portalContainer }));
  }

  disconnectedCallback(): void {
    this.#root?.unmount();
    this.#root = null;
    this.#mount?.remove();
    this.#portalContainer?.remove();
    this.#mount = null;
    this.#portalContainer = null;
  }
}

export type { StyleInjectionMode };

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
