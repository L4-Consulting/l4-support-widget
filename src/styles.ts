import cssText from './styles.css?inline';

export type StyleInjectionMode = 'adoptedStyleSheets' | 'style';

export interface StyleInjectionResult {
  mode: StyleInjectionMode;
  cssText: string;
}

let sharedSheet: CSSStyleSheet | null = null;

function supportsConstructableStyleSheets(shadowRoot: ShadowRoot): boolean {
  return (
    'adoptedStyleSheets' in shadowRoot &&
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype
  );
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
