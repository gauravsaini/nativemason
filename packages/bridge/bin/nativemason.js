#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const entry = new URL('../dist/cli.js', import.meta.url);
if (!existsSync(entry)) {
  console.error('NativeMason has not been built. Run pnpm build in the NativeMason checkout.');
  process.exitCode = 1;
} else {
  await import(entry.href);
}
