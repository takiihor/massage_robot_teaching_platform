import { test, expect } from '@playwright/test';

async function say(page, text, partial = false) {
  await page.evaluate(({ text, partial }) => {
    window.sttService.eventBus.emit(partial ? 'partial' : 'result', { text, isFinal: !partial });
  }, { text, partial });
}

async function expectConfig(page, config) {
  await expect.poll(() => page.evaluate(() => {
    const { mode, intensity, durationMin } = window.APP_STATE.massage;
    return { mode, intensity, durationMin };
  })).toEqual(config);
}

async function mockRobot(page, connected = true, simulation = false) {
  await page.route('**/robot/state', route => route.fulfill({ json: {
    connected, simulation_enabled: simulation, state: {}
  } }));
  await page.evaluate(() => {
    window.__robotCalls = [];
    window.RobotController = { sendRobotCommand: async (endpoint, payload) => {
      window.__robotCalls.push({ endpoint, payload });
      return true;
    } };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route('**/robot/state', route => route.fulfill({ json: {
    connected: false, simulation_enabled: true, state: {}
  } }));
  await page.route('**/api/command', route => route.fulfill({ json: { status: 'success' } }));
  await page.route('**/api/stop', route => route.fulfill({ json: { status: 'success' } }));
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound && window.app);
  await page.evaluate(() => {
    window.__guidance = [];
    window.audioManager = {
      playAsset: async assetId => { window.__guidance.push(assetId); return { ok: true }; },
      getStatus: () => ({ isPlaying: false, current: null }),
      stop() {}
    };
  });
});

test('ASR complete English sequence requires every field and explicit start; interim stop ends it', async ({ page }) => {
  await say(page, 'massage setting', true);
  await say(page, 'massage setting');
  await say(page, 'start');
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select massage mode');
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  await say(page, 'massage mode two');
  await say(page, 'start');
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select intensity');
  await say(page, 'intensity medium');
  await say(page, 'start');
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select duration');
  await say(page, 'duration three minutes');
  await expectConfig(page, { mode: 2, intensity: 'mid', durationMin: 3 });
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Setup complete');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
  await say(page, 'start', true);
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
  await say(page, 'start');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await say(page, 'stop', true);
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
  await say(page, 'stop');
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  await expect(page.locator('#voiceSetupBanner')).toHaveClass(/hidden/);
});

test('ASR Cantonese sequence supports punctuation and bare step answers', async ({ page }) => {
  for (const text of ['按摩設定。', '模式三。', '小。', '五。']) await say(page, text);
  await expectConfig(page, { mode: 3, intensity: 'low', durationMin: 5 });
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Setup complete');
  await say(page, '開始');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await say(page, '停止按摩', true);
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
});

test('ASR preserves settings in the wake sentence and supports bare long durations', async ({ page }) => {
  await say(page, 'massage setting massage mode 1 intensity low');
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select duration');
  await say(page, 'twenty five.');
  await expectConfig(page, { mode: 1, intensity: 'low', durationMin: 25 });
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Setup complete');
  await say(page, 'duration 15');
  await expectConfig(page, { mode: 1, intensity: 'low', durationMin: 15 });
});

test('ASR rejects invalid settings instead of clamping or starting', async ({ page }) => {
  await say(page, 'massage setting');
  const initial = await page.evaluate(() => {
    const { mode, intensity, durationMin } = window.APP_STATE.massage;
    return { mode, intensity, durationMin };
  });
  for (const text of ['mode 5 start', 'mode 10 start', 'mode -1 start', 'mode 1.5 start',
    '模式十 開始', 'mode 2 high intensity 0 minutes start',
    'mode 2 high intensity 31 minutes start', 'mode 2 high intensity -5 minutes start',
    'mode 2 high intensity 1.5 minutes start', 'mode 2 high intensity thirty one minutes start',
    'mode 2 high intensity zero minutes start']) {
    await say(page, text);
    await expectConfig(page, initial);
    await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  }
});

test('ASR ignores guidance echo and negated start; corrections still work', async ({ page }) => {
  await say(page, 'massage setting');
  await say(page, 'Please select mode: mode 1, 2, 3, or 4.');
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select massage mode');
  await say(page, 'mode 2 high intensity 3 minutes');
  await say(page, 'Please confirm to start');
  await say(page, "don't start");
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
  await say(page, 'mode 4');
  await expectConfig(page, { mode: 4, intensity: 'high', durationMin: 3 });
  await say(page, 'start');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
});

test('ASR stop cancels incomplete setup and restores the snapshot', async ({ page }) => {
  await say(page, 'massage setting');
  await say(page, 'mode 1');
  await say(page, 'stop', true);
  await expectConfig(page, { mode: 4, intensity: 'mid', durationMin: 5 });
  await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
  await say(page, 'massage setting');
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Select massage mode');
});

test('ASR failed start keeps completed setup available for retry', async ({ page }) => {
  await mockRobot(page);
  await page.evaluate(() => { window.RobotController.sendRobotCommand = async () => false; });
  await say(page, 'massage setting mode 2 low intensity 3 minutes');
  await say(page, 'start');
  await expect(page.locator('#liveRegion')).toContainText('Unable to start');
  await expect(page.locator('#voiceSetupBanner')).not.toHaveClass(/hidden/);
  await expect(page.locator('#voiceSetupPrompt')).toContainText('Setup complete');
  await page.evaluate(() => { window.RobotController.sendRobotCommand = async () => true; });
  await say(page, 'start');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await say(page, 'stop');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
});

test('ASR duplicate start sends one command with correct payload', async ({ page }) => {
  await mockRobot(page);
  await page.evaluate(() => {
    window.RobotController.sendRobotCommand = async (endpoint, payload) => {
      window.__robotCalls.push({ endpoint, payload });
      if (endpoint === 'start') await new Promise(resolve => { window.__releaseStart = resolve; });
      return true;
    };
  });
  await say(page, 'mode 3 low intensity 3 minutes start');
  await page.waitForFunction(() => !!window.__releaseStart);
  await say(page, 'start');
  await page.evaluate(() => window.__releaseStart());
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  expect(await page.evaluate(() => window.__robotCalls)).toEqual([
    { endpoint: 'start', payload: { mode: 'spiral_press', intensity: '小', duration: 180, force_assist: false } }
  ]);
  await say(page, 'stop');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
});

test('ASR stop during robot startup is honored when startup returns', async ({ page }) => {
  await mockRobot(page);
  await page.evaluate(() => {
    window.RobotController.sendRobotCommand = async endpoint => {
      window.__robotCalls.push(endpoint);
      if (endpoint === 'start') await new Promise(resolve => { window.__releaseStart = resolve; });
      return true;
    };
  });
  await say(page, 'massage setting mode 2 medium intensity 3 minutes start');
  await page.waitForFunction(() => !!window.__releaseStart);
  await say(page, 'stop', true);
  await page.evaluate(() => window.__releaseStart());
  await expect.poll(() => page.evaluate(() => window.__robotCalls)).toEqual(['start', 'stop']);
  await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
});

test('ASR stop before health check returns prevents starting', async ({ page }) => {
  await mockRobot(page);
  let releaseHealth;
  const healthReady = new Promise(resolve => {
    page.route('**/robot/state', async route => {
      resolve();
      await new Promise(release => { releaseHealth = release; });
      await route.fulfill({ json: { connected: true, simulation_enabled: false } });
    });
  });
  await say(page, 'start');
  await healthReady;
  await say(page, 'stop');
  releaseHealth();
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
  expect(await page.evaluate(() => window.__robotCalls)).toEqual([]);
});

test('ASR failed physical stop stays active even after connection loss, and allows retry', async ({ page }) => {
  await mockRobot(page);
  await say(page, 'start');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await mockRobot(page, false, false);
  await page.evaluate(async () => {
    await window.app.refreshRobotHealth();
    window.__ended = 0;
    window.addEventListener('massageSessionEnded', () => window.__ended++);
    window.RobotController.sendRobotCommand = async endpoint => { window.__robotCalls.push(endpoint); return false; };
  });
  await say(page, 'stop');
  await expect(page.locator('#liveRegion')).toContainText('Robot stop failed');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  expect(await page.evaluate(() => window.__ended)).toBe(0);
  expect(await page.evaluate(() => window.__robotCalls)).toEqual(['stop']);
  await page.evaluate(() => { window.RobotController.sendRobotCommand = async () => true; });
  await say(page, 'stop');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
  expect(await page.evaluate(() => window.__ended)).toBe(1);
});

test('ASR disconnected robot requires explicit simulation; health failure cannot silently start', async ({ page }) => {
  await mockRobot(page, false, false);
  await say(page, 'start');
  await expect(page.locator('#liveRegion')).toContainText('Robot disconnected');
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  await page.route('**/robot/state', route => route.fulfill({ status: 503, json: {} }));
  await say(page, 'start');
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  await mockRobot(page, false, true);
  await say(page, 'start');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await say(page, 'stop');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
});

test('ASR repeated pause does not resume; explicit resume does', async ({ page }) => {
  await say(page, 'start');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await say(page, 'pause');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('PAUSED');
  await say(page, 'pause');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('PAUSED');
  await say(page, 'resume');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await say(page, 'stop');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
});

for (const [mode, intensity, durationMin, apiMode, apiIntensity] of [
  [1, 'low', 1, 'push_up', '小'],
  [2, 'mid', 3, 'wave_push', '中'],
  [3, 'high', 5, 'spiral_press', '大'],
  [4, 'mid', 30, 'knead', '中']
]) {
  test(`ASR mode ${mode} sends the selected intensity and duration to the robot`, async ({ page }) => {
    await mockRobot(page);
    await say(page, 'massage setting');
    await say(page, `massage mode ${mode}`);
    await say(page, `intensity ${intensity === 'mid' ? 'medium' : intensity}`);
    await say(page, `duration ${durationMin} minutes`);
    await say(page, 'start');
    await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
    expect(await page.evaluate(() => window.__robotCalls)).toEqual([
      { endpoint: 'start', payload: { mode: apiMode, intensity: apiIntensity, duration: durationMin * 60, force_assist: false } }
    ]);
    await say(page, 'stop');
    await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  });
}

test('ASR partial and final stop share one outstanding robot stop request', async ({ page }) => {
  await mockRobot(page);
  await say(page, 'start');
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  await page.evaluate(() => {
    window.__robotCalls = [];
    window.RobotController.sendRobotCommand = async endpoint => {
      window.__robotCalls.push(endpoint);
      await new Promise(resolve => { window.__releaseStop = resolve; });
      return true;
    };
  });
  await say(page, 'stop', true);
  await page.waitForFunction(() => !!window.__releaseStop);
  await say(page, 'stop');
  expect(await page.evaluate(() => window.__robotCalls)).toEqual(['stop']);
  await page.evaluate(() => window.__releaseStop());
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
});
