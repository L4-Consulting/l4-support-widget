import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';

const root = resolve(import.meta.dirname, '..');
const globalPath = resolve(root, 'dist/l4-support-widget.js');
const chatPath = resolve(root, 'dist/l4-support-widget-chat.js');
const unrelatedBlockedPath = resolve(root, 'e2e/fixtures/unrelated-blocked.js');

function serveFiles(port: number, cors: boolean, files: Record<string, string>): http.Server {
  return http.createServer((req, res) => {
    if (cors) res.setHeader('Access-Control-Allow-Origin', '*');
    const path = req.url?.split('?')[0] ?? '/';
    const file = files[path];
    if (!file || !existsSync(file)) {
      res.statusCode = 404;
      res.end('missing');
      return;
    }
    res.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : 'text/html');
    res.end(readFileSync(file));
  }).listen(port);
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

test.describe('chat loader via built global widget (two origins)', () => {
  test.beforeAll(() => {
    if (!existsSync(globalPath) || !existsSync(chatPath)) {
      throw new Error('Run npm run build:release before e2e chat tests.');
    }
  });

  test('valid cross-origin execution loads chat asset', async ({ page }) => {
    const host = serveFiles(5299, false, { '/': resolve(root, 'e2e/fixtures/chat-widget-host.html') });
    const asset = serveFiles(5300, true, {
      '/l4-support-widget.js': globalPath,
      '/l4-support-widget-chat.js': chatPath,
    });
    try {
      await mockSupportApi(page);
      await page.goto('http://127.0.0.1:5299/');
      await page.waitForFunction(() => Boolean((window as Window & { L4SupportChat?: unknown }).L4SupportChat));
      await expect(page.locator('l4-support-widget [data-l4-chat-mount] textarea')).toBeVisible();
      const textareaRadius = await page.evaluate(() => {
        const host = document.querySelector('l4-support-widget');
        const chatMount = host?.shadowRoot?.querySelector('[data-l4-chat-mount]');
        const textarea = chatMount?.querySelector('textarea');
        if (!textarea) return null;
        return getComputedStyle(textarea).borderRadius;
      });
      expect(textareaRadius).toBe('10px');
      const pageErrors = await page.evaluate(() => (window as Window & { __l4ConsoleErrors?: string[] }).__l4ConsoleErrors ?? []);
      expect(pageErrors).toEqual([]);
    } finally {
      host.close();
      asset.close();
    }
  });

  test('tampered chat bytes do not execute chat runtime', async ({ page }) => {
    const tampered = `${readFileSync(chatPath, 'utf8')}\nwindow.__tampered=true;\n`;
    const host = serveFiles(5301, false, { '/': resolve(root, 'e2e/fixtures/chat-widget-host.html') });
    const asset = http
      .createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.url?.includes('chat')) res.end(tampered);
        else res.end(readFileSync(globalPath));
      })
      .listen(5302);
    try {
      await mockSupportApi(page);
      const chatRequest = page.waitForRequest((req) => req.url().includes('l4-support-widget-chat.js'));
      await page.goto('http://127.0.0.1:5301/');
      await chatRequest;
      await page.waitForSelector('#fallback:not([hidden])');
      const loaded = await page.evaluate(() => ({
        runtime: Boolean((window as Window & { L4SupportChat?: unknown }).L4SupportChat),
        tampered: Boolean((window as Window & { __tampered?: boolean }).__tampered),
      }));
      expect(loaded.runtime).toBe(false);
      expect(loaded.tampered).toBe(false);
    } finally {
      host.close();
      asset.close();
    }
  });

  test('missing CORS blocks chat execution', async ({ page }) => {
    const host = serveFiles(5303, false, { '/': resolve(root, 'e2e/fixtures/chat-widget-host.html') });
    const asset = http
      .createServer((req, res) => {
        const path = req.url?.split('?')[0] ?? '/';
        if (path.endsWith('/l4-support-widget.js')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(readFileSync(globalPath));
          return;
        }
        if (path.endsWith('/l4-support-widget-chat.js')) {
          res.end(readFileSync(chatPath));
          return;
        }
        res.statusCode = 404;
        res.end('missing');
      })
      .listen(5304);
    try {
      await mockSupportApi(page);
      const chatRequest = page.waitForRequest((req) => req.url().includes('l4-support-widget-chat.js'));
      await page.goto('http://127.0.0.1:5303/');
      await chatRequest;
      await page.waitForSelector('#fallback:not([hidden])', { timeout: 15_000 });
      const loaded = await page.evaluate(() => Boolean((window as Window & { L4SupportChat?: unknown }).L4SupportChat));
      expect(loaded).toBe(false);
    } finally {
      host.close();
      asset.close();
    }
  });

  test('destroy during delayed chat load allows re-init without resurrecting stale runtime', async ({ page }) => {
    const host = serveFiles(5320, false, { '/': resolve(root, 'e2e/fixtures/chat-widget-host.html') });
    const asset = serveFiles(5321, true, {
      '/l4-support-widget.js': globalPath,
      '/l4-support-widget-chat.js': chatPath,
    });
    try {
      await mockSupportApi(page);
      let releaseChat: () => void = () => undefined;
      const chatGate = new Promise<void>((resolve) => {
        releaseChat = resolve;
      });
      await page.route('**/l4-support-widget-chat.js', async (route) => {
        await chatGate;
        await route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: readFileSync(chatPath),
        });
      });
      const firstChatRequest = page.waitForRequest((req) => req.url().includes('l4-support-widget-chat.js'));
      await page.goto('http://127.0.0.1:5320/', { waitUntil: 'domcontentloaded' });
      await firstChatRequest;
      await page.evaluate(() => window.L4Support.destroy());
      await expect(page.locator('l4-support-widget')).toHaveCount(0);
      releaseChat();
      await page.evaluate(() => {
        window.L4Support.init({
          productKey: 'pk',
          apiBase: 'https://api.example.test',
          getToken: () => 'tok',
          tabs: ['support'],
          chat: { enabled: true },
        });
        window.L4Support.open();
      });
      await page.waitForFunction(() => Boolean((window as Window & { L4SupportChat?: unknown }).L4SupportChat));
      await expect(page.locator('l4-support-widget [data-l4-chat-mount] textarea')).toBeVisible();
      await expect(page.locator('l4-support-widget')).toHaveCount(1);
    } finally {
      host.close();
      asset.close();
    }
  });
});

test('direct DOM detach during asset load stays unmounted and reattaches cleanly', async ({ page }) => {
  const host = serveFiles(5360, false, { '/': resolve(root, 'e2e/fixtures/chat-widget-host.html') });
  const asset = serveFiles(5361, true, {
    '/l4-support-widget.js': globalPath,
    '/l4-support-widget-chat.js': chatPath,
  });
  try {
    await mockSupportApi(page);
    let releaseChat!: () => void;
    const gate = new Promise<void>((resolve) => { releaseChat = resolve; });
    await page.route('**/l4-support-widget-chat.js', async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/javascript',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: readFileSync(chatPath) });
    });
    const requested = page.waitForRequest((request) => request.url().includes('l4-support-widget-chat.js'));
    await page.goto('http://127.0.0.1:5360/', { waitUntil: 'domcontentloaded' });
    await requested;
    const detached = await page.evaluateHandle(() => {
      const element = document.querySelector('l4-support-widget')!;
      element.remove();
      return element;
    });
    releaseChat();
    await page.waitForFunction(() => Boolean(window.L4SupportChat));
    await expect(page.locator('l4-support-widget')).toHaveCount(0);
    expect(await detached.evaluate((element) => element.shadowRoot?.querySelector('[data-l4-chat-mount]'))).toBeNull();
    await detached.evaluate((element) => { document.body.appendChild(element); window.L4Support.open(); });
    await expect(page.locator('l4-support-widget [data-l4-chat-mount] textarea')).toBeVisible();
    await expect(page.locator('l4-support-widget [data-l4-chat-mount]')).toHaveCount(1);
    await page.evaluate(() => window.L4Support.destroy());
    await expect(page.locator('l4-support-widget')).toHaveCount(0);
  } finally {
    host.close();
    asset.close();
  }
});

test.describe('chat loader CSP (same-origin enforcement)', () => {
  test('blocks dynamic chat script and emits chat_blocked_by_csp', async ({ page }) => {
    const port = 5310;
    const server = serveFiles(port, false, {
      '/': resolve(root, 'e2e/fixtures/chat-widget-host-csp.html'),
      '/l4-support-widget.js': globalPath,
      '/l4-support-widget-chat.js': chatPath,
      '/unrelated-blocked.js': unrelatedBlockedPath,
    });
    try {
      await mockSupportApi(page);
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(
        () => (window as Window & { __l4CspEvents?: string[] }).__l4CspEvents?.includes('chat_blocked_by_csp'),
        { timeout: 15_000 },
      );
      await page.waitForSelector('#fallback:not([hidden])');
      const state = await page.evaluate(() => ({
        events: (window as Window & { __l4CspEvents?: string[] }).__l4CspEvents ?? [],
        violations: (window as Window & { __violations?: string[] }).__violations ?? [],
        runtime: Boolean((window as Window & { L4SupportChat?: unknown }).L4SupportChat),
        chatMount: Boolean(document.querySelector('l4-support-widget')?.shadowRoot?.querySelector('[data-l4-chat-mount]')),
      }));
      expect(state.events.filter((e) => e === 'chat_blocked_by_csp').length).toBe(1);
      expect(state.violations.some((uri) => uri.includes('l4-support-widget-chat.js'))).toBe(true);
      expect(state.runtime).toBe(false);
      expect(state.chatMount).toBe(false);
    } finally {
      server.close();
    }
  });
});

test.describe('chat strict style-src (no unsafe-inline)', () => {
  test.beforeAll(() => {
    if (!existsSync(globalPath) || !existsSync(chatPath)) {
      throw new Error('Run npm run build:release before e2e chat tests.');
    }
  });

  test('chat composer keeps rounded corners under style-src without unsafe-inline', async ({ page }) => {
    const port = 5315;
    const server = serveFiles(port, false, {
      '/': resolve(root, 'e2e/fixtures/chat-widget-host-strict-style-csp.html'),
      '/l4-support-widget.js': globalPath,
      '/l4-support-widget-chat.js': chatPath,
    });
    try {
      await mockSupportApi(page);
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(() => Boolean((window as Window & { L4SupportChat?: unknown }).L4SupportChat));
      await expect(page.locator('l4-support-widget [data-l4-chat-mount] textarea')).toBeVisible();
      const textareaRadius = await page.evaluate(() => {
        const host = document.querySelector('l4-support-widget');
        const chatMount = host?.shadowRoot?.querySelector('[data-l4-chat-mount]');
        const textarea = chatMount?.querySelector('textarea');
        if (!textarea) return null;
        return getComputedStyle(textarea).borderRadius;
      });
      expect(textareaRadius).toBe('10px');
      const pageErrors = await page.evaluate(() => (window as Window & { __l4ConsoleErrors?: string[] }).__l4ConsoleErrors ?? []);
      expect(pageErrors).toEqual([]);
      expect(await page.evaluate(() => (window as Window & { __l4StyleViolations?: string[] }).__l4StyleViolations ?? [])).toEqual([]);
    } finally {
      server.close();
    }
  });
});
