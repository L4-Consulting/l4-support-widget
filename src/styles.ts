import cssText from './styles.css?inline';

export type StyleInjectionMode = 'adoptedStyleSheets' | 'style';

export interface StyleInjectionResult {
  mode: StyleInjectionMode;
  cssText: string;
}

const FONT_LINK_ID = 'l4-support-widget-fonts';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap';
let sharedSheet: CSSStyleSheet | null = null;

function supportsConstructableStyleSheets(shadowRoot: ShadowRoot): boolean {
  return (
    'adoptedStyleSheets' in shadowRoot &&
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype
  );
}

export function injectDocumentFonts(doc: Document = document): HTMLLinkElement | null {
  if (typeof doc === 'undefined') return null;

  const existing = doc.getElementById(FONT_LINK_ID);
  if (existing instanceof HTMLLinkElement) return existing;

  const link = doc.createElement('link');
  link.id = FONT_LINK_ID;
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  doc.head.appendChild(link);
  return link;
}

export function removeDocumentFonts(doc: Document = document): void {
  doc.getElementById(FONT_LINK_ID)?.remove();
}

export function injectWidgetStyles(
  shadowRoot: ShadowRoot,
  options: { forceFallback?: boolean } = {},
): StyleInjectionResult {
  if (!options.forceFallback && supportsConstructableStyleSheets(shadowRoot)) {
    if (!sharedSheet) {
      sharedSheet = new CSSStyleSheet();
      sharedSheet.replaceSync(cssText);
    }
    if (!shadowRoot.adoptedStyleSheets.includes(sharedSheet)) {
      shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sharedSheet];
    }
    return { mode: 'adoptedStyleSheets', cssText };
  }

  if (!shadowRoot.querySelector('style[data-l4-widget-styles]')) {
    const style = document.createElement('style');
    style.setAttribute('data-l4-widget-styles', '');
    style.textContent = cssText;
    shadowRoot.prepend(style);
  }
  return { mode: 'style', cssText };
}

export { cssText as compiledTailwindCss };
