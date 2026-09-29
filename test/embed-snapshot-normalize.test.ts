import { describe, expect, it } from 'vitest';
import { normalizeGlobalEmbedHtml } from './embed-snapshot-normalize';

describe('global embed snapshot normalization', () => {
  it('ignores attribute order, build markers, generated ids and repeated whitespace', () => {
    const a = '<div z="kept" id="generated-a" data-widget-build="one" a="first">hello   world</div>';
    const b = '<div a="first" data-widget-build="two" id="generated-b" z="kept">hello world</div>';
    expect(normalizeGlobalEmbedHtml(a)).toBe(normalizeGlobalEmbedHtml(b));
    expect(normalizeGlobalEmbedHtml(a)).toBe('<div a="first" id="#id" z="kept">hello world</div>');
  });

  it('retains visible content and meaningful attribute changes', () => {
    expect(normalizeGlobalEmbedHtml('<button disabled>Send</button>'))
      .not.toBe(normalizeGlobalEmbedHtml('<button>Send</button>'));
  });
});
