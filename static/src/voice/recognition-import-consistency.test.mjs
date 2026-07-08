import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridgeSource = readFileSync(new URL('../../module-bridge.js', import.meta.url), 'utf8');

test('module bridge uses canonical Recognition import path without query suffix', () => {
  assert.match(bridgeSource, /from '\.\/src\/voice\/Recognition\.js';/);
  assert.doesNotMatch(bridgeSource, /Recognition\.js\?v=\d+/);
});
