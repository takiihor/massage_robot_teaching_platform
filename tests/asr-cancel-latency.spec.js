import { test, expect } from '@playwright/test';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

async function say(page, text, partial = false) {
  return page.evaluate(({ text, partial }) => {
    const started = performance.now();
    window.sttService.eventBus.emit(partial ? 'partial' : 'result', { text });
    return performance.now() - started;
  }, { text, partial });
}

const settings = page => page.evaluate(() => ({ ...window.APP_STATE.massage }));
const cancelledAudio = page => page.evaluate(() => window.__audioRequests.filter(id => id === 'system.cancelled'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('wakeWordEnabled', 'false');
    localStorage.setItem('wakeWordDefaultOnMigrated.20260706', 'true');
  });
  await page.route('**/robot/state', route => route.fulfill({ json: {
    connected: true, simulation_enabled: false, state: {}
  } }));
  await page.route('**/api/command', route => route.fulfill({ json: { status: 'success' } }));
  await page.route('**/api/stop', route => route.fulfill({ json: { status: 'success' } }));
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound && window.app);
  await page.evaluate(() => {
    window.__audioRequests = [];
    window.__audioStops = [];
    window.__robotCalls = [];
    window.audioManager = {
      playAsset: async id => { window.__audioRequests.push(id); return { ok: true }; },
      getStatus: () => ({ isPlaying: true, current: { assetId: 'system.choose_duration' } }),
      stop: reason => window.__audioStops.push(reason)
    };
    window.RobotController = { sendRobotCommand: async endpoint => {
      window.__robotCalls.push(endpoint);
      return true;
    } };
  });
});

for (const cancel of ['cancel', '取消', 'cancel massage settings', '取消按摩設定', '取消按摩设置', 'please cancel now']) {
  test(`${cancel} closes setup on interim recognition and ignores delayed duplicate finals`, async ({ page }) => {
    await page.evaluate(() => { document.getElementById('quickStartModeToggle').checked = true; });
    const snapshot = await settings(page);
    await say(page, '按摩設定');
    await say(page, '模式三');
    await say(page, '小');
    await say(page, '五', true);
    const dispatchMs = await say(page, cancel, true);
    expect(dispatchMs).toBeLessThan(100);
    await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
    await expect(page.locator('#voiceSetupBanner')).toHaveClass(/hidden/);
    await expect(page.locator('#voiceSetupPrompt')).toContainText('Voice setup cancelled');
    expect(await settings(page)).toEqual(snapshot);
    await expect(page.locator('#quickStartModeToggle')).toBeChecked();
    expect(await cancelledAudio(page)).toHaveLength(1);
    expect(await page.evaluate(() => window.__audioStops)).toContain('voice_setup_finished');
    const audioCount = await page.evaluate(() => window.__audioRequests.length);
    // A pending preview must not play over the cancellation response.
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__audioRequests.length)).toBe(audioCount);
    await say(page, cancel, true);
    await page.waitForTimeout(1300);
    await say(page, cancel);
    await say(page, cancel);
    await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
    expect(await cancelledAudio(page)).toHaveLength(1);
    expect(await settings(page)).toEqual(snapshot);
    expect(await page.evaluate(() => window.__robotCalls)).toEqual([]);
    await say(page, 'massage setting');
    await expect(page.locator('#voiceSetupPrompt')).toContainText('Select massage mode');
  });
}

test('cancel beats wake detection even when no setup is open', async ({ page }) => {
  const snapshot = await settings(page);
  for (const text of ['cancel massage settings', '取消按摩設定', 'cancel mode three start']) {
    await say(page, text, true);
    await say(page, text);
  }
  await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
  expect(await settings(page)).toEqual(snapshot);
  expect(await cancelledAudio(page)).toHaveLength(0);
  expect(await page.evaluate(() => window.__robotCalls)).toEqual([]);
});

test('negated cancel and cancellation-response echo leave a new setup open', async ({ page }) => {
  await say(page, '按摩設定');
  await say(page, '模式三');
  const snapshot = await settings(page);
  for (const text of ["don't cancel", 'do not cancel', '不要取消', '唔好取消',
    'Settings cancelled', '已取消', '已取消設定', '已取消设置', '請選擇模式，或者取消']) {
    await say(page, text, true);
    await say(page, text);
  }
  await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);
  expect(await settings(page)).toEqual(snapshot);
  expect(await cancelledAudio(page)).toHaveLength(0);
});

for (const [responseLanguage, command, filename] of [
  ['zh', 'cancel', '已取消設定.mp3'],
  ['en', '取消', 'Settings cancelled.mp3']
]) {
  test(`${responseLanguage} cancellation audio interrupts guidance before final recognition`, async ({ page }) => {
    await say(page, '按摩設定');
    const response = await page.evaluate(async ({ responseLanguage, command }) => {
      localStorage.setItem('voiceLanguage', responseLanguage);
      const manager = new window.AudioManager();
      window.audioManager = manager;
      const guidancePlaying = new Promise(resolve => manager.audioEl.addEventListener('playing', resolve, { once: true }));
      void manager.playAsset('system.choose_force', { ttlMs: 5000 });
      await guidancePlaying;
      const started = performance.now();
      const cancelPlaying = new Promise(resolve => manager.audioEl.addEventListener('playing', () => resolve({
        latencyMs: performance.now() - started,
        asset: manager.current?.assetId,
        url: decodeURIComponent(manager.audioEl.src)
      }), { once: true }));
      window.sttService.eventBus.emit('partial', { text: command });
      return await cancelPlaying;
    }, { responseLanguage, command });
    expect(response.latencyMs).toBeLessThan(1000);
    expect(response.asset).toBe('system.cancelled');
    expect(response.url).toContain(filename);
    await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
    await say(page, command);
    expect(await page.evaluate(() => window.audioManager.current?.assetId)).toBe('system.cancelled');
    await page.evaluate(() => window.audioManager.stop());
  });
}

test('cancel interrupts pending Start and its late acknowledgement cannot start a session', async ({ page }) => {
  await page.evaluate(() => {
    window.RobotController.sendRobotCommand = endpoint => {
      window.__robotCalls.push(endpoint);
      return endpoint === 'start' ? new Promise(resolve => { window.__confirmStart = resolve; }) : Promise.resolve(true);
    };
  });
  await say(page, 'massage setting mode three low intensity five minutes');
  await say(page, 'start');
  await page.waitForFunction(() => !!window.__confirmStart);
  await say(page, '取消', true);
  await expect.poll(() => page.evaluate(() => window.__robotCalls)).toEqual(['start', 'stop']);
  await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
  await page.evaluate(() => window.__confirmStart(true));
  await say(page, '取消');
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
});
