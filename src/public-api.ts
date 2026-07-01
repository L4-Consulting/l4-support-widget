import { ELEMENT_NAME, registerElement } from './element';
import { version } from './version';

/** Host-supplied token getter; may be sync or async. */
export type TokenProvider = () => string | null | Promise<string | null>;

/** Mount-time configuration for the widget. */
export interface L4SupportInit {
  /** Sent as `X-Product-Key`. */
  productKey: string;
  /** API origin, e.g. "https://api.l4consulting.net". */
  apiBase: string;
  /** Host supplies the caller's JWT. */
  getToken?: TokenProvider;
  /** Which tabs to enable. Default: all. */
  tabs?: Array<'help' | 'support' | 'roadmap'>;
  theme?: { accent?: string; mode?: 'light' | 'dark' | 'auto' };
  launcher?: { enabled?: boolean; position?: 'br' | 'bl' };
  onEvent?: (e: { type: string; [k: string]: unknown }) => void;
}

let tokenProvider: TokenProvider | null = null;
let lastConfig: L4SupportInit | null = null;

/** Register the host's token getter (used by declarative <l4-support-widget> mounts). */
export function setTokenProvider(fn: TokenProvider): void {
  tokenProvider = fn;
}

/** Current token provider (consumed by the ApiClient in a later task). */
export function getTokenProvider(): TokenProvider | null {
  return tokenProvider;
}

/**
 * Idempotent init. Registers the custom element (lazily, guarded), stores config,
 * and ensures a single mounted instance exists on the page. A second call updates
 * config. This is the ONLY place the ESM entry may trigger element registration.
 */
export function init(opts: L4SupportInit): void {
  lastConfig = opts;
  if (opts.getToken) tokenProvider = opts.getToken;

  registerElement();

  if (typeof document === 'undefined') return;

  let el = document.querySelector(ELEMENT_NAME);
  if (!el) {
    el = document.createElement(ELEMENT_NAME);
    document.body.appendChild(el);
  }
  el.setAttribute('product-key', opts.productKey);
  el.setAttribute('api-base', opts.apiBase);
}

/** Read back the last config (diagnostics / tests). */
export function getConfig(): L4SupportInit | null {
  return lastConfig;
}

export { version };
