const CHAT_FILE = 'l4-support-widget-chat.js';

/**
 * ESM hosts do not have `document.currentScript` at evaluation time.
 * Resolve the chat IIFE URL relative to a known module URL (e.g. import.meta.url
 * of the host's widget bootstrap, or the published package `dist/` URL).
 */
export function resolveChatAssetUrl(moduleUrl: string): string {
  return new URL(CHAT_FILE, moduleUrl).href;
}
