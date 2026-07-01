import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __L4_WIDGET_VERSION__: JSON.stringify('0.1.0-test'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    // Playwright specs live in e2e/ and must not be picked up by Vitest.
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
});
