import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import * as esbuild from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const esmDistPath = resolve(root, 'dist/index.js');
const chatPath = resolve(root, 'dist/l4-support-widget-chat.js');
const generatedDir = resolve(root, 'e2e/fixtures/.generated');
const bundledHostPath = resolve(generatedDir, 'esm-module-host.js');

function serveFiles(port: number, cors: boolean, files: Record<string, string>): http.Server {
  return http
    .createServer((req, res) => {
      if (cors) res.setHeader('Access-Control-Allow-Origin', '*');
      const path = req.url?.split('?')[0] ?? '/';
      const file = files[path];
      if (!file || !existsSync(file)) {
        res.statusCode = 404;
        res.end('missing');
        return;
      }
      const type = path.endsWith('.js') ? 'application/javascript' : 'text/html';
      res.setHeader('Content-Type', type);
      res.end(readFileSync(file));
    })
    .listen(port);
}

async function mockSupportApi(page: import('@playwright/test').Page) {
  await page.route('https://api.example.test/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/stream')) {
      await route.fulfill({ status: 503, body: 'unavailable' });
      return;
    }
    if (url.includes('/cases/') && !url.endsWith('/cases')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          case: { id: 'c1', subject: 'Test', status: 'open', created_at: '2026-01-01T00:00:00Z', category: 'other' },
          messages: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cases: [{ id: 'c1', subject: 'Test', status: 'open', updated_at: '2026-01-01T00:00:00Z' }] }),
    });
  });
}

test.describe('ESM package host with explicit chat.assetUrl', () => {
  const hostPort = 5330;
  const modulePort = 5331;
  const chatPort = 5332;

  test.beforeAll(async () => {
    if (!existsSync(esmDistPath) || !existsSync(chatPath)) {
      throw new Error('Run npm run build:release before ESM chat e2e tests.');
    }
    mkdirSync(generatedDir, { recursive: true });
    await esbuild.build({
      absWorkingDir: root,
      entryPoints: [resolve(root, 'e2e/fixtures/esm-module-host-entry.ts')],
      bundle: true,
      format: 'esm',
      outfile: bundledHostPath,
      platform: 'browser',
      target: 'es2020',
      logLevel: 'silent',
    });
  });

  test('loads chat when currentScript is null and assetUrl is explicit', async ({ page }) => {
    const htmlPath = resolve(root, 'e2e/fixtures/esm-module-host.html');
    const host = serveFiles(hostPort, false, {
      '/': htmlPath,
    });
    const moduleServer = serveFiles(modulePort, true, {
      '/esm-module-host.js': bundledHostPath,
    });
    const chatServer = serveFiles(chatPort, true, {
      '/l4-support-widget-chat.js': chatPath,
    });
    try {
      await mockSupportApi(page);
      await page.goto(
        `http://127.0.0.1:${hostPort}/?hostPort=${hostPort}&modulePort=${modulePort}&chatPort=${chatPort}&mode=explicit`,
      );
      await page.waitForFunction(() => Boolean((window as Window & { L4SupportChat?: unknown }).L4SupportChat));
      await expect(page.locator('l4-support-widget [data-l4-chat-mount] textarea')).toBeVisible();
      const state = await page.evaluate(() => {
        const hostEl = document.querySelector('l4-support-widget');
        const textarea = hostEl?.shadowRoot?.querySelector('[data-l4-chat-mount] textarea');
        return {
          currentScriptAtEval: (window as Window & { __l4CurrentScriptAtEval?: string }).__l4CurrentScriptAtEval,
          textareaRadius: textarea ? getComputedStyle(textarea).borderRadius : null,
          pageErrors: (window as Window & { __l4ConsoleErrors?: string[] }).__l4ConsoleErrors ?? [],
          loadedGlobalIife: Boolean((window as Window & { L4Support?: unknown }).L4Support),
        };
      });
      expect(state.currentScriptAtEval).toBe('null');
      expect(state.loadedGlobalIife).toBe(false);
      expect(state.textareaRadius).toBe('10px');
      expect(state.pageErrors).toEqual([]);
    } finally {
      host.close();
      moduleServer.close();
      chatServer.close();
    }
  });

  test('chat flag off does not fetch the chat IIFE', async ({ page }) => {
    const htmlPath = resolve(root, 'e2e/fixtures/esm-module-host.html');
    const host = serveFiles(5340, false, { '/': htmlPath });
    const moduleServer = serveFiles(5341, true, { '/esm-module-host.js': bundledHostPath });
    const chatServer = serveFiles(5342, true, { '/l4-support-widget-chat.js': chatPath });
    try {
      await mockSupportApi(page);
      let chatRequested = false;
      page.on('request', (req) => {
        if (req.url().includes('l4-support-widget-chat.js')) chatRequested = true;
      });
      await page.goto(
        `http://127.0.0.1:5340/?hostPort=5340&modulePort=5341&chatPort=5342&mode=off`,
      );
      await page.waitForSelector('l4-support-widget', { state: 'attached' });
      await page.waitForTimeout(800);
      expect(chatRequested).toBe(false);
    } finally {
      host.close();
      moduleServer.close();
      chatServer.close();
    }
  });

  test('enabled without assetUrl fails closed when currentScript is null', async ({ page }) => {
    const htmlPath = resolve(root, 'e2e/fixtures/esm-module-host.html');
    const host = serveFiles(5350, false, { '/': htmlPath });
    const moduleServer = serveFiles(5351, true, { '/esm-module-host.js': bundledHostPath });
    try {
      await mockSupportApi(page);
      const warnings: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'warning') warnings.push(msg.text());
      });
      let chatRequested = false;
      page.on('request', (req) => {
        if (req.url().includes('l4-support-widget-chat.js')) chatRequested = true;
      });
      await page.goto(
        `http://127.0.0.1:5350/?hostPort=5350&modulePort=5351&chatPort=5352&mode=no-asset`,
      );
      await page.waitForSelector('#fallback:not([hidden])', { timeout: 15_000 });
      expect(chatRequested).toBe(false);
      expect(warnings.some((line) => line.includes('chat unavailable'))).toBe(true);
    } finally {
      host.close();
      moduleServer.close();
    }
  });
});
