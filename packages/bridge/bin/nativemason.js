#!/usr/bin/env node
import { existsSync } from 'node:fs';

const entry = new URL('../dist/cli.js', import.meta.url);
if (!existsSync(entry)) {
  console.error('NativeMason has not been built. Run pnpm build in the NativeMason checkout.');
  process.exitCode = 1;
} else {
  await import(entry.href);
}
