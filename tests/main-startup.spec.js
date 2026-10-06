import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('wakeWordEnabled', 'false');
    localStorage.setItem('wakeWordDefaultOnMigrated.20260706', 'true');
  });
  // Test the real served page and STT adapter, with robot operations isolated.
  await page.route('**/robot/state', route => route.fulfill({ json: {
    connected: true, simulation_enabled: false, state: {}
  } }));
  await page.route('**/api/command', route => route.fulfill({ json: { status: 'success' } }));
  await page.route('**/api/stop', route => route.fulfill({ json: { status: 'success' } }));
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound && window.__mainModuleInitialized);
});

test('main.py serves the current stable runtime once, with the correct server URL', async ({ page }) => {
  const entry = page.locator('script[src^="/static/app.js?"]');
  await expect(entry).toHaveCount(1);
  const entryUrl = await entry.getAttribute('src');
  const response = await page.request.get(entryUrl);
  expect(response.ok()).toBe(true);
  expect(await response.text()).toBe(await readFile(new URL('../static/app.js', import.meta.url), 'utf8'));
  expect(await page.evaluate(() => ({
    apiUrl: window.SERVER_CONFIG.api_url,
    origin: location.origin,
    stableHandler: window.app.handleTranscript === window.__stableHandleTranscript,
    initializationCount: window.__initAppCallCount
  }))).toEqual({
    apiUrl: new URL(page.url()).origin,
    origin: new URL(page.url()).origin,
    stableHandler: true,
    initializationCount: 1
  });
});

for (const [language, wake, mode, combined, intensity, duration] of [
  ['English', 'massage setting', 'mode three', 'mode three low intensity', 'low', 'five'],
  ['Cantonese', '按摩設定', '模式三', '模式三力度小', '小', '五']
]) {
  test(`${language}: main.py's page handles Azure messages without backward setup prompts`, async ({ page }) => {
    await page.evaluate(() => {
      window.__startupGuidance = [];
      window.audioManager = {
        playAsset: async assetId => { window.__startupGuidance.push(assetId); return { ok: true }; },
        getStatus: () => ({ current: null }), stop() {}
      };
    });
    const receive = (text, partial = false) => page.evaluate(({ text, partial }) => {
      window.sttService.providers.get('azure-speech-sdk')._handleMessage({
        type: partial ? 'partial' : 'final', text, confidence: partial ? 0 : 0.95
      });
    }, { text, partial });
    const prompt = page.locator('#voiceSetupPrompt');
    await receive(wake, true);
    await receive(wake);
    await expect(prompt).toContainText('Select massage mode');
    for (const hypothesis of [mode, combined]) {
      await receive(hypothesis, true);
      await expect(prompt).toContainText('Recognizing:');
      await expect(prompt).toContainText('Select massage mode');
    }
    await receive(mode);
    await expect(prompt).toContainText('Select intensity');
    await page.waitForTimeout(1600);
    await receive(mode);
    await expect(prompt).toContainText('Select intensity');
    await receive(intensity);
    await expect(prompt).toContainText('Select duration');
    await page.locator('#y65DrawerCollapseBtn').click();
    await receive(wake, true);
    await receive(wake);
    await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);
    await expect(prompt).toContainText('Select duration');
    await receive('0 minutes');
    await receive('start');
    await expect(prompt).toContainText('Select duration');
    expect(await page.evaluate(() => window.currentMassageSession)).toBeNull();
    await receive(duration);
    await expect(prompt).toContainText('Setup complete');
    await receive(mode);
    await receive(intensity);
    await expect(prompt).toContainText('Setup complete');
    expect(await page.evaluate(() => window.__startupGuidance)).toEqual([
      'system.choose_mode', 'system.choose_force', 'system.choose_duration', 'system.confirm_summary'
    ]);
    expect(await page.evaluate(() => ({ ...window.APP_STATE.massage }))).toMatchObject({
      mode: 3, intensity: 'low', durationMin: 5
    });
    await receive('start', true);
    expect(await page.evaluate(() => window.currentMassageSession)).toBeNull();
    await receive('start');
    await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
    await receive('stop', true);
    await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
  });
}
