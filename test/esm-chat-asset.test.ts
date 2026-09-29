import { describe, expect, it } from 'vitest';
import { validateChatAssetUrl } from '../src/config';
import { resolveChatAssetUrl } from '../src/esm-chat-asset';

describe('resolveChatAssetUrl', () => {
  it('resolves chat bundle next to ESM dist entry', () => {
    const url = resolveChatAssetUrl('https://cdn.example.com/pkg/dist/index.js');
    expect(url).toBe('https://cdn.example.com/pkg/dist/l4-support-widget-chat.js');
    expect(validateChatAssetUrl(url)).toBe(url);
  });
});
