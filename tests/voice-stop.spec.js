import { test, expect } from '@playwright/test';

// All robot routes are stubbed before page load; these tests never command hardware.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('wakeWordEnabled', 'false');
    localStorage.setItem('wakeWordDefaultOnMigrated.20260706', 'true');
  });
  await page.route('**/robot/state', route => route.fulfill({ json: {
    connected: true, simulation_enabled: false, state: {}
  } }));
  await page.route('**/api/command', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/stop', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound && window.RobotController);
});

const speak = (page, text, partial = true) => page.evaluate(({ text, partial }) => {
  window.sttService.eventBus.emit(partial ? 'partial' : 'result', { text });
}, { text, partial });

test('interim please stop reaches the Stop API before Start responds', async ({ page }) => {
  let releaseStart;
  let startReceived;
  const starting = new Promise(resolve => { startReceived = resolve; });
  let stopCount = 0;
  await page.route('**/api/command', async route => {
    startReceived();
    await new Promise(resolve => { releaseStart = resolve; });
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/stop', async route => {
    stopCount++;
    await route.fulfill({ json: { ok: true } });
  });
  await page.evaluate(() => { window.__stopTestStarting = window.app.startMassage(); });
  await starting;
  await speak(page, 'please stop now');
  await expect.poll(() => stopCount).toBe(1);
  releaseStart();
  await page.evaluate(() => window.__stopTestStarting);
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
});

test('repeated interim and final Stop share one request until confirmation', async ({ page }) => {
  await speak(page, 'start', false);
  await expect.poll(() => page.evaluate(() => window.APP_STATE.uiMode)).toBe('RUNNING');
  let stopCount = 0;
  let confirmStop;
  await page.route('**/api/stop', async route => {
    stopCount++;
    await new Promise(resolve => { confirmStop = resolve; });
    await route.fulfill({ json: { ok: true } });
  });
  await speak(page, 'stop');
  await expect.poll(() => stopCount).toBe(1);
  await speak(page, 'stop massage please');
  await speak(page, 'stop', false);
  expect(stopCount).toBe(1);
  expect(await page.evaluate(() => !!window.currentMassageSession)).toBe(true);
  confirmStop();
  await expect.poll(() => page.evaluate(() => window.currentMassageSession)).toBeNull();
});
