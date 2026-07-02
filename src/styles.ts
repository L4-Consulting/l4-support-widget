import cssText from './styles.css?inline';

export type StyleInjectionMode = 'adoptedStyleSheets' | 'style';

export interface StyleInjectionResult {
  mode: StyleInjectionMode;
  cssText: string;
}

const FONT_STYLE_ID = 'l4-support-widget-fonts';
let sharedSheet: CSSStyleSheet | null = null;

function supportsConstructableStyleSheets(shadowRoot: ShadowRoot): boolean {
  return (
    'adoptedStyleSheets' in shadowRoot &&
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype
  );
}

export function injectDocumentFonts(doc: Document = document): HTMLStyleElement | null {
  if (typeof doc === 'undefined') return null;

  const existing = doc.getElementById(FONT_STYLE_ID);
  if (existing instanceof HTMLStyleElement) return existing;

  const style = doc.createElement('style');
  style.id = FONT_STYLE_ID;
  style.textContent = `
@font-face {
  font-family: "L4 Spike Shadow Font";
  src: local("Courier New"), local("Courier"), local("Liberation Mono"), local("Menlo");
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
}
`;
  doc.head.appendChild(style);
  return style;
}

export function removeDocumentFonts(doc: Document = document): void {
  doc.getElementById(FONT_STYLE_ID)?.remove();
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
