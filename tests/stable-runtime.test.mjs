import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const APP_PATH = new URL('../static/app.js', import.meta.url);
const MAIN_MODULE_PATH = new URL('../static/main.module.js', import.meta.url);
const OLD_APP_DIR = new URL('../static/src/app/', import.meta.url);

test('active app entry uses stable runtime and does not load archived runtime', async () => {
  const code = await readFile(APP_PATH, 'utf8');
  assert.match(code, /stable app runtime/i);
  assert.doesNotMatch(code, /archived-app-runtime\.js/);
});

test('main module imports module bridge', async () => {
  const code = await readFile(MAIN_MODULE_PATH, 'utf8');
  assert.match(code, /module-bridge\.js/);
});

test('old split app directory is removed from active project tree', async () => {
  await assert.rejects(() => access(OLD_APP_DIR));
});
