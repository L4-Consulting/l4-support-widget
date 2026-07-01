# Tailwind 4 in Shadow DOM Spike Findings

Date: 2026-07-01  
Branch: `spike/tailwind-in-shadow`

## Scope

This spike proves the reusable shell mechanics for `l4-support-widget` before any Help, Support, or Roadmap tab UI is built. The demo panel is intentionally minimal and exists only to exercise Tailwind 4 CSS, Shadow DOM isolation, in-shadow portals, a shadow-aware focus trap, and document-level font loading.

## Findings

### 1. Tailwind 4 CSS injection

PASS.

Tailwind 4 is compiled by Vite through `@tailwindcss/vite`, imported as a processed string with `styles.css?inline`, and injected by `src/styles.ts`.

Default path:

- `injectWidgetStyles()` creates a Constructable StyleSheet with `new CSSStyleSheet()`.
- The compiled Tailwind CSS is loaded through `replaceSync()`.
- The sheet is attached to the widget shadow root with `shadowRoot.adoptedStyleSheets`.

Fallback path:

- If Constructable StyleSheets are unavailable, or the element sets `style-mode="fallback"`, `injectWidgetStyles()` inserts `<style data-l4-widget-styles>` into the shadow root.
- The fallback is for old WebViews and stricter environments where `adoptedStyleSheets` cannot be used.

What changed from standard Tailwind 4 setup:

- Standard app setup would import Tailwind CSS once at document level. That does not isolate the widget and does not put rules into the shadow root.
- The widget imports the compiled CSS as text and injects it per shadow root.
- Tailwind 4 base/theme output includes document-oriented selectors and theme registration that are not enough by themselves for a shadow-root widget. `src/styles.css` adds a shadow-specific base layer on `:host` and `:host *`, including `all: initial`, `box-sizing`, widget font, text color, and form/button font inheritance.
- Widget-specific theme values are declared in `@theme`, including `--font-l4-spike` and `--color-l4-accent`, so utilities resolve inside the adopted/fallback shadow stylesheet.

Proof: `e2e/shadow-spike.spec.ts`, test `Tailwind 4 CSS is compiled and injected via adoptedStyleSheets, with a style fallback path`.

### 2. Style isolation

PASS.

Host CSS is deliberately hostile in `demo/index.html`: it applies `Georgia`, red text, and red borders globally with `!important`. Playwright verifies those host rules do not affect the widget's internal button color, border color, or font family.

The widget CSS also stays inside the shadow root. The host page includes Tailwind-looking classes such as `rounded bg-l4-accent p-4 text-white`; Playwright verifies those classes do not receive Tailwind padding, border radius, or background outside the widget.

Note: Tailwind `@property` / `@keyframes` registration is document-scoped by browser design and is not treated as a CSS rule leakage failure. The tested isolation boundary is selector/declaration application.

Proof: `e2e/shadow-spike.spec.ts`, test `style isolation works in both directions across the shadow boundary`.

### 3. Portals and overlays

PASS.

`src/element.ts` creates a dedicated in-shadow portal container:

- `[data-l4-widget-root]` for the React mount.
- `[data-l4-portal-root]` for overlays.

`src/portal.tsx` wraps `createPortal()` and requires an explicit `container`. The demo modal renders into `[data-l4-portal-root]`, never `document.body`.

Proof: `e2e/shadow-spike.spec.ts`, test `portal modal renders into the in-shadow portal container and is Tailwind styled`.

### 4. Shadow-aware focus trap

PASS.

`src/focus-trap.ts` implements a small focus trap that listens on the `ShadowRoot` and reads `shadowRoot.activeElement`. It does not use `document.activeElement` for modal focus decisions, because the light DOM active element stops at the custom element boundary.

Behavior proved:

- Initial focus lands inside the modal.
- `Tab` cycles through focusable controls.
- `Shift+Tab` wraps backward.
- `Escape` closes the modal.

Proof: `e2e/shadow-spike.spec.ts`, test `shadow-aware focus trap cycles with Tab and Shift+Tab, and Escape closes`.

### 5. Fonts loaded from document head

PASS.

`src/styles.ts` injects one document-level `<style id="l4-support-widget-fonts">` into `document.head` containing an `@font-face` rule for `"L4 Spike Shadow Font"`. The shadow stylesheet then applies that family inside the widget through `--font-l4-spike`.

This matches the later production requirement: font faces are registered at the real document level, while widget style rules remain inside the shadow root.

Proof: `e2e/shadow-spike.spec.ts`, test `document-head font face loads and applies inside the shadow-rendered widget`.

## Other gotchas found

- The existing IIFE build exported a nested global shape: `window.L4Support.L4Support.init`. The demo and embed contract need `window.L4Support.init`, so `src/global.ts` now exports `init`, `setTokenProvider`, and `version` directly.
- The custom element host itself does not need a visible layout box; tests must wait for the element to be attached and then inspect rendered internals through `shadowRoot`.
- Real CSS, style isolation, focus cycling, and font loading must stay in Playwright. Vitest/jsdom remains limited to registration and DOM-structure logic.

## Verification

Required local sequence:

- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm run test:e2e`

Bundle report after spike:

- IIFE: `dist/l4-support-widget.js`
- Gzip size observed locally: `66.17 KB`
- This is expected to be larger than the pre-spike smoke build and remains report-only for this spike.
