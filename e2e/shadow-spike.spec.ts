import { expect, test, type Page } from '@playwright/test';

async function mockSupportApi(page: Page) {
  await page.route('https://api.l4consulting.net/api/client/support/cases', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cases: [] }),
    });
  });
}

async function waitForWidget(page: Page) {
  await mockSupportApi(page);
  await page.goto('/demo/index.html');
  await page.waitForSelector('l4-support-widget', { state: 'attached' });
  await page.waitForFunction(() => {
    const host = document.querySelector('l4-support-widget');
    return Boolean(host?.shadowRoot?.querySelector('[data-l4-launcher]'));
  });
}

async function waitForFallbackWidget(page: Page) {
  await mockSupportApi(page);
  await page.goto('/demo/index.html?styleMode=fallback');
  await page.waitForSelector('l4-support-widget', { state: 'attached' });
  await page.waitForFunction(() => {
    const host = document.querySelector('l4-support-widget');
    return host?.getAttribute('data-l4-style-mode') === 'style' && host.shadowRoot?.querySelector('[data-l4-launcher]');
  });
}

async function shadowEval<T>(page: Page, fn: (root: ShadowRoot) => T): Promise<T> {
  return page.evaluate((source) => {
    const host = document.querySelector('l4-support-widget');
    const root = host?.shadowRoot;
    if (!root) throw new Error('missing shadow root');
    const innerFn = (0, eval)(`(${source})`) as (shadowRoot: ShadowRoot) => T;
    return innerFn(root);
  }, fn.toString());
}

async function openPanel(page: Page) {
  await shadowEval(page, (root) => root.querySelector<HTMLElement>('[data-l4-launcher]')?.click());
  await page.waitForFunction(() => {
    const root = document.querySelector('l4-support-widget')?.shadowRoot;
    return Boolean(root?.querySelector('[data-l4-panel]'));
  });
}

test('Tailwind 4 CSS is compiled and injected via adoptedStyleSheets, with a style fallback path', async ({
  page,
}) => {
  await waitForWidget(page);

  const adopted = await shadowEval(page, (root) => {
    const launcher = root.querySelector<HTMLElement>('[data-l4-launcher]');
    if (!launcher) throw new Error('missing launcher');
    const buttonStyle = getComputedStyle(launcher);
    return {
      mode: (root.host as HTMLElement).getAttribute('data-l4-style-mode'),
      adoptedCount: root.adoptedStyleSheets.length,
      hasFallbackStyleTag: Boolean(root.querySelector('style[data-l4-widget-styles]')),
      cssHasTailwindLayer: root.adoptedStyleSheets.some((sheet) =>
        Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('.fixed')),
      ),
      launcherPosition: buttonStyle.position,
      launcherBackground: buttonStyle.backgroundColor,
      fontFamily: buttonStyle.fontFamily,
    };
  });

  expect(adopted.mode).toBe('adoptedStyleSheets');
  expect(adopted.adoptedCount).toBeGreaterThan(0);
  expect(adopted.hasFallbackStyleTag).toBe(false);
  expect(adopted.cssHasTailwindLayer).toBe(true);
  expect(adopted.launcherPosition).toBe('fixed');
  expect(adopted.launcherBackground).toBe('rgb(37, 99, 235)');
  expect(adopted.fontFamily).toContain('L4 Spike Shadow Font');

  await waitForFallbackWidget(page);
  const fallback = await shadowEval(page, (root) => {
    const launcher = root.querySelector<HTMLElement>('[data-l4-launcher]');
    if (!launcher) throw new Error('missing launcher');
    return {
      mode: (root.host as HTMLElement).getAttribute('data-l4-style-mode'),
      hasFallbackStyleTag: Boolean(root.querySelector('style[data-l4-widget-styles]')),
      buttonBackground: getComputedStyle(launcher).backgroundColor,
    };
  });
  expect(fallback.mode).toBe('style');
  expect(fallback.hasFallbackStyleTag).toBe(true);
  expect(fallback.buttonBackground).toBe('rgb(37, 99, 235)');
});

test('style isolation works in both directions across the shadow boundary', async ({ page }) => {
  await waitForWidget(page);

  const isolation = await page.evaluate(() => {
    const hostProbe = document.querySelector<HTMLElement>('[data-host-leak-probe]');
    const hostButton = document.querySelector<HTMLElement>('[data-host-button]');
    const root = document.querySelector('l4-support-widget')?.shadowRoot;
    const widgetButton = root?.querySelector<HTMLElement>('[data-l4-launcher]');
    if (!hostProbe || !hostButton || !widgetButton) throw new Error('missing probes');

    const hostProbeStyle = getComputedStyle(hostProbe);
    const hostButtonStyle = getComputedStyle(hostButton);
    const widgetButtonStyle = getComputedStyle(widgetButton);

    return {
      hostProbeBackground: hostProbeStyle.backgroundColor,
      hostProbePadding: hostProbeStyle.paddingTop,
      hostProbeRadius: hostProbeStyle.borderRadius,
      hostButtonColor: hostButtonStyle.color,
      widgetButtonColor: widgetButtonStyle.color,
      widgetButtonBorderColor: widgetButtonStyle.borderTopColor,
    };
  });

  expect(isolation.hostProbeBackground).toBe('rgba(0, 0, 0, 0)');
  expect(isolation.hostProbePadding).toBe('0px');
  expect(isolation.hostProbeRadius).toBe('0px');
  expect(isolation.hostButtonColor).toBe('rgb(127, 29, 29)');
  expect(isolation.widgetButtonColor).toBe('rgb(255, 255, 255)');
  expect(isolation.widgetButtonBorderColor).not.toBe('rgb(127, 29, 29)');
});

test('launcher opens and closes the panel, and only the support tab is visible', async ({ page }) => {
  await waitForWidget(page);
  await openPanel(page);

  const panel = await shadowEval(page, (root) => ({
    hasPanel: Boolean(root.querySelector('[data-l4-panel]')),
    supportTabs: root.querySelectorAll('[data-l4-tab="support"]').length,
    helpTabs: root.querySelectorAll('[data-l4-tab="help"]').length,
    roadmapTabs: root.querySelectorAll('[data-l4-tab="roadmap"]').length,
  }));
  expect(panel).toEqual({ hasPanel: true, supportTabs: 1, helpTabs: 0, roadmapTabs: 0 });

  await shadowEval(page, (root) => root.querySelector<HTMLElement>('[data-l4-close-panel]')?.click());
  await expect.poll(() => shadowEval(page, (root) => Boolean(root.querySelector('[data-l4-panel]')))).toBe(false);
});

test('shadow-aware focus trap cycles inside the panel and Escape closes it', async ({ page }) => {
  await waitForWidget(page);
  await openPanel(page);
  await page.waitForFunction(() => {
    const root = document.querySelector('l4-support-widget')?.shadowRoot;
    return root?.activeElement?.hasAttribute('data-l4-close-panel');
  });

  const activeDescriptor = () =>
    shadowEval(page, (root) => ({
      tag: root.activeElement?.tagName,
      attrs: Array.from(root.activeElement?.attributes ?? []).map((attr) => attr.name).join(' '),
    }));

  expect((await activeDescriptor()).attrs).toContain('data-l4-close-panel');
  await page.keyboard.press('Shift+Tab');
  expect((await activeDescriptor()).tag).toBe('BUTTON');
  await page.keyboard.press('Tab');
  expect((await activeDescriptor()).attrs).toContain('data-l4-close-panel');
  await page.keyboard.press('Escape');

  await expect.poll(() => shadowEval(page, (root) => Boolean(root.querySelector('[data-l4-panel]')))).toBe(false);
});

test('document-head font face loads and applies inside the shadow-rendered widget', async ({ page }) => {
  await waitForWidget(page);
  await page.evaluate(() => document.fonts.ready);

  const font = await page.evaluate(() => {
    const fontStyle = document.head.querySelector('#l4-support-widget-fonts');
    const root = document.querySelector('l4-support-widget')?.shadowRoot;
    const launcher = root?.querySelector<HTMLElement>('[data-l4-launcher]');
    if (!launcher) throw new Error('missing launcher');
    return {
      hasHeadFontStyle: Boolean(fontStyle),
      fontFaceRegistered: document.fonts.check('16px "L4 Spike Shadow Font"'),
      widgetFontFamily: getComputedStyle(launcher).fontFamily,
    };
  });

  expect(font.hasHeadFontStyle).toBe(true);
  expect(font.fontFaceRegistered).toBe(true);
  expect(font.widgetFontFamily).toContain('L4 Spike Shadow Font');
});
