import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound && window.RobotController);
  await page.click('#settingsBtn');
});

test('connect and disconnect buttons establish confirmed backend state', async ({ page }) => {
  let connected = false;
  const connections = [];
  await page.route('**/robot/state', route => route.fulfill({ json: {
    connected, simulation_enabled: false, ip: '192.168.1.10', state: {}
  } }));
  await page.route('**/robot/connect', async route => {
    connections.push(route.request().postDataJSON());
    connected = true;
    await route.fulfill({ json: { ok: true, ip: '192.168.1.10' } });
  });
  await page.route('**/robot/disconnect', async route => {
    connected = false;
    await route.fulfill({ json: { ok: true } });
  });
  await page.fill('#robotIpInput', '192.168.1.10');
  await page.click('#robotConnectBtn');
  await expect(page.locator('#robotConnectionStatus')).toHaveText('🟢 Connected: 192.168.1.10');
  await expect(page.locator('#robotRtdeIoStatus')).toHaveText('RTDE IO: Connected');
  await expect(page.locator('#y65RobotStateText')).toHaveText('Robot: Connected');
  expect(connections).toEqual([{ ip: '192.168.1.10' }]);
  expect(await page.evaluate(() => localStorage.getItem('robotIp'))).toBe('192.168.1.10');
  await page.click('#robotDisconnectBtn');
  await expect(page.locator('#robotConnectionStatus')).toHaveText('⚪ Disconnected');
  await expect(page.locator('#y65RobotStateText')).toHaveText('Robot: Disconnected');
});

test('connect success enables a real start request with selected settings', async ({ page }) => {
  let connected = false;
  const starts = [];
  await page.route('**/robot/state', route => route.fulfill({ json: { connected, simulation_enabled: false } }));
  await page.route('**/robot/connect', async route => {
    connected = true;
    await route.fulfill({ json: { ok: true, ip: '192.168.1.10' } });
  });
  await page.route('**/api/command', async route => {
    starts.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, seq: 123 } });
  });
  await page.click('#robotConnectBtn');
  await expect(page.locator('#robotConnectionStatus')).toContainText('Connected');
  await page.evaluate(() => {
    window.app.setMassageConfig({ mode: 2, intensity: 'low', durationMin: 3 });
    window.sttService.eventBus.emit('result', { text: 'start' });
  });
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  expect(starts).toEqual([{ mode: 'wave_push', intensity: '小', duration: 180, force_assist: false }]);
});

test('unreachable robot reports backend connection detail and remains disconnected', async ({ page }) => {
  await page.route('**/robot/state', route => route.fulfill({ json: { connected: false, simulation_enabled: false } }));
  await page.route('**/robot/connect', route => route.fulfill({ status: 503, json: {
    detail: 'Robot 192.168.1.10 is not reachable (tcp/30004 unreachable).'
  } }));
  await page.click('#robotConnectBtn');
  await expect(page.locator('#liveRegion')).toContainText('tcp/30004 unreachable');
  await expect(page.locator('#robotConnectionStatus')).toHaveText('⚪ Disconnected');
  await expect(page.locator('#robotConnectBtn')).toBeEnabled();
  expect(await page.evaluate(() => window.APP_STATE.connection.connected)).toBe(false);
});

test('connecting disables duplicate requests and start waits for confirmation', async ({ page }) => {
  let releaseConnect;
  let connected = false;
  let connectCount = 0;
  const ready = new Promise(resolve => {
    page.route('**/robot/connect', async route => {
      connectCount++;
      resolve();
      await new Promise(release => { releaseConnect = release; });
      connected = true;
      await route.fulfill({ json: { ok: true, ip: '192.168.1.10' } });
    });
  });
  await page.route('**/robot/state', route => route.fulfill({ json: { connected, simulation_enabled: false } }));
  await page.click('#robotConnectBtn');
  await ready;
  await expect(page.locator('#robotConnectBtn')).toBeDisabled();
  await expect(page.locator('#robotDisconnectBtn')).toBeDisabled();
  await page.evaluate(() => window.sttService.eventBus.emit('result', { text: 'start' }));
  await expect(page.locator('#liveRegion')).toContainText('Wait for the robot connection');
  expect(await page.evaluate(() => window.currentMassageSession)).toBeNull();
  releaseConnect();
  await expect(page.locator('#robotConnectBtn')).toBeEnabled();
  expect(connectCount).toBe(1);
});

test('backend must confirm connection before the UI claims connected', async ({ page }) => {
  await page.route('**/robot/state', route => route.fulfill({ json: { connected: false, simulation_enabled: false } }));
  await page.route('**/robot/connect', route => route.fulfill({ json: { ok: true, ip: '192.168.1.10' } }));
  await page.click('#robotConnectBtn');
  await expect(page.locator('#liveRegion')).toContainText('could not confirm');
  await expect(page.locator('#robotConnectionStatus')).toHaveText('⚪ Disconnected');
});

test('real host rejection explains why motion did not start', async ({ page }) => {
  await page.route('**/robot/state', route => route.fulfill({ json: { connected: true, simulation_enabled: false } }));
  await page.route('**/api/command', route => route.fulfill({ json: {
    ok: false, error: 'PolyScope host program is not PLAYING',
    motion_possible: false,
    hint: 'Load the massage host program and press Play in PolyScope before starting massage.'
  } }));
  await page.evaluate(() => window.sttService.eventBus.emit('result', { text: 'start' }));
  await expect(page.locator('#liveRegion')).toContainText('host program is not PLAYING');
  await expect(page.locator('#liveRegion')).toContainText('press Play');
  expect(await page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
});

test('robot health uses the same API base as robot commands', async ({ page }) => {
  const healthURLs = [];
  await page.route('http://robot-api.test/robot/state', async route => {
    healthURLs.push(route.request().url());
    await route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
      connected: true, simulation_enabled: false, ip: '192.168.1.10'
    } });
  });
  await page.evaluate(async () => {
    window.API_URL = 'http://robot-api.test';
    await window.app.refreshRobotHealth();
  });
  expect(healthURLs).toEqual(['http://robot-api.test/robot/state']);
  expect(await page.evaluate(() => window.APP_STATE.connection.connected)).toBe(true);
});
