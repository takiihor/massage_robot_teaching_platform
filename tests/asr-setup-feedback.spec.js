import { test, expect } from '@playwright/test';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

async function say(page, text, partial = false) {
  await page.evaluate(({ text, partial }) => {
    window.sttService.eventBus.emit(partial ? 'partial' : 'result', { text });
  }, { text, partial });
}

const settings = page => page.evaluate(() => ({ ...window.APP_STATE.massage }));
const guidance = page => page.evaluate(() => [...window.__guidance]);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('wakeWordEnabled', 'false');
    localStorage.setItem('wakeWordDefaultOnMigrated.20260706', 'true');
  });
  // Install all hardware mocks before initialization, including session tests.
  await page.route('**/robot/state', route => route.fulfill({ json: {
    connected: true, simulation_enabled: false, state: {}
  } }));
  await page.route('**/api/command', route => route.fulfill({ json: { status: 'success' } }));
  await page.route('**/api/stop', route => route.fulfill({ json: { status: 'success' } }));
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound && window.app);
  await page.evaluate(() => {
    window.__guidance = [];
    window.__robotCalls = [];
    window.RobotController = { sendRobotCommand: async (endpoint, payload) => {
      window.__robotCalls.push({ endpoint, payload });
      return true;
    } };
    window.audioManager = {
      playAsset: async assetId => { window.__guidance.push(assetId); return { ok: true }; },
      getStatus: () => ({ isPlaying: false, current: null }), stop() {}
    };
  });
});

for (const [language, wake, mode, intensity, duration] of [
  ['Cantonese', '按摩設定', '三', '小', '五'],
  ['English', 'massage setting', 'three', 'low', 'five']
]) {
  test(`${language} selections preview early and advance prompts only after delayed finals`, async ({ page }) => {
    await say(page, wake);
    const steps = [
      [mode, 'mode', 3, 'system.choose_force', 'Select massage mode'],
      [intensity, 'intensity', 'low', 'system.choose_duration', 'Select intensity'],
      [duration, 'durationMin', 5, 'system.confirm_summary', 'Select duration']
    ];
    for (const [text, field, value, asset, prompt] of steps) {
      const before = await settings(page);
      const count = (await guidance(page)).length;
      const started = Date.now();
      await say(page, text, true);
      await expect(page.locator('#voiceSetupPrompt')).toContainText('Recognizing:', { timeout: 1000 });
      await expect(page.locator('#voiceSetupPrompt')).toContainText(prompt, { timeout: 1000 });
      expect(Date.now() - started).toBeLessThan(1000);
      expect(await settings(page)).toEqual(before);
      expect((await guidance(page)).length).toBe(count);
      // Longer than the old prompt deduplication window: interim feedback must
      // still leave the spoken workflow and bare-answer context at this step.
      await page.waitForTimeout(1600);
      await say(page, text);
      expect((await settings(page))[field]).toBe(value);
      expect((await guidance(page)).at(-1)).toBe(asset);
      expect((await guidance(page)).length).toBe(count + 1);
      expect(await page.evaluate(() => window.currentMassageSession)).toBeNull();
    }
    await expect(page.locator('#voiceSetupPrompt')).toContainText('Setup complete');
    await say(page, '開始', true);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__robotCalls)).toEqual([]);
    await say(page, '開始');
    await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
    expect(await page.evaluate(() => window.__robotCalls.map(call => call.endpoint))).toEqual(['start']);
  });
}

test('revised hypotheses cannot announce duration and then return to intensity', async ({ page }) => {
  await say(page, 'massage setting');
  await say(page, 'mode three', true);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Recognizing: Mode 3');
  await say(page, 'mode three low intensity', true);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Recognizing: Mode 3 · Low intensity');
  await say(page, 'mode three');
  await say(page, 'low');
  await say(page, 'five');
  expect(await guidance(page)).toEqual([
    'system.choose_mode', 'system.choose_force', 'system.choose_duration', 'system.confirm_summary'
  ]);
  expect(await settings(page)).toMatchObject({ mode: 3, intensity: 'low', durationMin: 5 });
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Setup complete');
});

test('late duplicate and corrected finals do not repeat the current question', async ({ page }) => {
  await say(page, 'massage setting');
  await say(page, 'mode three');
  await page.waitForTimeout(1600);
  await say(page, 'mode three');
  await say(page, 'mode two');
  await say(page, 'low');
  await page.waitForTimeout(1600);
  await say(page, 'low');
  await say(page, 'medium');
  expect(await guidance(page)).toEqual([
    'system.choose_mode', 'system.choose_force', 'system.choose_duration'
  ]);
  expect(await settings(page)).toMatchObject({ mode: 2, intensity: 'mid' });
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select duration');
});

for (const [language, wake, mode, intensity, duration] of [
  ['English', 'massage setting', 'mode three', 'low', 'five'],
  ['Cantonese', '按摩設定', '模式三', '小', '五']
]) {
  test(`${language} follows each step once, including drawer collapse and repeated wake results`, async ({ page }) => {
    await say(page, wake, true);
    await say(page, wake);
    await expect(page.locator('#voiceSetupPrompt')).toContainText('Select massage mode');
    const steps = [
      [mode, 'Select intensity', 'system.choose_force'],
      [intensity, 'Select duration', 'system.choose_duration'],
      [duration, 'Setup complete', 'system.confirm_summary']
    ];
    for (let i = 0; i < steps.length; i++) {
      const [text, nextPrompt, asset] = steps[i];
      await say(page, 'start');
      expect(await page.evaluate(() => window.__robotCalls)).toEqual([]);
      await say(page, text, true);
      await expect(page.locator('#voiceSetupPrompt')).toContainText('Recognizing:');
      expect((await guidance(page)).length).toBe(i + 1);
      await say(page, text);
      await expect(page.locator('#voiceSetupPrompt')).toContainText(nextPrompt);
      expect((await guidance(page)).at(-1)).toBe(asset);
      const before = await settings(page);
      await page.locator('#y65DrawerCollapseBtn').click();
      await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
      await say(page, wake, true);
      await say(page, wake);
      await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);
      await expect(page.locator('#voiceSetupPrompt')).toContainText(nextPrompt);
      expect(await settings(page)).toEqual(before);
      // Older finalized selections and invalid input cannot return the workflow
      // to an earlier question.
      for (const previous of steps.slice(0, i + 1)) await say(page, previous[0]);
      await say(page, 'mode ten');
      await say(page, '31 minutes');
      await expect(page.locator('#voiceSetupPrompt')).toContainText(nextPrompt);
      expect((await guidance(page)).length).toBe(i + 2);
    }
    expect(await guidance(page)).toEqual([
      'system.choose_mode', 'system.choose_force', 'system.choose_duration', 'system.confirm_summary'
    ]);
    expect(await settings(page)).toMatchObject({ mode: 3, intensity: 'low', durationMin: 5 });
    await page.evaluate(() => {
      window.sttService.eventBus.emit('stopped', {});
      window.sttService.eventBus.emit('started', {});
    });
    await expect(page.locator('#voiceSetupPrompt')).toContainText('Setup complete');
    await say(page, 'start', true);
    expect(await page.evaluate(() => window.__robotCalls)).toEqual([]);
    await say(page, 'start');
    await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
    expect(await page.evaluate(() => window.__robotCalls.map(call => call.endpoint))).toEqual(['start']);
  });
}

test('a revised or invalid final replaces interim feedback and preserves step context', async ({ page }) => {
  await say(page, '按摩設定');
  const before = await settings(page);
  await say(page, '模式三', true);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Recognizing: Mode 3');
  await say(page, '模式十');
  expect(await settings(page)).toEqual(before);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select massage mode');
  await say(page, '模式三', true);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Recognizing: Mode 3');
  await say(page, '模式二');
  expect((await settings(page)).mode).toBe(2);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Selected: Mode 2');
  await say(page, '小');
  await say(page, '五');
  expect(await settings(page)).toMatchObject({ mode: 2, intensity: 'low', durationMin: 5 });
});

test('rapid interim revisions settle once and Stop cancels pending feedback', async ({ page }) => {
  await say(page, '按摩設定');
  const count = (await guidance(page)).length;
  await page.evaluate(() => {
    for (const text of ['模式一', '模式三', '模式二']) {
      window.sttService.eventBus.emit('partial', { text });
    }
  });
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Recognizing: Mode 2');
  expect((await guidance(page)).length).toBe(count);
  await say(page, '模式二');
  await say(page, '小', true);
  await say(page, '停止', true);
  await page.waitForTimeout(300);
  await expect(page.locator('#voiceSetupBanner')).toHaveClass(/hidden/);
  expect((await guidance(page)).length).toBe(count + 1);
  expect(await settings(page)).toMatchObject({ mode: 4, intensity: 'mid', durationMin: 5 });
  await say(page, '按摩設定');
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select massage mode');
});

test('partial guidance echo and start intent cannot advance setup', async ({ page }) => {
  await say(page, '按摩設定');
  const before = await settings(page);
  const count = (await guidance(page)).length;
  for (const text of ['請選擇模式三', '模式三開始']) await say(page, text, true);
  await page.waitForTimeout(300);
  expect(await settings(page)).toEqual(before);
  expect((await guidance(page)).length).toBe(count);
  expect(await page.evaluate(() => window.__robotCalls)).toEqual([]);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select massage mode');
});

test('a fast final or recognition stop cancels the settling timer', async ({ page }) => {
  await say(page, '按摩設定');
  const count = (await guidance(page)).length;
  await page.evaluate(() => {
    window.sttService.eventBus.emit('partial', { text: '模式三' });
    window.sttService.eventBus.emit('result', { text: '模式三' });
  });
  await page.waitForTimeout(300);
  expect((await settings(page)).mode).toBe(3);
  expect((await guidance(page)).length).toBe(count + 1);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Selected: Mode 3');
  await page.evaluate(() => {
    window.sttService.eventBus.emit('partial', { text: '小' });
    window.sttService.eventBus.emit('stopped', {});
  });
  await page.waitForTimeout(300);
  expect((await settings(page)).intensity).toBe('mid');
  expect((await guidance(page)).length).toBe(count + 1);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select intensity');
});

test('Cantonese selection keeps early visual feedback and starts real audio promptly on final recognition', async ({ page }) => {
  await say(page, '按摩設定');
  const before = await settings(page);
  await say(page, '模式三', true);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Recognizing: Mode 3');
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select massage mode');
  expect(await settings(page)).toEqual(before);
  const latency = await page.evaluate(async () => {
    localStorage.setItem('voiceLanguage', 'zh');
    const manager = new window.AudioManager();
    window.audioManager = manager;
    const started = performance.now();
    const playing = new Promise(resolve => manager.audioEl.addEventListener('playing',
      () => resolve(performance.now() - started), { once: true }));
    window.sttService.eventBus.emit('result', { text: '模式三' });
    return await playing;
  });
  expect(latency).toBeLessThan(1000);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select intensity');
  expect((await settings(page)).mode).toBe(3);
  await page.evaluate(() => window.audioManager.stop());
});
