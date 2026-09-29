/**
 * Captures the directory URL of the executing global IIFE script at evaluation time.
 * Must be imported before any asynchronous work in the global entry.
 */
const current =
  typeof document !== 'undefined' ? document.currentScript : null;
const scriptSrc =
  current && 'src' in current && typeof current.src === 'string' ? current.src : null;

let widgetAssetDirectory: string | null = null;
let loggedMissingCurrentScript = false;

if (scriptSrc) {
  try {
    widgetAssetDirectory = new URL('./', scriptSrc).href;
  } catch {
    widgetAssetDirectory = null;
  }
}

/** Directory URL ending with `/`, derived from `document.currentScript` (global IIFE only). */
export function getWidgetAssetDirectory(): string | null {
  return widgetAssetDirectory;
}

export function logChatUnavailableOnce(reason: string): void {
  if (loggedMissingCurrentScript) return;
  loggedMissingCurrentScript = true;
  console.warn(`[l4-support-widget] chat unavailable: ${reason}`);
}
