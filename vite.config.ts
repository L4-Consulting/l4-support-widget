import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};
const BUILD_ID = `w2-chat-${pkg.version}`;
const VERSION_DEFINE = { __L4_WIDGET_VERSION__: JSON.stringify(pkg.version) };

/**
 * Build entries (selected by Vite `--mode`):
 *
 *  `--mode global`  src/global.ts  -> IIFE  `dist/l4-support-widget.js`
 *  `--mode esm`     src/index.ts   -> ESM   `dist/index.js`
 *  `--mode chat`    src/chat/main.ts -> IIFE `dist/l4-support-widget-chat.js`
 */
const EXTERNAL = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'];

export default defineConfig(({ mode }) => {
  const isGlobal = mode === 'global';
  const isChat = mode === 'chat';

  if (isChat) {
    return {
      plugins: [react()],
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        ...VERSION_DEFINE,
        __L4_WIDGET_BUILD_ID__: JSON.stringify(BUILD_ID),
      },
      build: {
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/chat/main.ts'),
          name: 'L4SupportChat',
          formats: ['iife'],
          fileName: () => 'l4-support-widget-chat.js',
        },
      },
    };
  }

  if (isGlobal) {
    return {
      plugins: [react(), tailwindcss()],
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        ...VERSION_DEFINE,
        __L4_WIDGET_BUILD_ID__: JSON.stringify(BUILD_ID),
      },
      build: {
        // Release order builds chat first; do not delete l4-support-widget-chat.js.
        emptyOutDir: false,
        minify: 'terser',
        terserOptions: {
          ecma: 2015,
          compress: {
            passes: 2,
          },
          mangle: true,
          format: {
            comments: /@license|@preserve|^!/,
          },
        },
        lib: {
          entry: resolve(__dirname, 'src/global.ts'),
          name: 'L4Support',
          formats: ['iife'],
          fileName: () => 'l4-support-widget.js',
        },
      },
    };
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      ...VERSION_DEFINE,
      __L4_WIDGET_BUILD_ID__: JSON.stringify(BUILD_ID),
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
