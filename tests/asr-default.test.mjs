import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../static/app.js', import.meta.url), 'utf8');

async function harness(voiceLanguage) {
  const storage = new Map([['voiceLanguage', voiceLanguage], ['language', 'en']]);
  const recognitionLanguages = [];
  const callbacks = {};
  const badge = { textContent: '' };
  let active = false;
  const window = {
    Year65UI: {}, NursingVitalsMonitor: {}, NursingInstructorTools: {},
    setTimeout() {}, clearTimeout() {}, addEventListener() {}, dispatchEvent() {},
    sttService: {
      isActive: () => active,
      start: async language => { recognitionLanguages.push(language); active = true; },
      stop: async () => { active = false; },
      ...Object.fromEntries(['Result', 'Partial', 'Started', 'Stopped', 'Error'].map(name =>
        [`on${name}`, callback => { callbacks[name.toLowerCase()] = callback; }]))
    }
  };
  runInNewContext(source, {
    window, document: { getElementById: id => id === 'y65AsrLangText' ? badge : null }, console,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval: () => 1, clearInterval() {}, Event: class {},
    fetch: async () => ({ ok: true, json: async () => ({ connected: false }) })
  });
  await window.initApp();
  return { window, recognitionLanguages, badge, storage };
}

test('ASR always uses the Cantonese and English command profile regardless of saved voice preference', async () => {
  for (const voiceLanguage of ['en', 'zh', 'invalid']) {
    const { window, recognitionLanguages, badge, storage } = await harness(voiceLanguage);
    assert.equal(await window.startVoiceRecognition(), true);
    assert.deepEqual(recognitionLanguages, ['zh-HK']);
    assert.equal(badge.textContent, 'ASR 粵 / EN');
    // Changing language preferences also cannot change subsequent recognition.
    await window.stopVoiceRecognition();
    storage.set('voiceLanguage', voiceLanguage === 'en' ? 'zh' : 'en');
    storage.set('language', 'zh');
    assert.equal(await window.startVoiceRecognition(), true);
    assert.deepEqual(recognitionLanguages, ['zh-HK', 'zh-HK']);
  }
});
