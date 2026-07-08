import test from 'node:test';
import assert from 'node:assert/strict';

test('VoiceTriggers exports engineering key helper', async () => {
  globalThis.window = {};
  const VoiceTriggers = await import('./VoiceTriggers.js');
  assert.equal(typeof VoiceTriggers.getEngineeringKeyForTrigger, 'function');
});
