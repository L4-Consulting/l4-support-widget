import { expect, test, type Page } from '@playwright/test';

async function waitForWidget(page: Page) {
  await page.goto('/demo/index.html');
  await page.waitForSelector('l4-support-widget', { state: 'attached' });
  await page.waitForFunction(() => {
    const host = document.querySelector('l4-support-widget');
    return Boolean(host?.shadowRoot?.querySelector('[data-l4-spike-panel]'));
  });
}

async function waitForFallbackWidget(page: Page) {
  await page.goto('/demo/index.html?styleMode=fallback');
  await page.waitForSelector('l4-support-widget', { state: 'attached' });
  await page.waitForFunction(() => {
    const host = document.querySelector('l4-support-widget');
    return host?.getAttribute('data-l4-style-mode') === 'style';
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

test('Tailwind 4 CSS is compiled and injected via adoptedStyleSheets, with a style fallback path', async ({
  page,
}) => {
  await waitForWidget(page);

  const adopted = await shadowEval(page, (root) => {
    const panel = root.querySelector<HTMLElement>('[data-l4-spike-panel]');
    const button = root.querySelector<HTMLElement>('[data-l4-open-modal]');
    if (!panel || !button) throw new Error('missing panel/button');
    const panelStyle = getComputedStyle(panel);
    const buttonStyle = getComputedStyle(button);
    return {
      mode: (root.host as HTMLElement).getAttribute('data-l4-style-mode'),
      adoptedCount: root.adoptedStyleSheets.length,
      hasFallbackStyleTag: Boolean(root.querySelector('style[data-l4-widget-styles]')),
      cssHasTailwindLayer: root.adoptedStyleSheets.some((sheet) =>
        Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('.fixed')),
      ),
      panelPosition: panelStyle.position,
      panelBorderRadius: panelStyle.borderRadius,
      buttonBackground: buttonStyle.backgroundColor,
      fontFamily: panelStyle.fontFamily,
    };
  });

  expect(adopted.mode).toBe('adoptedStyleSheets');
  expect(adopted.adoptedCount).toBeGreaterThan(0);
  expect(adopted.hasFallbackStyleTag).toBe(false);
  expect(adopted.cssHasTailwindLayer).toBe(true);
  expect(adopted.panelPosition).toBe('fixed');
  expect(adopted.panelBorderRadius).not.toBe('0px');
  expect(adopted.buttonBackground).toBe('rgb(37, 99, 235)');
  expect(adopted.fontFamily).toContain('L4 Spike Shadow Font');

  await waitForFallbackWidget(page);
  const fallback = await shadowEval(page, (root) => {
    const button = root.querySelector<HTMLElement>('[data-l4-open-modal]');
    if (!button) throw new Error('missing button');
    return {
      mode: (root.host as HTMLElement).getAttribute('data-l4-style-mode'),
      adoptedCount: root.adoptedStyleSheets.length,
      hasFallbackStyleTag: Boolean(root.querySelector('style[data-l4-widget-styles]')),
      buttonBackground: getComputedStyle(button).backgroundColor,
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
    const widgetButton = root?.querySelector<HTMLElement>('[data-l4-open-modal]');
    const panel = root?.querySelector<HTMLElement>('[data-l4-spike-panel]');
    if (!hostProbe || !hostButton || !widgetButton || !panel) throw new Error('missing probes');

    const hostProbeStyle = getComputedStyle(hostProbe);
    const hostButtonStyle = getComputedStyle(hostButton);
    const widgetButtonStyle = getComputedStyle(widgetButton);
    const panelStyle = getComputedStyle(panel);

    return {
      hostProbeBackground: hostProbeStyle.backgroundColor,
      hostProbePadding: hostProbeStyle.paddingTop,
      hostProbeRadius: hostProbeStyle.borderRadius,
      hostButtonColor: hostButtonStyle.color,
      widgetButtonColor: widgetButtonStyle.color,
      widgetButtonBorderColor: widgetButtonStyle.borderTopColor,
      widgetFontFamily: panelStyle.fontFamily,
    };
  });

  expect(isolation.hostProbeBackground).toBe('rgba(0, 0, 0, 0)');
  expect(isolation.hostProbePadding).toBe('0px');
  expect(isolation.hostProbeRadius).toBe('0px');
  expect(isolation.hostButtonColor).toBe('rgb(127, 29, 29)');
  expect(isolation.widgetButtonColor).toBe('rgb(255, 255, 255)');
  expect(isolation.widgetButtonBorderColor).not.toBe('rgb(127, 29, 29)');
  expect(isolation.widgetFontFamily).not.toContain('Georgia');
});

test('portal modal renders into the in-shadow portal container and is Tailwind styled', async ({ page }) => {
  await waitForWidget(page);
  await shadowEval(page, (root) => root.querySelector<HTMLElement>('[data-l4-open-modal]')?.click());

  const modal = await shadowEval(page, (root) => {
    const portalRoot = root.querySelector('[data-l4-portal-root]');
    const modalEl = root.querySelector<HTMLElement>('[data-l4-modal]');
    const backdrop = root.querySelector<HTMLElement>('[data-l4-modal-backdrop]');
    const bodyModal = document.body.querySelector('[data-l4-modal]');
    if (!portalRoot || !modalEl || !backdrop) throw new Error('missing modal');
    const modalStyle = getComputedStyle(modalEl);
    const backdropStyle = getComputedStyle(backdrop);
    return {
      modalInsidePortalRoot: portalRoot.contains(modalEl),
      modalInBody: Boolean(bodyModal),
      modalRadius: modalStyle.borderRadius,
      modalBackground: modalStyle.backgroundColor,
      backdropPosition: backdropStyle.position,
      backdropBackground: backdropStyle.backgroundColor,
    };
  });

  expect(modal.modalInsidePortalRoot).toBe(true);
  expect(modal.modalInBody).toBe(false);
  expect(modal.modalRadius).not.toBe('0px');
  expect(modal.modalBackground).toBe('rgb(255, 255, 255)');
  expect(modal.backdropPosition).toBe('fixed');
  expect(modal.backdropBackground).not.toBe('rgba(0, 0, 0, 0)');
});

test('shadow-aware focus trap cycles with Tab and Shift+Tab, and Escape closes', async ({ page }) => {
  await waitForWidget(page);
  await shadowEval(page, (root) => root.querySelector<HTMLElement>('[data-l4-open-modal]')?.click());
  await page.waitForFunction(() => {
    const root = document.querySelector('l4-support-widget')?.shadowRoot;
    return root?.activeElement?.hasAttribute('data-l4-modal-input');
  });

  const activeAttr = () =>
    shadowEval(page, (root) =>
      Array.from(root.activeElement?.attributes ?? []).map((attr) => attr.name).join(' '),
    );

  expect(await activeAttr()).toContain('data-l4-modal-input');
  await page.keyboard.press('Tab');
  expect(await activeAttr()).toContain('data-l4-modal-cancel');
  await page.keyboard.press('Tab');
  expect(await activeAttr()).toContain('data-l4-modal-confirm');
  await page.keyboard.press('Tab');
  expect(await activeAttr()).toContain('data-l4-modal-input');
  await page.keyboard.press('Shift+Tab');
  expect(await activeAttr()).toContain('data-l4-modal-confirm');
  await page.keyboard.press('Escape');

  await expect
    .poll(() => shadowEval(page, (root) => Boolean(root.querySelector('[data-l4-modal]'))))
    .toBe(false);
});

test('document-head font face loads and applies inside the shadow-rendered widget', async ({ page }) => {
  await waitForWidget(page);
  await page.evaluate(() => document.fonts.ready);

  const font = await page.evaluate(() => {
    const fontStyle = document.head.querySelector('#l4-support-widget-fonts');
    const root = document.querySelector('l4-support-widget')?.shadowRoot;
    const panel = root?.querySelector<HTMLElement>('[data-l4-spike-panel]');
    if (!panel) throw new Error('missing panel');
    return {
      hasHeadFontStyle: Boolean(fontStyle),
      fontFaceRegistered: document.fonts.check('16px "L4 Spike Shadow Font"'),
      panelFontFamily: getComputedStyle(panel).fontFamily,
    };
  });

  expect(font.hasHeadFontStyle).toBe(true);
  expect(font.fontFaceRegistered).toBe(true);
  expect(font.panelFontFamily).toContain('L4 Spike Shadow Font');
});
