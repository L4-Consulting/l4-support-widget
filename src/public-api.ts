import { ELEMENT_NAME, registerElement } from './element';
import { ConfigError, normalizeConfig, type L4SupportInit, type NormalizedConfig, type TokenProvider } from './config';
import { clearStoredTokenProvider, getStoredTokenProvider, setStoredTokenProvider } from './token-provider';
import { removeDocumentFonts } from './styles';
import { version } from './version';

let lastConfig: L4SupportInit | null = null;
let lastError: ConfigError | null = null;

/** Register the host's token getter (used by declarative <l4-support-widget> mounts). */
export function setTokenProvider(fn: TokenProvider): void {
  setStoredTokenProvider(fn);
}

/** Current token provider (consumed by the ApiClient in a later task). */
export function getTokenProvider(): TokenProvider | null {
  return getStoredTokenProvider();
}

/**
 * Idempotent init. Registers the custom element (lazily, guarded), stores config,
 * and ensures a single mounted instance exists on the page. A second call updates
 * config. This is the ONLY place the ESM entry may trigger element registration.
 */
export function init(opts: L4SupportInit): void {
  const fallbackTokenProvider = getStoredTokenProvider();
  let normalized: NormalizedConfig;
  try {
    normalized = normalizeConfig(opts, fallbackTokenProvider);
    lastError = null;
  } catch (error) {
    lastError = error instanceof ConfigError ? error : new ConfigError('L4Support.init received invalid configuration.');
    console.error(lastError.message);
    opts.onEvent?.({ type: 'init_error', message: lastError.message });
    return;
  }

  registerElement();

  if (typeof document === 'undefined') return;

  if (opts.getToken) setStoredTokenProvider(opts.getToken);
  const effectiveConfig: L4SupportInit = {
    ...opts,
    assetBase: normalized.assetBase,
    getToken: normalized.getToken,
  };
  lastConfig = effectiveConfig;

  let el = document.querySelector(ELEMENT_NAME) as (HTMLElement & {
    configure?: (nextConfig: L4SupportInit) => void;
  }) | null;
  if (!el) {
    el = document.createElement(ELEMENT_NAME);
    el.setAttribute('product-key', opts.productKey);
    el.setAttribute('api-base', opts.apiBase);
    if (effectiveConfig.assetBase) el.setAttribute('asset-base', effectiveConfig.assetBase);
    el.configure?.(effectiveConfig);
    document.body.appendChild(el);
  } else {
    el.setAttribute('product-key', opts.productKey);
    el.setAttribute('api-base', opts.apiBase);
    if (effectiveConfig.assetBase) el.setAttribute('asset-base', effectiveConfig.assetBase);
    else el.removeAttribute('asset-base');
    el.configure?.(effectiveConfig);
  }
}

/** Read back the last config (diagnostics / tests). */
export function getConfig(): L4SupportInit | null {
  return lastConfig;
}

export function getConfigError(): ConfigError | null {
  return lastError;
}

export function open(): void {
  const el = document.querySelector(ELEMENT_NAME) as (HTMLElement & { open?: () => void }) | null;
  el?.open?.();
}

export function destroy(): void {
  if (typeof document !== 'undefined') {
    document.querySelectorAll(ELEMENT_NAME).forEach((el) => el.remove());
    removeDocumentFonts(document);
  }
  clearStoredTokenProvider();
  lastConfig = null;
  lastError = null;
}

export { version };
export type { L4SupportInit, TokenProvider };
