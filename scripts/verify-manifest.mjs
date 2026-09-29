#!/usr/bin/env node
/**
 * CI release gate: verifies checked-in manifest matches built bytes without running the writer.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifestPath = resolve(root, 'src', 'generated', 'asset-manifest.json');
const CHAT_FILE = 'l4-support-widget-chat.js';
const GLOBAL_FILE = 'l4-support-widget.js';

function sha384File(path) {
  const bytes = readFileSync(path);
  const digest = createHash('sha384').update(bytes).digest('base64');
  return `sha384-${digest}`;
}

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: root, stdio: 'pipe', ...opts });
}

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
}

let failed = false;
function fail(msg) {
  console.error(`verify-manifest: ${msg}`);
  failed = true;
}

function extractEmbeddedChatIntegrity(globalJs) {
  const patterns = [
    new RegExp(`${CHAT_FILE}[^}]*integrity[:\"]+(sha384-[A-Za-z0-9+/=]+)`),
    /integrity[:\"]+(sha384-[A-Za-z0-9+/=]+)[^}]*l4-support-widget-chat\.js/,
  ];
  for (const pattern of patterns) {
    const match = globalJs.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

// (1) Tracked manifest at HEAD must match working tree (no unstaged or staged drift).
try {
  run('git cat-file -e HEAD:src/generated/asset-manifest.json');
} catch {
  console.error('verify-manifest: src/generated/asset-manifest.json is not committed at HEAD.');
  process.exit(1);
}

try {
  run(`git diff --exit-code HEAD -- ${manifestPath}`);
} catch {
  fail('src/generated/asset-manifest.json differs from HEAD (staged or unstaged changes).');
}

try {
  const staged = git(`diff --cached --name-only -- ${manifestPath}`);
  if (staged) {
    fail('src/generated/asset-manifest.json has staged changes not committed at HEAD.');
  }
} catch {
  // ignore
}

if (failed) process.exit(1);

if (!existsSync(manifestPath)) {
  fail('missing src/generated/asset-manifest.json');
  process.exit(1);
}

const checkedIn = JSON.parse(readFileSync(manifestPath, 'utf8'));
const expectedIntegrity = checkedIn?.assets?.[CHAT_FILE]?.integrity;
if (!expectedIntegrity || !expectedIntegrity.startsWith('sha384-')) {
  fail('manifest missing chat integrity');
}

// (2) Temp chat build hash must match checked-in manifest.
const tempChat = mkdtempSync(join(tmpdir(), 'l4-verify-chat-'));
try {
  run(`npx vite build --mode chat --outDir ${tempChat}`);
  const builtIntegrity = sha384File(join(tempChat, CHAT_FILE));
  if (builtIntegrity !== expectedIntegrity) {
    fail(`temp chat build integrity mismatch (got ${builtIntegrity}, expected ${expectedIntegrity})`);
  }
} finally {
  rmSync(tempChat, { recursive: true, force: true });
}

// (3) Temp global build embeds the same manifest integrity.
const tempGlobal = mkdtempSync(join(tmpdir(), 'l4-verify-global-'));
try {
  run(`npx vite build --mode global --outDir ${tempGlobal}`);
  const globalJs = readFileSync(join(tempGlobal, GLOBAL_FILE), 'utf8');
  const embedded = extractEmbeddedChatIntegrity(globalJs);
  if (!embedded) {
    fail('could not extract embedded chat integrity from global bundle');
  } else if (embedded !== expectedIntegrity) {
    fail(`embedded global manifest drift (${embedded} vs ${expectedIntegrity})`);
  }
} finally {
  rmSync(tempGlobal, { recursive: true, force: true });
}

// (4) Two consecutive chat builds are byte-identical.
const tempA = mkdtempSync(join(tmpdir(), 'l4-verify-a-'));
const tempB = mkdtempSync(join(tmpdir(), 'l4-verify-b-'));
try {
  run(`npx vite build --mode chat --outDir ${tempA}`);
  run(`npx vite build --mode chat --outDir ${tempB}`);
  const a = readFileSync(join(tempA, CHAT_FILE));
  const b = readFileSync(join(tempB, CHAT_FILE));
  if (!a.equals(b)) {
    fail('two consecutive chat builds are not byte-identical');
  }
} finally {
  rmSync(tempA, { recursive: true, force: true });
  rmSync(tempB, { recursive: true, force: true });
}

// (5) Two consecutive global builds are byte-identical.
const tempG1 = mkdtempSync(join(tmpdir(), 'l4-verify-g1-'));
const tempG2 = mkdtempSync(join(tmpdir(), 'l4-verify-g2-'));
try {
  run(`npx vite build --mode global --outDir ${tempG1}`);
  run(`npx vite build --mode global --outDir ${tempG2}`);
  const g1 = readFileSync(join(tempG1, GLOBAL_FILE));
  const g2 = readFileSync(join(tempG2, GLOBAL_FILE));
  if (!g1.equals(g2)) {
    fail('two consecutive global builds are not byte-identical');
  }
} finally {
  rmSync(tempG1, { recursive: true, force: true });
  rmSync(tempG2, { recursive: true, force: true });
}

// (6) Working tree must stay clean (manifest writer was not invoked).
const porcelain = git('status --porcelain');
if (porcelain) {
  fail(`git status not clean after verify:\n${porcelain}`);
}

if (failed) process.exit(1);
console.log('verify-manifest: OK');
