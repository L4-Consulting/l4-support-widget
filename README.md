# L4 support widget

The widget provides Help, My Support, and Roadmap tabs. The development 0.4.0
chat asset is experimental and defaults off. Its presence in this repository
does not authorize a host pin change or chat activation.

## Chat asset loading

For the global IIFE, the loader captures `document.currentScript.src` during
evaluation and resolves `l4-support-widget-chat.js` from that script's directory.
The global and chat assets must come from the same reviewed build. The loader
uses the embedded SHA-384 manifest and `crossorigin="anonymous"`; a cross-origin
asset server must return a suitable CORS header. Hosts must permit the serving
origin in `script-src`. A blocked chat load falls back to the legacy conversation
and emits `chat_load_failed`; a relevant CSP violation also emits
`chat_blocked_by_csp`.

The URL locates an asset; integrity pins its bytes. An attacker already able to
inject same-origin executable scripts is outside this loader's threat model.
If neither an explicit asset URL nor the executing global script directory is
available, chat is unavailable and a warning is logged once.

For ESM (`import` from `@l4/support-widget`), `document.currentScript` is null
during module evaluation, so chat loading requires an explicit location:
`chat.assetUrl` (absolute `http(s)` URL whose pathname ends with
`/l4-support-widget-chat.js`). The helper `resolveChatAssetUrl(moduleUrl)` resolves
the chat filename next to the URL you pass; it does not discover the installed
package location or copy assets. Publish the chat asset and pass its actual URL. The loader still pins bytes with the embedded
SHA-384 manifest and `crossorigin="anonymous"`. With chat enabled but no
`assetUrl` and no global IIFE script directory, chat fails closed (legacy
conversation fallback) and a warning is logged once.

Example:

```js
import { init, open, resolveChatAssetUrl } from '@l4/support-widget';

// Publish both assets from the same reviewed build at this location.
const chatAssetUrl = resolveChatAssetUrl(
  'https://cdn.example.test/support-widget/0.4.0/index.js',
);
init({
  productKey: '…',
  apiBase: 'https://api.example.test',
  getToken: () => token,
  chat: { enabled: true, assetUrl: chatAssetUrl },
});
open();
```

## Token provider lifecycle

`init({ getToken })` uses that explicit provider. When `getToken` is omitted,
`init` captures the provider previously registered with `setTokenProvider(fn)`.
The getter is called for requests, so it can return a refreshed token for the
same identity. Use `init` again to replace the configured getter; use `destroy`
before initializing a different signed-in identity. `setTokenProvider` registers
a fallback and does not override an explicitly configured getter.

## Build and verification

`npm ci` builds declarations without regenerating the trusted manifest.
`npm run build` typechecks, builds chat, explicitly regenerates
`src/generated/asset-manifest.json`, and builds the global, ESM, and declaration
outputs. Review and commit the manifest with its corresponding source changes.

`npm run verify:manifest` requires the manifest at `HEAD`, builds into temporary
directories without invoking the manifest writer, checks chat integrity and the
manifest embedded in the global bundle, checks repeat-build byte identity, and
requires a clean working tree. CI runs this check on pull requests, main pushes,
and `v*` tag pushes. All CI jobs, including this check, must pass before publishing
a release. This repository does not currently publish packages automatically.

The initial loader baseline is recorded in `tests/golden/legacy-asset.sha256`
and the global embed snapshot. Tests and verification never regenerate these
baselines. Any intentional baseline change needs a reviewed explanation of the
asset and visible DOM differences. Tailwind scans explicit runtime source only;
test fixture utilities must not enter the production bundle.

The existing global bundle limit is 66 KB gzip. The `--mode global` Vite build
minifies `l4-support-widget.js` with Terser (ecma 2015, two compress passes,
mangled identifiers, license/preserve/banner comments retained). `npm run size`
enforces the gzip budget after `build:global`.

## Remaining integration gates

Typing, durable presence, read/unread behavior, and the complete client lifecycle
contract remain under implementation or verification. Required server routes,
proxy latency/reconnect evidence and the 45-minute soak, host inventory/pin checks,
and pilot authorization are separate prerequisites. Attachments belong to W2.4.
Keep host chat flags off until the applicable W2 acceptance and activation gates
are satisfied.
