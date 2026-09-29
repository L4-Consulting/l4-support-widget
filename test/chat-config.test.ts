import { describe, expect, it } from 'vitest';
import { ConfigError, normalizeConfig, validateChatAssetUrl } from '../src/config';

describe('chat flag', () => {
  it('defaults chat off unless explicitly enabled', () => {
    const config = normalizeConfig({
      productKey: 'pk',
      apiBase: 'https://api.example.test',
      getToken: () => 't',
    });
    expect(config.chat.enabled).toBe(false);
  });

  it('enables chat only when config.chat.enabled === true', () => {
    const on = normalizeConfig({
      productKey: 'pk',
      apiBase: 'https://api.example.test',
      getToken: () => 't',
      chat: { enabled: true },
    });
    expect(on.chat.enabled).toBe(true);
  });

  it('preserves a validated explicit assetUrl when chat is enabled', () => {
    const config = normalizeConfig({
      productKey: 'pk',
      apiBase: 'https://api.example.test',
      getToken: () => 't',
      chat: {
        enabled: true,
        assetUrl: 'https://cdn.example.test/pkg/l4-support-widget-chat.js?v=1',
      },
    });
    expect(config.chat.assetUrl).toBe('https://cdn.example.test/pkg/l4-support-widget-chat.js?v=1');
  });

  it('ignores invalid assetUrl when chat is disabled', () => {
    const config = normalizeConfig({
      productKey: 'pk',
      apiBase: 'https://api.example.test',
      getToken: () => 't',
      chat: { enabled: false, assetUrl: 'not-a-url' },
    });
    expect(config.chat.enabled).toBe(false);
    expect(config.chat.assetUrl).toBeUndefined();
  });

  it('fails closed on invalid assetUrl when chat is enabled', () => {
    expect(() =>
      normalizeConfig({
        productKey: 'pk',
        apiBase: 'https://api.example.test',
        getToken: () => 't',
        chat: { enabled: true, assetUrl: 'ftp://bad.example/l4-support-widget-chat.js' },
      }),
    ).toThrow(ConfigError);
  });
});

describe('validateChatAssetUrl', () => {
  it('rejects credentials in the URL', () => {
    expect(() => validateChatAssetUrl('https://user:pass@cdn.example/l4-support-widget-chat.js')).toThrow(ConfigError);
  });

  it('requires the fixed chat filename suffix', () => {
    expect(() => validateChatAssetUrl('https://cdn.example/chat.js')).toThrow(ConfigError);
  });
});
