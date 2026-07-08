import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MassageListening.js', import.meta.url), 'utf8');

test('startContinuousMassageListening guards null recognition after init', () => {
  assert.match(source, /const recognition = deps\.getBrowserRecognition\(\);/);
  assert.match(source, /if \(!recognition\) \{/);
  assert.match(source, /recognition\.start\(\);/);
});

test('safeRestartMassageListening guards null recognition before restart', () => {
  assert.match(source, /const recognition = deps\.getBrowserRecognition\(\);/);
  assert.match(source, /if \(!recognition\) \{/);
  assert.match(source, /console\.warn\('⚠️ Recognition instance unavailable; restart skipped'\);/);
});
