import { useEffect, useRef, useState, type JSX } from 'react';
import { createShadowFocusTrap, type ShadowFocusTrap } from './focus-trap';
import { ShadowPortal } from './portal';
import { version } from './version';

export function DemoWidget({
  shadowRoot,
  portalContainer,
}: {
  shadowRoot: ShadowRoot;
  portalContainer: HTMLElement;
}): JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const trapRef = useRef<ShadowFocusTrap | null>(null);

  useEffect(() => {
    if (!modalOpen || !dialogRef.current) return;
    trapRef.current = createShadowFocusTrap(shadowRoot, dialogRef.current, {
      onEscape: () => setModalOpen(false),
    });
    trapRef.current.activate();
    return () => {
      trapRef.current?.deactivate();
      trapRef.current = null;
    };
  }, [modalOpen, shadowRoot]);

  return (
    <section
      className="l4-spike-shell fixed right-5 bottom-5 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-4 font-l4-spike text-slate-900 shadow-xl"
      data-l4-spike-panel
      aria-label="L4 support widget shadow DOM spike"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-l4-accent">Shadow DOM spike</p>
          <h2 className="mt-1 text-base font-semibold">L4 Support Widget</h2>
        </div>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">v{version}</span>
      </div>

      <p className="mt-3 text-sm text-slate-600">
        Minimal shell proving Tailwind, portals, focus, fonts, and isolation before real tabs exist.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="rounded bg-l4-accent px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          data-l4-open-modal
          onClick={() => setModalOpen(true)}
        >
          Open modal
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          data-l4-secondary-action
        >
          Shell action
        </button>
      </div>

      {modalOpen ? (
        <ShadowPortal container={portalContainer}>
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 font-l4-spike"
            data-l4-modal-backdrop
          >
            <div
              ref={dialogRef}
              className="w-full max-w-sm rounded-lg bg-white p-5 text-slate-900 shadow-2xl ring-1 ring-slate-900/10"
              role="dialog"
              aria-modal="true"
              aria-label="Shadow modal"
              tabIndex={-1}
              data-l4-modal
            >
              <h3 className="text-base font-semibold">Portal inside shadow root</h3>
              <p className="mt-2 text-sm text-slate-600">
                This modal is rendered into the in-shadow portal container.
              </p>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                Demo field
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  data-l4-modal-input
                  defaultValue="Shadow focus"
                />
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                  data-l4-modal-cancel
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded bg-l4-accent px-3 py-2 text-sm font-semibold text-white"
                  data-l4-modal-confirm
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </ShadowPortal>
      ) : null}
    </section>
  );
}
