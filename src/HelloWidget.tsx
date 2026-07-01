import type { JSX } from 'react';
import { version } from './version';

/**
 * Minimal placeholder rendered inside the shadow root. This is ONLY enough to
 * prove the element mounts a React tree and builds. The real Launcher/Panel UI
 * and the Tailwind-in-shadow proof land in the next task.
 *
 * Constrained to React-18-compatible APIs (no use()/useActionState/ref-as-prop)
 * so the Preact-compat swap stays viable (v2 plan, BUNDLE note).
 */
export function HelloWidget(): JSX.Element {
  return (
    <div role="status" data-testid="l4-support-hello">
      L4 Support Widget v{version}
    </div>
  );
}
