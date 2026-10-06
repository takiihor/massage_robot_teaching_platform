import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('voiceLanguage', 'en');
    localStorage.setItem('language', 'en');
    localStorage.setItem('wakeWordEnabled', 'false');
    localStorage.setItem('wakeWordDefaultOnMigrated.20260706', 'true');
    window.__recognitionStarts = 0;
    window.SpeechRecognition = class {
      start() { window.__recognitionStarts++; }
      stop() {}
    };
  });
  await page.route('**/robot/state', route => route.fulfill({ json: {
    connected: false, simulation_enabled: true, state: {}
  } }));
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound && window.sttService);
  await page.evaluate(() => {
    window.sttService.currentProvider = 'browser';
    window.audioManager = { stop() {}, getStatus: () => ({ isPlaying: false }),
      playAsset: async () => ({ ok: true }), prepareAsset: async () => true };
  });
});

test('saved English response preference uses the Cantonese ASR profile and changing responses does not restart it', async ({ page }) => {
  await expect(page.locator('#y65AsrLangText')).toHaveText('ASR 粵 / EN');
  await page.evaluate(() => window.startVoiceRecognition());
  const recognitionState = () => page.evaluate(() => ({
    language: window.sttService.providers.get('browser').recognition.lang,
    starts: window.__recognitionStarts,
    active: window.sttService.isActive()
  }));
  expect(await recognitionState()).toEqual({ language: 'zh-HK', starts: 1, active: true });
  await page.click('#settingsBtn');
  await expect(page.locator('label[for="voiceLanguageSelect"]')).toContainText('Voice Response Language');
  await page.selectOption('#voiceLanguageSelect', 'zh');
  await page.selectOption('#voiceLanguageSelect', 'en');
  expect(await recognitionState()).toEqual({ language: 'zh-HK', starts: 1, active: true });
  const asset = await page.evaluate(async () => {
    const selected = await window.AudioAssetLibrary.getAsset('system.choose_mode', { forPlayback: true });
    return { language: selected.lang, url: decodeURIComponent(selected.url) };
  });
  expect(asset.language).toBe('en');
  expect(asset.url).toContain('/system_female_english/');
});

test('the same recognizer routes Cantonese and English setup and Stop commands', async ({ page }) => {
  await page.evaluate(() => window.startVoiceRecognition());
  const say = text => page.evaluate(text => {
    const result = Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: true });
    window.sttService.providers.get('browser').recognition.onresult({ resultIndex: 0, results: [result] });
  }, text);
  await say('按摩設定');
  await say('mode two');
  await say('小');
  await say('three minutes');
  expect(await page.evaluate(() => ({ ...window.APP_STATE.massage }))).toMatchObject({
    mode: 2, intensity: 'low', durationMin: 3
  });
  await say('開始');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await say('stop');
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  await say('massage setting');
  await say('模式三');
  await say('medium');
  await say('五分鐘');
  expect(await page.evaluate(() => ({ ...window.APP_STATE.massage }))).toMatchObject({
    mode: 3, intensity: 'mid', durationMin: 5
  });
  await say('start');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await say('停止');
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  expect(await page.evaluate(() => window.__recognitionStarts)).toBe(1);
});
