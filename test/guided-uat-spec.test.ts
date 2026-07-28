import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('guided UAT specification', () => {
  const spec = readFileSync(resolve(process.cwd(), 'docs/specs/guided-uat-walkthrough.md'), 'utf8');

  it('retains the shadow/host boundary, default-off contract, lineage, and human gates', () => {
    expect(spec).toContain('### Widget-internal highlighting');
    expect(spec).toContain('### Host-page highlighting');
    expect(spec).toContain('Default policy is denied');
    expect(spec).toContain('## Step definition format');
    expect(spec).toContain('## Narration');
    expect(spec).toContain('## Product content ownership');
    expect(spec).toContain('## Pin and release lineage');
    expect(spec).toContain('d7fe3f0 (current CivicKit live pin)');
    expect(spec).toContain('## Test plan');
    expect(spec).toContain('## Decisions Jose must make');
    expect(spec).toContain('All implementation is default-OFF');
    expect(spec).toContain('default is none');
  });
});
