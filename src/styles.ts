import cssText from './styles.css?inline';
import fontCssText from './fonts.css?inline';

export type StyleInjectionMode = 'adoptedStyleSheets' | 'style';

export interface StyleInjectionResult {
  mode: StyleInjectionMode;
  cssText: string;
}

const sharedSheets = new Map<string, CSSStyleSheet>();

export function injectDocumentFonts(doc: Document, assetBase?: string): HTMLStyleElement {
  const base = assetBase ?? './';
  const existing = Array.from(doc.head.querySelectorAll<HTMLStyleElement>('style[data-l4-widget-fonts]'))
    .find((style) => style.getAttribute('data-asset-base') === base);
  if (existing) return existing;
  const style = doc.createElement('style');
  style.setAttribute('data-l4-widget-fonts', '');
  style.setAttribute('data-asset-base', base);
  style.textContent = fontCssText.replaceAll('__L4_ASSET_BASE__', base);
  doc.head.appendChild(style);
  return style;
}

export function removeDocumentFonts(doc: Document): void {
  doc.head.querySelectorAll('style[data-l4-widget-fonts]').forEach((style) => style.remove());
}

function supportsConstructableStyleSheets(shadowRoot: ShadowRoot): boolean {
  return (
    'adoptedStyleSheets' in shadowRoot &&
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype
  );
}

export function injectWidgetStyles(
  shadowRoot: ShadowRoot,
  options: { forceFallback?: boolean; assetBase?: string } = {},
): StyleInjectionResult {
  const resolvedCss = cssText;
  if (!options.forceFallback && supportsConstructableStyleSheets(shadowRoot)) {
    let sharedSheet = sharedSheets.get(resolvedCss);
    if (!sharedSheet) {
      sharedSheet = new CSSStyleSheet();
      sharedSheet.replaceSync(resolvedCss);
      sharedSheets.set(resolvedCss, sharedSheet);
    }
    if (!shadowRoot.adoptedStyleSheets.includes(sharedSheet)) {
      shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sharedSheet];
    }
    return { mode: 'adoptedStyleSheets', cssText: resolvedCss };
  }

  if (!shadowRoot.querySelector('style[data-l4-widget-styles]')) {
    const style = document.createElement('style');
    style.setAttribute('data-l4-widget-styles', '');
    style.textContent = resolvedCss;
    shadowRoot.prepend(style);
  }
  return { mode: 'style', cssText: resolvedCss };
}

export { cssText as compiledTailwindCss };
