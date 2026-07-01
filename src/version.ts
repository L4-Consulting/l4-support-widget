// Injected at build time from package.json via Vite `define` is avoided here to
// keep the ESM build side-effect-free and tree-shake-friendly; instead the value
// is stamped by the build through the __L4_WIDGET_VERSION__ constant.
declare const __L4_WIDGET_VERSION__: string;

/** Semver of this widget build. Wired to package.json `version`. */
export const version: string =
  typeof __L4_WIDGET_VERSION__ !== 'undefined' ? __L4_WIDGET_VERSION__ : '0.0.0-dev';
