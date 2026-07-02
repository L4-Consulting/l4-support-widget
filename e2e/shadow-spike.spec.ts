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

test('widget CSS is compiled and injected via adoptedStyleSheets, with a style fallback path', async ({
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
      cssHasWidgetLayer: root.adoptedStyleSheets.some((sheet) =>
        Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('.l4-launcher')),
      ),
      launcherPosition: buttonStyle.position,
      launcherBackground: buttonStyle.backgroundColor,
      fontFamily: buttonStyle.fontFamily,
    };
  });

  expect(adopted.mode).toBe('adoptedStyleSheets');
  expect(adopted.adoptedCount).toBeGreaterThan(0);
  expect(adopted.hasFallbackStyleTag).toBe(false);
  expect(adopted.cssHasWidgetLayer).toBe(true);
  expect(adopted.launcherPosition).toBe('fixed');
  expect(adopted.launcherBackground).toBe('rgb(16, 185, 129)');
  expect(adopted.fontFamily).toContain('IBM Plex Sans');

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
  expect(fallback.buttonBackground).toBe('rgb(16, 185, 129)');
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

test('launcher opens and closes the panel, and default tabs render with support selected', async ({ page }) => {
  await waitForWidget(page);
  await openPanel(page);

  const panel = await shadowEval(page, (root) => ({
    hasPanel: Boolean(root.querySelector('[data-l4-panel]')),
    supportTabs: root.querySelectorAll('[data-l4-tab="support"]').length,
    helpTabs: root.querySelectorAll('[data-l4-tab="help"]').length,
    roadmapTabs: root.querySelectorAll('[data-l4-tab="roadmap"]').length,
    selectedTab: root.querySelector('[aria-selected="true"]')?.getAttribute('data-l4-tab'),
  }));
  expect(panel).toEqual({ hasPanel: true, supportTabs: 1, helpTabs: 1, roadmapTabs: 1, selectedTab: 'support' });

  await shadowEval(page, (root) => root.querySelector<HTMLElement>('[data-l4-close-panel]')?.click());
  await expect.poll(() => shadowEval(page, (root) => Boolean(root.querySelector('[data-l4-panel]')))).toBe(false);
});

test('operator console geometry and design tokens are applied inside the panel', async ({ page }) => {
  await waitForWidget(page);
  await openPanel(page);

  const design = await shadowEval(page, (root) => {
    const panel = root.querySelector<HTMLElement>('[data-l4-panel]');
    const list = root.querySelector<HTMLElement>('.l4-case-list-pane');
    const mark = root.querySelector<HTMLElement>('.l4-mark');
    const title = root.querySelector<HTMLElement>('.l4-panel-header h2');
    if (!panel || !list || !mark || !title) throw new Error('missing operator console elements');
    const panelStyle = getComputedStyle(panel);
    const listStyle = getComputedStyle(list);
    const markStyle = getComputedStyle(mark);
    const titleStyle = getComputedStyle(title);
    return {
      panelWidth: Math.round(panel.getBoundingClientRect().width),
      panelHeight: Math.round(panel.getBoundingClientRect().height),
      panelRadius: panelStyle.borderRadius,
      panelBackground: panelStyle.backgroundColor,
      listWidth: Math.round(list.getBoundingClientRect().width),
      listBackground: listStyle.backgroundColor,
      markColor: markStyle.color,
      titleFont: titleStyle.fontFamily,
      titleSize: titleStyle.fontSize,
    };
  });

  expect(design.panelWidth).toBe(960);
  expect(design.panelHeight).toBe(640);
  expect(design.panelRadius).toBe('16px');
  expect(design.panelBackground).toBe('rgb(255, 255, 255)');
  expect(design.listWidth).toBe(340);
  expect(design.listBackground).toBe('rgb(250, 251, 252)');
  expect(design.markColor).toBe('rgb(255, 255, 255)');
  expect(design.titleFont).toContain('IBM Plex Sans');
  expect(design.titleSize).toBe('15.2px');
});


test('launcher, dialog, and tab bar expose accessible roles and labels', async ({ page }) => {
  await waitForWidget(page);
  await openPanel(page);

  const a11y = await shadowEval(page, (root) => ({
    launcherLabel: root.querySelector('[data-l4-launcher]')?.getAttribute('aria-label'),
    dialogLabel: root.querySelector('[data-l4-panel]')?.getAttribute('aria-label'),
    closeLabel: root.querySelector('[data-l4-close-panel]')?.getAttribute('aria-label'),
    tablistLabel: root.querySelector('[role="tablist"]')?.getAttribute('aria-label'),
    tabCount: root.querySelectorAll('[role="tab"]').length,
    selectedTab: root.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim(),
    tabPanelRole: root.querySelector('main')?.getAttribute('role'),
  }));

  expect(a11y).toEqual({
    launcherLabel: 'Open support',
    dialogLabel: 'L4 Support',
    closeLabel: 'Close support',
    tablistLabel: 'Support widget tabs',
    tabCount: 3,
    selectedTab: 'My Support',
    tabPanelRole: 'tabpanel',
  });
});

test('theme accent and dark mode change computed styles inside the shadow root', async ({ page }) => {
  await mockSupportApi(page);
  await page.goto('/demo/index.html?accent=%23dc2626&theme=dark');
  await page.waitForSelector('l4-support-widget', { state: 'attached' });
  await page.waitForFunction(() => {
    const host = document.querySelector('l4-support-widget');
    return Boolean(host?.shadowRoot?.querySelector('[data-l4-launcher]'));
  });
  await openPanel(page);

  const darkTheme = await shadowEval(page, (root) => {
    const launcher = root.querySelector<HTMLElement>('[data-l4-launcher]');
    const panel = root.querySelector<HTMLElement>('[data-l4-panel]');
    const card = root.querySelector<HTMLElement>('[data-l4-card]');
    if (!launcher || !panel || !card) throw new Error('missing themed elements');
    return {
      launcherBackground: getComputedStyle(launcher).backgroundColor,
      panelBackground: getComputedStyle(panel).backgroundColor,
      cardBackground: getComputedStyle(card).backgroundColor,
      panelColor: getComputedStyle(panel).color,
    };
  });

  expect(darkTheme.launcherBackground).toBe('rgb(220, 38, 38)');
  expect(darkTheme.panelBackground).toBe('rgb(16, 26, 44)');
  expect(darkTheme.cardBackground).toBe('rgb(16, 26, 44)');
  expect(darkTheme.panelColor).toBe('rgb(230, 236, 247)');
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

  const font = await page.evaluate(() => {
    const fontLink = document.head.querySelector<HTMLLinkElement>('#l4-support-widget-fonts');
    const root = document.querySelector('l4-support-widget')?.shadowRoot;
    const launcher = root?.querySelector<HTMLElement>('[data-l4-launcher]');
    if (!launcher) throw new Error('missing launcher');
    return {
      hasHeadFontLink: Boolean(fontLink),
      fontHref: fontLink?.href,
      widgetFontFamily: getComputedStyle(launcher).fontFamily,
    };
  });

  expect(font.hasHeadFontLink).toBe(true);
  expect(font.fontHref).toContain('IBM+Plex+Sans');
  expect(font.fontHref).toContain('IBM+Plex+Mono');
  expect(font.widgetFontFamily).toContain('IBM Plex Sans');
});
