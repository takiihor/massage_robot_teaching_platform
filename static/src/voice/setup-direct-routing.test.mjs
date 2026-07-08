import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Recognition.js', import.meta.url), 'utf8');

test('setup direct routing is gated by setup mode', () => {
  assert.match(source, /const inSetupMode = !!isMassageSetupMode/);
  assert.match(source, /\|\| \(typeof stateMachine !== 'undefined' && stateMachine\?\.isInSetup\?\.\(\)\);/);
  assert.match(
    source,
    /if \(transcriptText && inSetupMode && typeof processMassageSetupInput === 'function'\)/
  );
});
