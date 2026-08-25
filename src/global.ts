/**
 * Global IIFE entry -> `dist/l4-support-widget.js` for <script> embeds.
 *
 * SIDE-EFFECTFUL (v2 plan, BLOCKER B2): registers the custom element eagerly and
 * publishes `window.L4Support`. This bundle BUNDLES its own React runtime so a
 * non-React (or differently-versioned-React) host page works standalone.
 */
import { registerElement } from './element';
import { destroy, init, open, setTokenProvider, version } from './public-api';
import type { L4SupportInit } from './config';

const scriptAssetBase = typeof document !== 'undefined' && document.currentScript instanceof HTMLScriptElement
  ? new URL('.', document.currentScript.src).toString()
  : undefined;

function initStandalone(opts: L4SupportInit): void {
  init({ ...opts, assetBase: opts.assetBase ?? scriptAssetBase });
}

// Self-register the element for declarative <l4-support-widget> usage.
registerElement();

const L4Support = { destroy, init: initStandalone, open, setTokenProvider, version } as const;

declare global {
  interface Window {
    L4Support: typeof L4Support;
  }
}

if (typeof window !== 'undefined') {
  window.L4Support = L4Support;
}

export { destroy, initStandalone as init, open, setTokenProvider, version };
