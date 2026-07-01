import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};
const VERSION_DEFINE = { __L4_WIDGET_VERSION__: JSON.stringify(pkg.version) };

/**
 * Two build entries (v2 plan, BLOCKER B2) — selected by Vite `--mode`:
 *
 *  `--mode global`  src/global.ts  -> IIFE  `dist/l4-support-widget.js`
 *     Side-effectful <script> embed. Self-registers the custom element and
 *     writes `window.L4Support`. BUNDLES its own React runtime so a non-React
 *     (or differently-versioned-React) host page loads standalone.
 *
 *  `--mode esm`     src/index.ts   -> ESM   `dist/index.js`  (@l4/support-widget)
 *     Side-effect-free. Exports { init, setTokenProvider, version } and
 *     registers the element LAZILY inside init(). React / ReactDOM are
 *     EXTERNAL here so React host apps dedupe on their own copy.
 *
 * package.json `build:only` runs both modes sequentially into the same dist/.
 */
const EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'];

export default defineConfig(({ mode }) => {
  const isGlobal = mode === 'global';

  if (isGlobal) {
    // IIFE — bundles React, side-effectful standalone <script> entry.
    return {
      plugins: [react(), tailwindcss()],
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        ...VERSION_DEFINE,
      },
      build: {
        emptyOutDir: true,
        lib: {
          entry: resolve(__dirname, 'src/global.ts'),
          name: 'L4Support',
          formats: ['iife'],
          fileName: () => 'l4-support-widget.js',
        },
      },
    };
  }

  // ESM — side-effect-free, React external. Runs second so it must not wipe dist/.
  return {
    plugins: [react(), tailwindcss()],
    define: {
      ...VERSION_DEFINE,
    },
    build: {
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        formats: ['es'],
        fileName: () => 'index.js',
      },
      rollupOptions: {
        external: EXTERNAL,
      },
    },
  };
});
