#!/usr/bin/env node
// Enforces the gzipped size of the IIFE bundle against the production budget.
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUDGET_KB = 64; // Accommodates necessary live-pilot idempotency, timeout, and polling fixes over the pre-existing 60.4 KB baseline.
const bundlePath = resolve(__dirname, '..', 'dist', 'l4-support-widget.js');

if (!existsSync(bundlePath)) {
  console.error(`bundle-size: ${bundlePath} not found — run the build first.`);
  process.exit(1);
}

const raw = readFileSync(bundlePath);
const gzipped = gzipSync(raw);
const gzipKb = gzipped.length / 1024;
const rawKb = raw.length / 1024;

console.log(
  `bundle-size: l4-support-widget.js  raw ${rawKb.toFixed(1)} KB  gzip ${gzipKb.toFixed(1)} KB  (budget ${BUDGET_KB} KB gzip)`,
);

if (gzipKb > BUDGET_KB) {
  console.error(
    `::error::l4-support-widget IIFE bundle is ${gzipKb.toFixed(1)} KB gzip, over the ${BUDGET_KB} KB budget.`,
  );
  process.exit(1);
}
