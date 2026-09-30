import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./year65_v3_avatar_v3.html', import.meta.url), 'utf8');

test('year65 quick mode uses a single direct end-session control', () => {
  assert.doesNotMatch(html, /id="y65MiniBar"/);
  assert.doesNotMatch(html, /id="y65MiniPauseBtn"/);
  assert.doesNotMatch(html, /id="y65MiniStopBtn"/);
  assert.match(html, /id="y65FrontStopBtn"[^>]*>End Session \/ 結束<\/button>/);
});

test('year65 page references cache-busted stable runtime scripts', () => {
  assert.match(html, /src="\/static\/app\.js\?v=112"/);
  assert.match(html, /src="\/static\/main\.module\.js\?v=101"/);
});

test('year65 page does not reference removed placeholder browser assets', () => {
  assert.match(html, /<link rel="icon" href="data:,">/);
  assert.doesNotMatch(html, /student_prompt\.mp3/);
  assert.doesNotMatch(html, /id="actionPromptAudio"/);
});
