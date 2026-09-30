import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { audioUnlocked: true };
class FakeAudio {
  constructor() { this.paused = true; this.loadCalls = 0; this.src = ''; }
  getAttribute(name) { return name === 'src' ? this.src : null; }
  removeAttribute() { this.src = ''; }
  load() { this.loadCalls++; }
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
}
globalThis.Audio = FakeAudio;
const { AudioAssetLibrary } = await import('../static/src/voice/AudioAssets.js');
const { AudioManager } = await import('../static/src/voice/AudioManager.js');

function fakeLibrary(lang) {
  // Model a stalled background preload: interactive playback must never join it.
  const lib = Object.create(AudioAssetLibrary.prototype);
  lib.cache = new Map();
  lib.loadingPromises = new Map([[`${lang}:system.choose_mode`, new Promise(() => {})]]);
  lib.stats = { cacheHits: 0, cacheMisses: 0 };
  lib.fileMappings = { [lang]: { system: { 'system.choose_mode': `${lang}-mode.mp3` } } };
  lib.languageMappings = { [lang]: { systemDir: `assets/${lang}` } };
  return lib;
}

for (const lang of ['en', 'zh']) {
  test(`uncached ${lang} prompt playback bypasses a stalled preload`, async t => {
    const previous = AudioAssetLibrary._instance;
    AudioAssetLibrary._instance = fakeLibrary(lang);
    globalThis.localStorage = { getItem: () => lang };
    t.after(() => { AudioAssetLibrary._instance = previous; });
    const asset = await AudioAssetLibrary.getAsset('system.choose_mode', { forPlayback: true });
    assert.equal(asset.url, `/assets/${lang}/${lang}-mode.mp3`);
    assert.equal(asset.lang, lang);
    const manager = new AudioManager();
    const completion = manager.playAsset('system.choose_mode');
    // One async asset-resolution turn is enough; no network or readiness wait.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(manager.audioEl.paused, false);
    assert.equal(manager.audioEl.loadCalls, 1);
    manager.audioEl.onended();
    assert.equal((await completion).ok, true);
  });
}

test('prepared prompt keeps its buffered source when wake playback starts', async t => {
  const previous = AudioAssetLibrary._instance;
  AudioAssetLibrary._instance = fakeLibrary('en');
  globalThis.localStorage = { getItem: () => 'en' };
  t.after(() => { AudioAssetLibrary._instance = previous; });
  const manager = new AudioManager();
  assert.equal(await manager.prepareAsset('system.choose_mode'), true);
  assert.equal(manager.audioEl.loadCalls, 1);
  const completion = manager.playAsset('system.choose_mode');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.audioEl.loadCalls, 1, 'must retain the prebuffered audio');
  manager.audioEl.onended();
  await completion;
});

test('stop cancels a prompt that is still resolving its asset', async t => {
  const original = AudioAssetLibrary.getAsset;
  let resolveAsset;
  AudioAssetLibrary.getAsset = () => new Promise(resolve => { resolveAsset = resolve; });
  t.after(() => { AudioAssetLibrary.getAsset = original; });
  const manager = new AudioManager();
  const completion = manager.playAsset('system.choose_mode');
  manager.stop();
  resolveAsset({ url: '/old-prompt.mp3' });
  assert.equal((await completion).reason, 'superseded');
  assert.equal(manager.audioEl.src, '');
  assert.equal(manager.audioEl.paused, true);
});

test('a delayed older prompt cannot replace the next setup step', async t => {
  const original = AudioAssetLibrary.getAsset;
  let resolveFirst;
  AudioAssetLibrary.getAsset = id => id === 'first'
    ? new Promise(resolve => { resolveFirst = resolve; })
    : Promise.resolve({ url: '/next-step.mp3' });
  t.after(() => { AudioAssetLibrary.getAsset = original; });
  const manager = new AudioManager();
  const first = manager.playAsset('first');
  const second = manager.playAsset('second');
  await new Promise(resolve => setImmediate(resolve));
  resolveFirst({ url: '/old-step.mp3' });
  assert.equal((await first).reason, 'superseded');
  assert.equal(manager.audioEl.src, '/next-step.mp3');
  manager.audioEl.onended();
  assert.equal((await second).ok, true);
});
