import assetManifest from './generated/asset-manifest.json';
import { emitEvent, type NormalizedConfig } from './config';
import { getWidgetAssetDirectory, logChatUnavailableOnce } from './widget-asset-base';

export interface ChatMountProps {
  container: HTMLElement;
  config: NormalizedConfig;
  caseId: string | null;
  onLivePausedChange?: (paused: boolean) => void;
}

export interface ChatRuntime {
  mount(props: ChatMountProps): void;
  unmount(): void;
  setCaseId(caseId: string | null): void;
}

declare global {
  interface Window {
    L4SupportChat?: ChatRuntime;
  }
}

const CHAT_FILE = 'l4-support-widget-chat.js';
let loadGeneration = 0;
let activeGeneration = 0;
let scriptEl: HTMLScriptElement | null = null;
let loadPromise: Promise<ChatRuntime | null> | null = null;
let loadPromiseUrl: string | null = null;
let settleLoad: ((runtime: ChatRuntime | null) => void) | null = null;
let cspWatchConfig: NormalizedConfig | null = null;
let cspWatchUrl: string | null = null;
let cspDocumentListenerRegistered = false;

function chatIntegrity(): string | null {
  const entry = assetManifest.assets[CHAT_FILE];
  return entry?.integrity ?? null;
}

function chatScriptUrl(base: string): string {
  return new URL(CHAT_FILE, base).href;
}

function retireScriptElement(el: HTMLScriptElement | null): void {
  if (!el) return;
  el.onload = null;
  el.onerror = null;
  el.parentNode?.removeChild(el);
}

function removeScript(): void {
  retireScriptElement(scriptEl);
  scriptEl = null;
}

function settlePending(runtime: ChatRuntime | null): void {
  if (settleLoad) {
    settleLoad(runtime);
    settleLoad = null;
  }
}

function isValidChatRuntime(value: unknown): value is ChatRuntime {
  if (!value || typeof value !== 'object') return false;
  const runtime = value as ChatRuntime;
  return (
    typeof runtime.mount === 'function'
    && typeof runtime.unmount === 'function'
    && typeof runtime.setCaseId === 'function'
  );
}

function isChatScriptViolation(event: SecurityPolicyViolationEvent, expectedUrl: string): boolean {
  const directive = event.violatedDirective ?? '';
  if (!directive.startsWith('script-src')) return false;
  const blocked = event.blockedURI ?? '';
  if (!blocked) return false;
  try {
    const blockedUrl = new URL(blocked);
    const expected = new URL(expectedUrl);
    return (
      blockedUrl.origin === expected.origin
      && blockedUrl.pathname === expected.pathname
      && blockedUrl.pathname.endsWith(`/${CHAT_FILE}`)
    );
  } catch {
    return false;
  }
}

function onDocumentCspViolation(event: Event): void {
  if (!cspWatchConfig || !cspWatchUrl) return;
  if (!isChatScriptViolation(event as SecurityPolicyViolationEvent, cspWatchUrl)) return;
  emitEvent(cspWatchConfig, { type: 'chat_blocked_by_csp', blockedURI: (event as SecurityPolicyViolationEvent).blockedURI });
}

function clearCspWatch(): void {
  cspWatchConfig = null;
  cspWatchUrl = null;
  if (cspDocumentListenerRegistered && typeof document !== 'undefined') {
    document.removeEventListener('securitypolicyviolation', onDocumentCspViolation);
    cspDocumentListenerRegistered = false;
  }
}

function beginCspWatch(config: NormalizedConfig, url: string): void {
  cspWatchConfig = config;
  cspWatchUrl = url;
  if (cspDocumentListenerRegistered || typeof document === 'undefined') return;
  cspDocumentListenerRegistered = true;
  document.addEventListener('securitypolicyviolation', onDocumentCspViolation);
}

function finishLoadGeneration(generation: number, runtime: ChatRuntime | null): void {
  if (generation !== activeGeneration) return;
  clearCspWatch();
  if (runtime === null) loadPromise = null;
}

function resolveChatLoadUrl(config: NormalizedConfig): string | null {
  if (config.chat.assetUrl) {
    return config.chat.assetUrl;
  }
  const base = getWidgetAssetDirectory();
  if (!base) return null;
  return chatScriptUrl(base);
}

export function destroyChatLoader(): void {
  loadGeneration += 1;
  activeGeneration = loadGeneration;
  settlePending(null);
  loadPromise = null;
  loadPromiseUrl = null;
  clearCspWatch();
  removeScript();
  try {
    window.L4SupportChat?.unmount();
  } catch {
    // ignore
  }
}

export function loadChatRuntime(config: NormalizedConfig): Promise<ChatRuntime | null> {
  const url = resolveChatLoadUrl(config);
  const integrity = chatIntegrity();
  if (!url) {
    logChatUnavailableOnce('document.currentScript unavailable (global IIFE only)');
    emitEvent(config, { type: 'chat_load_failed', reason: 'no_asset_base' });
    return Promise.resolve(null);
  }
  if (!integrity || integrity.includes('placeholder')) {
    logChatUnavailableOnce('asset manifest missing chat integrity (dev build?)');
    emitEvent(config, { type: 'chat_load_failed', reason: 'no_integrity' });
    return Promise.resolve(null);
  }

  if (loadPromise) {
    if (loadPromiseUrl === url) return loadPromise;
    settlePending(null);
    loadPromise = null;
    loadPromiseUrl = null;
    removeScript();
    clearCspWatch();
  }

  const generation = ++loadGeneration;
  activeGeneration = generation;
  loadPromiseUrl = url;

  beginCspWatch(config, url);
  removeScript();

  loadPromise = new Promise<ChatRuntime | null>((resolve) => {
    settleLoad = resolve;
    const el = document.createElement('script');
    el.src = url;
    el.crossOrigin = 'anonymous';
    el.integrity = integrity;
    scriptEl = el;

    el.onload = () => {
      if (generation !== activeGeneration) return;
      settleLoad = null;
      const runtime = window.L4SupportChat;
      if (!isValidChatRuntime(runtime)) {
        logChatUnavailableOnce('chat script loaded without valid runtime API');
        emitEvent(config, { type: 'chat_load_failed', reason: 'invalid_runtime' });
        finishLoadGeneration(generation, null);
        resolve(null);
        return;
      }
      finishLoadGeneration(generation, runtime);
      resolve(runtime);
    };
    el.onerror = () => {
      if (generation !== activeGeneration) return;
      settleLoad = null;
      logChatUnavailableOnce('chat script failed to load (integrity/CORS/network)');
      emitEvent(config, { type: 'chat_load_failed', reason: 'script_error' });
      finishLoadGeneration(generation, null);
      resolve(null);
    };
    document.head.appendChild(el);
  });

  return loadPromise;
}
