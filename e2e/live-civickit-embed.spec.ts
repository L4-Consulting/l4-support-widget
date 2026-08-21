import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('built CivicKit embed renders and loads fonts beside a non-root widget script', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const fontRequests: string[] = [];
  const thirdPartyFontRequests: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const url = request.url();
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url)) thirdPartyFontRequests.push(url);
  });

  await page.route('http://localhost:4173/releases/widget/v1/l4-support-widget.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: await readFile(resolve('dist/l4-support-widget.js')),
    });
  });
  await page.route('http://localhost:4173/releases/widget/v1/l4-support-widget-fonts/*.woff2', async (route) => {
    fontRequests.push(route.request().url());
    await route.fulfill({
      contentType: 'font/woff2',
      body: await readFile(resolve('dist/l4-support-widget-fonts', basename(new URL(route.request().url()).pathname))),
    });
  });

  await page.goto('/e2e/fixtures/civickit-live.html');
  const host = page.locator('l4-support-widget');
  await expect(host).toHaveAttribute('product-key', 'civickit');
  await expect(host).toHaveAttribute('asset-base', 'http://localhost:4173/releases/widget/v1/');
  expect(consoleErrors).toEqual([]);
  await expect(host.locator('[data-l4-launcher]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  expect(pageErrors).toEqual([]);
  expect(thirdPartyFontRequests).toEqual([]);
  expect(fontRequests.length).toBeGreaterThan(0);
  expect(fontRequests.every((url) => url.startsWith('http://localhost:4173/releases/widget/v1/l4-support-widget-fonts/'))).toBe(true);
});
