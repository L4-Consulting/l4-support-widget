/**
 * Global IIFE entry -> `dist/l4-support-widget.js` for <script> embeds.
 *
 * SIDE-EFFECTFUL (v2 plan, BLOCKER B2): registers the custom element eagerly and
 * publishes `window.L4Support`. This bundle BUNDLES its own React runtime so a
 * non-React (or differently-versioned-React) host page works standalone.
 */
import { registerElement } from './element';
import { init, setTokenProvider, version } from './public-api';

// Self-register the element for declarative <l4-support-widget> usage.
registerElement();

const L4Support = { init, setTokenProvider, version } as const;

declare global {
  interface Window {
    L4Support: typeof L4Support;
  }
}

if (typeof window !== 'undefined') {
  window.L4Support = L4Support;
}

export { init, setTokenProvider, version };
