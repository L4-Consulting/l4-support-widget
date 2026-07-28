# Guided UAT and onboarding walkthroughs

Status: design specification only. No walkthrough content, host-page selector policy, voice provider, release, pin move, or client-facing behavior is approved here.

## Goal

Let an authenticated product user follow a versioned sequence of human-authored steps during onboarding or UAT, with progress visible inside the Support Hub widget. A later, separately approved capability may highlight host-product controls.

All implementation is default-OFF. With the feature flag unset, the widget DOM, styles, bundle entry behavior, API calls, focus behavior, and host page must be unchanged.

## Two different overlay problems

### Widget-internal highlighting

Targets elements rendered inside the widget's own shadow root. The widget owns these nodes, selectors, focus order, and cleanup.

Recommended first slice:

- render an anchored callout inside the existing shadow root;
- target stable `data-l4-walkthrough-target` attributes, never CSS classes or text;
- keep focus in the widget and use the existing shadow-root focus trap;
- use `ResizeObserver` and scroll events to recompute geometry;
- remove every overlay/listener when a step changes, the panel closes, or the component disconnects;
- announce step changes through an `aria-live` region and preserve keyboard navigation.

This slice cannot highlight AgencyHub, CivicKit, or CSP controls outside the widget.

### Host-page highlighting

Targets nodes owned by the embedding product outside the shadow root. This is a security and compatibility boundary, not an extension of the internal overlay.

It would require the widget script to query and visually modify the host document, observe host layout, scroll host elements, and possibly manage focus outside its own tree. Risks include selector injection, hidden-field discovery, clickjacking-like overlays, broken host focus, z-index conflicts, and access to unrelated tenant data already present in the DOM.

Host-page highlighting must be a separate capability and PR. Default policy is denied. It cannot be enabled by walkthrough content alone.

## Host-page access policy proposal

If Jose approves this capability, use a host-owned adapter rather than arbitrary selectors:

```ts
interface WalkthroughHostAdapter {
  resolveTarget(targetId: string): HTMLElement | null;
  onBeforeStep?(stepId: string): void | Promise<void>;
  onAfterStep?(stepId: string): void | Promise<void>;
}
```

The embedding product maps opaque, reviewed target IDs to its own elements. The widget never accepts `querySelector` strings, XPath, HTML, JavaScript, URLs, or event-handler code from step content.

Required guards:

- host adapter supplied explicitly at initialization;
- global walkthrough flag and per-product allowlist both enabled;
- walkthrough declares the expected product key and compatible product version;
- target resolution is synchronous, bounded, and returns one visible element;
- widget may draw a non-interactive outline/callout but may not click, type, submit, or read field values;
- cross-origin iframes are always unsupported;
- missing target pauses safely with a neutral internal error; it never falls back to fuzzy DOM search.

## Step definition format

Store authored content outside the widget bundle and validate it against a versioned schema:

```json
{
  "schema_version": 1,
  "walkthrough_id": "human-assigned-id",
  "product_key": "civickit",
  "content_version": 1,
  "minimum_product_version": "human-approved",
  "title": "[HUMAN COPY]",
  "steps": [
    {
      "id": "stable-step-id",
      "surface": "widget",
      "target_id": "support-new-case",
      "title": "[HUMAN COPY]",
      "body": "[HUMAN COPY]",
      "narration": "[HUMAN COPY OR NULL]",
      "completion": { "type": "explicit_next" }
    }
  ]
}
```

Allowed `surface` values are `widget` and, only after policy approval, `host`. Allowed completion modes for the first release are `explicit_next` and `target_visible`. Do not infer completion from clicks, form values, network traffic, or route changes until each event contract is separately reviewed.

Reject unknown keys, duplicate step IDs, unknown target IDs, oversized content, missing product/version constraints, HTML, scripts, and external asset URLs.

## State and progress

First implementation keeps progress in memory for the open session. Persisted completion is a later slice because it requires identity, retention, reset, and reporting decisions.

If persistence is approved:

- key by tenant, product, authenticated support subject, walkthrough ID, and content version;
- record only step status/timestamps, never host field values;
- reset when content version changes only under an explicit authoring policy;
- tenant/product scope every read and write;
- expose “restart” and “exit” controls.

## Narration

Item 1 defines host-managed `onNarrate(message)` and `voice` configuration hooks but deliberately performs no audio or network work. A future 0.3.x walkthrough API may use a parallel host callback:

```ts
onNarrateStep?: (step: { walkthroughId: string; stepId: string; text: string }) => void
```

Rules:

- `voice.enabled` and a callback are both required;
- one callback per newly entered step, deduplicated by walkthrough/content version and step ID;
- callback failure cannot block visual progress;
- no provider endpoint, credentials, audio, autoplay, caching, or retry logic in the widget;
- narration text is human-authored and approved, not generated from host DOM;
- real Kokoro exposure remains blocked on Jose's endpoint/auth/rate-limit/cost decision.

## Product content ownership

The code team owns schema, validation, rendering, accessibility, safety boundaries, and tests. Product owners own target mapping and walkthrough copy.

- CivicKit content: Jose/Rebecca or a named CivicKit owner.
- AgencyHub content: Jose or a named AgencyHub owner.
- CSP content: Jose or a named CSP owner.

No product content ships with placeholders. Localization, legal/compliance review, screenshots, and narration pronunciation are content-owner responsibilities.

## Flags and rollout

Proposed flags, all default false/unset:

- widget config `walkthroughs: { enabled: true }`;
- backend `SUPPORT_WALKTHROUGHS_ENABLED`;
- backend `SUPPORT_WALKTHROUGHS_PRODUCTS`;
- separate host capability `SUPPORT_WALKTHROUGHS_HOST_TARGETS_ENABLED`.

An empty product allowlist disables all products. Enabling widget-internal steps must not implicitly enable host targets or narration.

Rollout: component tests → ephemeral product harness → internal test tenant → one Jose-selected pilot tenant → wider release. Rollback is unset flags and restore the prior pin.

## Pin and release lineage

Implementation belongs in a future 0.3.x descendant of the avatar/voice-hook lineage:

```text
d7fe3f0 (current CivicKit live pin)
  → PR #11 fixed widget lineage
    → 0.2.0 avatar/narration hooks
      → 0.3.x guided walkthrough implementation
```

Do not branch implementation from the old live pin or publish a side lineage. No merge automatically moves the CivicKit pin. Jose performs one reviewed forward pin move to a descendant SHA after product UAT; rollback restores the previously recorded SHA.

## Implementation PR slices

1. Schema/types/validator and fixture contract tests; no renderer.
2. Widget-internal overlay and accessibility tests behind default-off config.
3. Read-only walkthrough fetch with global and product fail-closed gates.
4. In-memory progress and restart/exit behavior.
5. Optional narration-step callback; no audio/network.
6. Product-owned target IDs and approved copy, one product per PR.
7. Host adapter capability only after a recorded access-policy decision.
8. Optional persisted progress after identity/retention/reporting decisions.

## Test plan

- flag unset: byte-equivalent public config normalization where practical, no overlay, host query, listener, fetch, callback, or bundle entry change;
- malformed content and unknown keys/targets fail closed;
- shadow-root geometry updates without escaping the widget;
- cleanup removes observers/listeners/portals on exit and disconnect;
- keyboard-only completion, focus order, Escape behavior, screen-reader announcements, reduced-motion mode, and zoom;
- target missing/hidden/removed mid-step pauses safely;
- host adapter is never invoked without its separate flag and product allowlist;
- adapter cannot supply selectors, values, scripts, or cross-origin frame nodes;
- narration is absent-safe, deduplicated, and failure-isolated;
- tenant/product/content-version progress isolation;
- visual snapshots for mobile, desktop, light, dark, and host z-index conflict harnesses;
- build and bundle-size budgets remain enforced.

## Decisions Jose must make

1. Approve or reject any host-page highlighting capability; default is reject/disabled.
2. If approved, accept the host-owned adapter model and prohibited behaviors.
3. Name the first product and pilot tenant; default is none.
4. Name content owners and approve all visible/narrated copy.
5. Choose completion events beyond explicit Next/target visible, if any.
6. Decide whether progress persists, for how long, and who may reset/report it.
7. Decide the Kokoro/public narration security and cost model.
8. Approve the future 0.3.x descendant SHA and pin-move/rollback window after UAT.

