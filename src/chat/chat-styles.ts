import chatScopedCss from './chat-scoped.css?inline';
import type { StyleInjectionResult } from '../styles';

const CHAT_STYLE_MARKER = 'data-l4-chat-style';

let sharedChatSheet: CSSStyleSheet | null = null;
const mountedRoots = new WeakMap<HTMLElement, ShadowRoot>();
const rootOwners = new WeakMap<ShadowRoot, Set<HTMLElement>>();

function supportsConstructableStyleSheets(shadowRoot: ShadowRoot): boolean {
  return (
    'adoptedStyleSheets' in shadowRoot &&
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype
  );
}

function resolveShadowRoot(container: HTMLElement): ShadowRoot | null {
  const root = container.getRootNode();
  return root instanceof ShadowRoot ? root : null;
}

export function injectChatStyles(
  container: HTMLElement,
  options: { forceFallback?: boolean } = {},
): StyleInjectionResult {
  const shadowRoot = resolveShadowRoot(container);
  if (mountedRoots.has(container) && (mountedRoots.get(container) !== shadowRoot || options.forceFallback)) {
    releaseChatStyles(container);
  }
  if (!options.forceFallback && shadowRoot && supportsConstructableStyleSheets(shadowRoot)) {
    if (!sharedChatSheet) {
      sharedChatSheet = new CSSStyleSheet();
      sharedChatSheet.replaceSync(chatScopedCss);
    }
    if (!shadowRoot.adoptedStyleSheets.includes(sharedChatSheet)) {
      shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sharedChatSheet];
    }
    const owners = rootOwners.get(shadowRoot) ?? new Set<HTMLElement>();
    owners.add(container);
    rootOwners.set(shadowRoot, owners);
    mountedRoots.set(container, shadowRoot);
    return { mode: 'adoptedStyleSheets', cssText: chatScopedCss };
  }

  if (!container.querySelector(`[${CHAT_STYLE_MARKER}]`)) {
    const style = document.createElement('style');
    style.setAttribute(CHAT_STYLE_MARKER, '');
    style.textContent = chatScopedCss;
    container.prepend(style);
  }
  return { mode: 'style', cssText: chatScopedCss };
}

export function releaseChatStyles(container: HTMLElement): void {
  // Cleanup must use the root that adopted the sheet, even after DOM detachment.
  const shadowRoot = mountedRoots.get(container);
  if (shadowRoot) {
    mountedRoots.delete(container);
    const owners = rootOwners.get(shadowRoot);
    owners?.delete(container);
    if (!owners?.size) {
      rootOwners.delete(shadowRoot);
      shadowRoot.adoptedStyleSheets = shadowRoot.adoptedStyleSheets.filter((sheet) => sheet !== sharedChatSheet);
    }
  }
  container.querySelector(`[${CHAT_STYLE_MARKER}]`)?.remove();
}

export { chatScopedCss as compiledChatCss };
