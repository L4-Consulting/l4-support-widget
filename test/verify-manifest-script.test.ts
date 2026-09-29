import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const fixtures: string[] = [];
const manifestName = 'src/generated/asset-manifest.json';
const chatBytes = 'fixture chat\n';
const integrity = `sha384-${createHash('sha384').update(chatBytes).digest('base64')}`;
function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'l4-manifest-test-'));
  fixtures.push(root);
  for (const dir of ['scripts', 'src/generated', 'tools']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  copyFileSync(resolve('scripts/verify-manifest.mjs'), join(root, 'scripts/verify-manifest.mjs'));
  writeFileSync(join(root, manifestName), JSON.stringify({ assets: { 'l4-support-widget-chat.js': { integrity } } }));
  writeFileSync(join(root, 'scripts/write-manifest.mjs'), 'import {writeFileSync} from "node:fs"; writeFileSync(".git/writer-called", "yes"); throw Error("writer invoked");');
  // Only the compiler is stubbed; execute the real verifier and Git checks.
  // A separate clean snapshot with real Vite builds validates compiler integration.
  const compiler = `#!/usr/bin/env node
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2);
if(args[0]!=='vite'||args[1]!=='build')process.exit(91);
const mode=args[args.indexOf('--mode')+1], out=args[args.indexOf('--outDir')+1];
const log='.git/compiler-calls';
const calls=existsSync(log)?readFileSync(log,'utf8').trim().split('\\n'):[];
const count=calls.filter(x=>x===mode).length+1;
appendFileSync(log,mode+'\\n');
const fault=process.env.L4_MANIFEST_FIXTURE_FAULT;
let bytes=mode==='chat'?${JSON.stringify(chatBytes)}:'const manifest={"l4-support-widget-chat.js":{integrity:"'+${JSON.stringify(integrity)}+'"}};';
if(mode==='chat'&&fault==='stale-chat')bytes+='changed';
if(mode==='global'&&fault==='global-drift')bytes=bytes.replace(${JSON.stringify(integrity)},'sha384-AAAA');
if(fault===mode+'-nondeterministic'&&count>1)bytes+='/*'+count+'*/';
writeFileSync(join(out,mode==='chat'?'l4-support-widget-chat.js':'l4-support-widget.js'),bytes);
`;
  writeFileSync(join(root, 'tools/npx'), compiler);
  chmodSync(join(root, 'tools/npx'), 0o755);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Manifest test fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Synthetic verifier fixture');
  return root;
}
function verify(root: string, fault = '') {
  const result = spawnSync(process.execPath, ['scripts/verify-manifest.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, PATH: join(root, 'tools') + delimiter + process.env.PATH, L4_MANIFEST_FIXTURE_FAULT: fault },
  });
  expect(result.error).toBeUndefined();
  expect(existsSync(join(root, '.git/writer-called'))).toBe(false);
  return { status: result.status, output: result.stdout + result.stderr };
}
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('manifest verifier with isolated committed fixtures', () => {
  it('accepts matching deterministic bytes without writing the manifest', () => {
    const root = fixture();
    const before = readFileSync(join(root, manifestName), 'utf8');
    expect(verify(root).status).toBe(0);
    expect(readFileSync(join(root, manifestName), 'utf8')).toBe(before);
    expect(git(root, 'status', '--porcelain')).toBe('');
  });
  it('rejects an ignored on-disk manifest absent from HEAD before any builds', () => {
    const root = fixture();
    git(root, 'rm', '--cached', manifestName);
    git(root, 'commit', '-qm', 'Remove committed manifest');
    writeFileSync(join(root, '.git/info/exclude'), manifestName + '\n');
    expect(git(root, 'status', '--porcelain')).toBe('');
    const result = verify(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('not committed at HEAD');
    expect(existsSync(join(root, '.git/compiler-calls'))).toBe(false);
  });
  it.each([false, true])('rejects manifest drift before builds (staged=%s)', (staged) => {
    const root = fixture();
    writeFileSync(join(root, manifestName), readFileSync(join(root, manifestName), 'utf8') + '\n');
    if (staged) git(root, 'add', manifestName);
    const result = verify(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('differs from HEAD');
    expect(existsSync(join(root, '.git/compiler-calls'))).toBe(false);
  });
  it.each([
    ['stale-chat', 'temp chat build integrity mismatch'],
    ['global-drift', 'embedded global manifest drift'],
    ['chat-nondeterministic', 'two consecutive chat builds are not byte-identical'],
    ['global-nondeterministic', 'two consecutive global builds are not byte-identical'],
  ])('rejects %s output', (fault, reason) => {
    const result = verify(fixture(), fault);
    expect(result.status).toBe(1);
    expect(result.output).toContain(reason);
  });
  it('rejects an otherwise valid build with an unrelated dirty file', () => {
    const root = fixture();
    writeFileSync(join(root, 'unexpected.txt'), 'dirty');
    const result = verify(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('git status not clean');
  });
});
