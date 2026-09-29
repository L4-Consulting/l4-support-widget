#!/usr/bin/env node
/**
 * Release-only: hashes the built chat IIFE and writes src/generated/asset-manifest.json.
 * Never invoked by verify:manifest.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const chatBundle = resolve(root, 'dist', 'l4-support-widget-chat.js');
const manifestPath = resolve(root, 'src', 'generated', 'asset-manifest.json');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

if (!existsSync(chatBundle)) {
  console.error('write-manifest: dist/l4-support-widget-chat.js not found — run build:chat first.');
  process.exit(1);
}

const bytes = readFileSync(chatBundle);
const digest = createHash('sha384').update(bytes).digest('base64');
const manifest = {
  version: 1,
  buildId: `w2-chat-${pkg.version}`,
  assets: {
    'l4-support-widget-chat.js': {
      integrity: `sha384-${digest}`,
    },
  },
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`write-manifest: wrote ${manifestPath} (sha384-${digest.slice(0, 12)}…)`);
