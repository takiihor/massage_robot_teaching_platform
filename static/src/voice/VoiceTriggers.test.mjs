import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./VoiceTriggers.js', import.meta.url), 'utf8');

test('defines SOFTSTOP trigger tokens including stop/pause/hold', () => {
  assert.match(source, /SOFTSTOP_MASSAGE\s*:/);
  assert.match(source, /SOFTSTOP_MASSAGE\s*:\s*\[[^\]]*'stop'/s);
  assert.match(source, /SOFTSTOP_MASSAGE\s*:\s*\[[^\]]*'pause'/s);
  assert.match(source, /SOFTSTOP_MASSAGE\s*:\s*\[[^\]]*'hold'/s);
});

test('defines ENDSESSION trigger tokens including end/endsession', () => {
  assert.match(source, /ENDSESSION_MASSAGE\s*:/);
  assert.match(source, /ENDSESSION_MASSAGE\s*:\s*\[[^\]]*'end'/s);
  assert.match(source, /ENDSESSION_MASSAGE\s*:\s*\[[^\]]*'endsession'/s);
  assert.match(source, /ENDSESSION_MASSAGE\s*:\s*\[[^\]]*'and session'/s);
});

test('does not classify emergency stop in trigger definitions', () => {
  assert.doesNotMatch(source, /emergency stop/i);
  assert.doesNotMatch(source, /緊急停止/);
});

test('does not keep ok/okay as confirm phrases after filler normalization', () => {
  assert.doesNotMatch(source, /CONFIRM_START\s*:\s*\[[^\]]*'ok'/s);
  assert.doesNotMatch(source, /CONFIRM_START\s*:\s*\[[^\]]*'okay'/s);
});

test('guards against empty normalized phrases in trigger loop', () => {
  assert.match(source, /if\s*\(!normalizedPhrase\)\s*return\s+false;/);
});
