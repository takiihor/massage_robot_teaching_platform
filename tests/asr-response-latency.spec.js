import { test, expect } from '@playwright/test';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound && window.AudioManager);
});

for (const [lang, wake, partial] of [['en', 'massage setting', 'massage set'], ['zh', '按摩設定', '按摩設']]) {
  test(`${lang} wake partial opens setup immediately while final recognition and audio are pending`, async ({ page }) => {
    let releaseAudio;
    const requested = new Promise(resolve => {
      page.route('**/assets/audio/**', async route => {
        if (route.request().method() === 'GET') {
          resolve();
          await new Promise(release => { releaseAudio = release; });
        }
        await route.continue();
      });
    });
    const response = await page.evaluate(({ lang, partial }) => {
      localStorage.setItem('voiceLanguage', lang);
      window.audioManager.stop();
      window.audioManager = new window.AudioManager();
      window.__playingCount = 0;
      window.audioManager.audioEl.addEventListener('playing', () => window.__playingCount++);
      const lib = window.AudioAssetLibrary.getInstance();
      lib.cache.delete(`${lang}:system.choose_mode`);
      lib.loadingPromises.set(`${lang}:system.choose_mode`, new Promise(() => {}));
      const started = performance.now();
      window.sttService.eventBus.emit('partial', { text: partial });
      return { ms: performance.now() - started,
        open: document.getElementById('y65StudentDrawer').classList.contains('open'),
        prompt: document.getElementById('voiceSetupPrompt').textContent };
    }, { lang, partial });
    expect(response.open).toBe(true);
    expect(response.prompt).toContain('Select massage mode');
    expect(response.ms).toBeLessThan(100);
    await requested;
    expect(await page.evaluate(() => window.__playingCount)).toBe(0);
    await page.evaluate(wake => window.sttService.eventBus.emit('result', { text: wake }), wake);
    releaseAudio();
    await expect.poll(() => page.evaluate(() => window.__playingCount)).toBe(1);
  });

  test(`${lang} spoken prompt bypasses slow metadata and a stalled background preload`, async ({ page }) => {
    let headRequests = 0;
    await page.route('**/assets/audio/**', async route => {
      if (route.request().method() === 'HEAD') {
        headRequests++;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      await route.continue();
    });
    const latencyMs = await page.evaluate(async lang => {
      localStorage.setItem('voiceLanguage', lang);
      const lib = window.AudioAssetLibrary.getInstance();
      lib.cache.delete(`${lang}:system.choose_mode`);
      lib.loadingPromises.set(`${lang}:system.choose_mode`, new Promise(() => {}));
      const manager = new window.AudioManager();
      const started = performance.now();
      const playing = new Promise(resolve => manager.audioEl.addEventListener('playing',
        () => resolve(performance.now() - started), { once: true }));
      const completion = manager.playAsset('system.choose_mode', { ttlMs: 5000 });
      const latency = await playing;
      manager.stop();
      await completion;
      return latency;
    }, lang);
    expect(latencyMs).toBeLessThan(500);
    expect(headRequests).toBe(0);
  });
}

test('a generic massage partial cannot open setup or start a session', async ({ page }) => {
  await page.evaluate(() => {
    window.sttService.eventBus.emit('partial', { text: 'massage' });
    window.sttService.eventBus.emit('partial', { text: '按摩' });
    window.sttService.eventBus.emit('result', { text: 'massage set' });
  });
  await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
  expect(await page.evaluate(() => window.currentMassageSession)).toBeNull();
});
