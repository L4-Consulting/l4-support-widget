#!/usr/bin/env node
// Reports the gzipped size of the IIFE bundle against the budget.
// WARN-only for now (v2 plan: don't hard-fail until the spike task).
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUDGET_KB = 60; // gzip budget for the IIFE React bundle
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
  console.warn(
    `::warning::l4-support-widget IIFE bundle is ${gzipKb.toFixed(1)} KB gzip, over the ${BUDGET_KB} KB budget (warn-only until the spike task).`,
  );
}

// Warn-only: always exit 0 for now.
process.exit(0);
