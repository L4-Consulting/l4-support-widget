const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ShadowFocusTrap {
  activate(): void;
  deactivate(): void;
}

function visibleFocusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return el.getClientRects().length > 0;
  });
}

export function createShadowFocusTrap(
  shadowRoot: ShadowRoot,
  container: HTMLElement,
  options: { onEscape?: () => void } = {},
): ShadowFocusTrap {
  let active = false;

  const focusFirst = () => {
    const first = visibleFocusables(container)[0] ?? container;
    first.focus();
  };

  const onKeyDown = (event: Event) => {
    if (!active) return;
    if (!(event instanceof KeyboardEvent)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      options.onEscape?.();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusables = visibleFocusables(container);
    if (focusables.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }

    const current = shadowRoot.activeElement;
    const currentIndex = current instanceof HTMLElement ? focusables.indexOf(current) : -1;

    if (event.shiftKey) {
      if (currentIndex <= 0) {
        event.preventDefault();
        focusables[focusables.length - 1].focus();
      }
      return;
    }

    if (currentIndex === -1 || currentIndex === focusables.length - 1) {
      event.preventDefault();
      focusables[0].focus();
    }
  };

  return {
    activate() {
      if (active) return;
      active = true;
      shadowRoot.addEventListener('keydown', onKeyDown);
      queueMicrotask(focusFirst);
    },
    deactivate() {
      if (!active) return;
      active = false;
      shadowRoot.removeEventListener('keydown', onKeyDown);
    },
  };
}
