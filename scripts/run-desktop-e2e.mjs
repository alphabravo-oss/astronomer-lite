#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('../web/', import.meta.url));
const cli = fileURLToPath(new URL('../web/node_modules/@playwright/test/cli.js', import.meta.url));
const headlessLinux = process.platform === 'linux' && !process.env.DISPLAY;
const args = [cli, 'test', '--config', 'playwright.desktop.config.ts', ...process.argv.slice(2)];
const result = spawnSync(headlessLinux ? 'xvfb-run' : process.execPath,
  headlessLinux ? ['-a', process.execPath, ...args] : args,
  { cwd: web, stdio: 'inherit', env: process.env });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
