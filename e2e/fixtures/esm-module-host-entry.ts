/**
 * Synthetic ESM host entry: imports the real built package and boots chat with an explicit asset URL.
 * Bundled by Playwright setup via esbuild (not checked in).
 */
import { init, open } from '../../dist/index.js';

declare global {
  interface Window {
    __l4CurrentScriptAtEval: string;
    __l4BootEsm: (chatAssetUrl: string, chatEnabled: boolean) => void;
  }
}

window.__l4CurrentScriptAtEval = document.currentScript ? 'present' : 'null';

export function bootEsmHost(chatAssetUrl: string, chatEnabled: boolean): void {
  init({
    productKey: 'pk',
    apiBase: 'https://api.example.test',
    getToken: () => 'tok',
    tabs: ['support'],
    chat: chatEnabled
      ? { enabled: true, assetUrl: chatAssetUrl }
      : { enabled: false },
    onEvent: (event) => {
      if (event.type === 'chat_load_failed') {
        document.getElementById('fallback')?.removeAttribute('hidden');
      }
    },
  });
  open();
}

window.__l4BootEsm = (chatAssetUrl: string, chatEnabled: boolean) => {
  if (chatEnabled && !chatAssetUrl) {
    init({
      productKey: 'pk',
      apiBase: 'https://api.example.test',
      getToken: () => 'tok',
      tabs: ['support'],
      chat: { enabled: true },
      onEvent: (event) => {
        if (event.type === 'chat_load_failed') {
          document.getElementById('fallback')?.removeAttribute('hidden');
        }
      },
    });
    open();
    return;
  }
  bootEsmHost(chatAssetUrl, chatEnabled);
};
