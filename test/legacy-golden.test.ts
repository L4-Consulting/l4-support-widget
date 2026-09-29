import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bundlePath = resolve('dist/l4-support-widget.js');
const goldenPath = resolve('tests/golden/legacy-asset.sha256');

describe('legacy golden asset (flag off contract)', () => {
  it('excludes utilities found only in test fixtures from the production bundle', () => {
    expect(readFileSync(bundlePath, 'utf8')).not.toContain('width:731px');
  });

  it('matches checked-in sha256 of built global IIFE', () => {
    if (!existsSync(bundlePath)) {
      throw new Error('Run npm run build:release before legacy-golden tests.');
    }
    const hash = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
    const expected = readFileSync(goldenPath, 'utf8').trim();
    expect(hash).toBe(expected);
  });
});
