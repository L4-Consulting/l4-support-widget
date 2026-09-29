import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('built flag-off global preserves polling, authenticated requests, and public globals', async ({ page }) => {
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  await page.route('https://api.example.test/**', async (route) => {
    requests.push({ url: route.request().url(), authorization: route.request().headers().authorization });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cases: [] }) });
  });
  await page.clock.install();
  await page.setContent('<!doctype html><html><body></body></html>');
  const before = await page.evaluate(() => Object.getOwnPropertyNames(window));
  await page.addScriptTag({ content: readFileSync(resolve('dist/l4-support-widget.js'), 'utf8') });
  const addedGlobals = await page.evaluate((names) => Object.getOwnPropertyNames(window).filter((name) => !names.includes(name)), before);
  expect(addedGlobals.sort()).toEqual(['L4Support']);
  await page.evaluate(() => window.L4Support.init({
    productKey: 'civickit', apiBase: 'https://api.example.test', getToken: () => 'synthetic-token', tabs: ['support', 'help'],
  }));
  await expect(page.locator('l4-support-widget [data-l4-launcher]')).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  await page.clock.runFor(19_999);
  expect(requests).toHaveLength(1);
  await page.clock.runFor(1);
  await expect.poll(() => requests.length).toBe(2);
  await page.evaluate(() => window.L4Support.open());
  await expect(page.locator('l4-support-widget [data-l4-state="empty"]')).toBeVisible();
  await expect.poll(() => requests.length).toBe(3);
  await page.clock.runFor(40_000);
  expect(requests).toHaveLength(3);
  await page.locator('l4-support-widget [data-l4-close-panel]').click();
  await expect.poll(() => requests.length).toBe(4);
  await page.clock.runFor(20_000);
  await expect.poll(() => requests.length).toBe(5);
  expect(requests.every((request) => request.url === 'https://api.example.test/api/client/support/cases' && request.authorization === 'Bearer synthetic-token')).toBe(true);
  await expect(page.locator('script[src*="l4-support-widget-chat.js"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.L4SupportChat)).toBeUndefined();
  await page.evaluate(() => window.L4Support.destroy());
  await expect(page.locator('l4-support-widget')).toHaveCount(0);
  await page.clock.runFor(40_000);
  expect(requests).toHaveLength(5);
});
