import { test, expect } from '@playwright/test';

const healthyState = () => ({
  connected: true, simulation_enabled: false, connection_id: 1,
  state: {
    measurement_error: null,
    actual_TCP_force: [0, 0, 2, 0, 0, 0],
    program_state: 'PLAYING massage_robot.urp', safety_status: 'Safetystatus: NORMAL',
    urscript_state: { state: 0, error_code: 0, ack_seq: 0 }
  }
});

test('NaN warning stays visible, preserves voice settings, and clears on recovery without starting', async ({ page }) => {
  let health = healthyState();
  health.state.actual_TCP_force = [null, null, null, 0, 0, 0];
  health.state.measurement_error = {
    code: 'INVALID_FORCE', error: 'Robot force/torque readings are invalid; motion is blocked',
    invalid_components: ['Fx', 'Fy', 'Fz']
  };
  const starts = [];
  const stops = [];
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.route('**/api/command', async route => {
    starts.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: false, motion_possible: false, error: health.state.measurement_error.error } });
  });
  await page.route('**/api/stop', route => { stops.push(true); return route.fulfill({ json: { ok: true } }); });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound && window.app);
  await expect(page.locator('#robotWarning')).toBeVisible();
  await expect(page.locator('#robotWarningTitle')).toContainText('NaN');
  await expect(page.locator('#robotWarningMessage')).toContainText('Fx, Fy, Fz');
  await expect(page.locator('#y65RobotStateText')).toHaveText('Robot: Connected');
  await page.evaluate(() => {
    window.sttService.eventBus.emit('result', { text: 'mode 2 low intensity 3 minutes' });
    window.sttService.eventBus.emit('result', { text: 'start' });
  });
  await expect.poll(() => starts.length).toBe(1);
  await expect(page.locator('#liveRegion')).toContainText('motion is blocked');
  await expect(page.locator('#robotWarning')).toBeVisible();
  expect(starts[0]).toEqual({ mode: 'wave_push', intensity: '小', duration: 180, force_assist: false });
  expect(stops).toHaveLength(0);
  expect(await page.evaluate(() => window.APP_STATE.uiMode)).toBe('SETUP');
  expect(await page.evaluate(() => window.APP_STATE.massage)).toMatchObject({ mode: 2, intensity: 'low', durationMin: 3 });
  health = healthyState();
  await page.evaluate(() => window.app.refreshRobotHealth());
  await expect(page.locator('#robotWarning')).toBeHidden();
  expect(starts).toHaveLength(1);
});

test('older status responses with null force readings still display a warning', async ({ page }) => {
  const health = healthyState();
  delete health.state.measurement_error;
  health.state.actual_TCP_force[2] = null;
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.goto('/');
  await expect(page.locator('#robotWarning')).toBeVisible();
  await expect(page.locator('#robotWarningMessage')).toContainText('Fz');
});

test('compact warning stays left of ASR without shifting the dashboard or voice setup', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const health = healthyState();
  health.state.actual_TCP_force[0] = null;
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.goto('/');
  await page.waitForFunction(() => window.__stableSttBound);
  const warning = await page.locator('#robotWarning').boundingBox();
  const asr = await page.locator('#y65AsrToggle').boundingBox();
  expect(warning.x + warning.width).toBeLessThanOrEqual(asr.x);
  expect(warning.height).toBeLessThanOrEqual(40);
  expect(warning.width).toBeLessThanOrEqual(220);
  expect(await page.locator('.y65-dashboard').evaluate(node => getComputedStyle(node).paddingTop)).toBe('70px');
  await page.evaluate(() => window.sttService.eventBus.emit('result', { text: 'massage settings' }));
  await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);
  await expect(page.locator('#robotWarning')).toBeVisible();
  const start = await page.locator('#y65MassagePanelRoot [data-action="startMassage"]').boundingBox();
  expect(start.y).toBeGreaterThan(warning.y + warning.height);
  const voice = await page.locator('#voiceSetupBanner').boundingBox();
  expect(voice.y).toBeGreaterThan(warning.y + warning.height);
});

test('program stopped warning is small by default and exposes details on click or keyboard', async ({ page }) => {
  let health = healthyState();
  health.state.program_state = 'STOPPED massage_robot.urp';
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.goto('/');
  await expect(page.locator('#robotWarningLabel')).toHaveText('Robot: Program stopped');
  await expect(page.locator('#robotWarningTitle')).toBeHidden();
  await page.screenshot({ path: '/tmp/massage-robot-warning-compact.png' });
  await page.click('#robotWarningToggle');
  await expect(page.locator('#robotWarningTitle')).toBeVisible();
  await expect(page.locator('#robotWarningHint')).toContainText('press Play');
  await page.locator('#robotWarningToggle').press('Enter');
  await expect(page.locator('#robotWarningTitle')).toBeHidden();
  health = healthyState();
  await page.evaluate(() => window.app.refreshRobotHealth());
  await expect(page.locator('#robotWarning')).toBeHidden();
});

test('force warning during a session leaves the operator Stop available', async ({ page }) => {
  const health = healthyState();
  const stops = [];
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.route('**/api/command', route => route.fulfill({ json: { ok: true, seq: 1, connection_id: 1 } }));
  await page.route('**/api/stop', route => { stops.push(true); return route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await page.waitForFunction(() => window.app);
  await page.evaluate(() => window.app.startMassage());
  health.state.urscript_state = { state: 1, error_code: 0, ack_seq: 1 };
  health.state.actual_TCP_force[0] = null;
  await page.evaluate(() => window.app.refreshRobotHealth());
  await expect(page.locator('#robotWarning')).toBeVisible();
  const stop = page.locator('#btnStudentStop:visible, #y65FrontStopBtn:visible');
  await expect(stop).toBeVisible();
  await stop.click();
  await expect.poll(() => stops.length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.currentMassageSession === null)).toBe(true);
});

test('controller faults, stale readings, program stops, and connection failures are visible', async ({ page }) => {
  let health = healthyState();
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.goto('/');
  await page.waitForFunction(() => window.app);
  for (const [patch, text] of [
    [{ urscript_state: { state: 0, error_code: 5 } }, 'heartbeat'],
    [{ urscript_state: { state: 0, error_code: 2 } }, 'excessive or invalid force'],
    [{ safety_status: 'Safetystatus: PROTECTIVE_STOP' }, 'PROTECTIVE_STOP'],
    [{ program_state: 'STOPPED massage_robot.urp' }, 'Start and Resume are blocked'],
    [{ measurement_error: { code: 'STALE_TELEMETRY', error: 'Fresh robot telemetry is required before motion', hint: 'Check the robot connection.' } }, 'Fresh robot telemetry'],
    [{ measurement_error: { code: 'INVALID_POSE', error: 'Robot TCP pose is invalid; motion is blocked', hint: 'Check the pendant.' } }, 'TCP pose is invalid']
  ]) {
    health = healthyState();
    Object.assign(health.state, patch);
    await page.evaluate(() => window.app.refreshRobotHealth());
    await expect(page.locator('#robotWarning')).toBeVisible();
    await expect(page.locator('#robotWarningMessage')).toContainText(text);
  }
  health = { connected: false, simulation_enabled: false };
  await page.evaluate(() => window.app.refreshRobotHealth());
  await expect(page.locator('#robotWarningTitle')).toHaveText('Robot disconnected');
  await page.unroute('**/robot/state');
  await page.route('**/robot/state', route => route.abort());
  await page.evaluate(() => window.app.refreshRobotHealth());
  await expect(page.locator('#robotWarningTitle')).toHaveText('Robot connection unavailable');
  await expect(page.locator('#robotWarningHint')).toContainText('pendant');
});

test('healthy and teaching simulation modes do not show a robot warning', async ({ page }) => {
  let health = healthyState();
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.goto('/');
  await page.waitForFunction(() => window.app);
  await expect(page.locator('#robotWarning')).toBeHidden();
  health = { connected: false, simulation_enabled: true };
  await page.evaluate(() => window.app.refreshRobotHealth());
  await expect(page.locator('#robotWarning')).toBeHidden();
});

test('latched overload displays the recorded trigger after current force returns to normal', async ({ page }) => {
  const health = healthyState();
  health.state.urscript_state = {
    state: 0, error_code: 2, ack_seq: 12,
    diagnostics: { available: true, fault: {
      reason: 'overforce', action: 'gripper closing', session_elapsed_s: 24.018,
      force_n: [0, 0, -31], force_magnitude_n: 31, limit_n: 25, invalid_components: []
    } }
  };
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.goto('/');
  await expect(page.locator('#robotWarningLabel')).toHaveText('Robot: Force stop');
  await expect(page.locator('#robotWarningMessage')).toContainText('exceeded 25 N');
  await expect(page.locator('#robotWarningMessage')).toContainText('gripper closing');
  await expect(page.locator('#robotWarningMessage')).toContainText('24.02 s');
  await expect(page.locator('#robotWarningMessage')).toContainText('31.0 N');
  await expect(page.locator('#robotWarningHint')).toContainText('press Stop');
});

test('invalid-force fault remains visible after sensor recovery and ends the session without travel', async ({ page }) => {
  let health = healthyState();
  const stops = [];
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.route('**/api/command', route => route.fulfill({ json: { ok: true, seq: 1, connection_id: 1 } }));
  await page.route('**/api/stop', route => { stops.push(true); return route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await page.waitForFunction(() => window.app);
  await page.evaluate(() => window.app.startMassage());
  health.state.urscript_state = {
    state: 0, error_code: 6, ack_seq: 1,
    diagnostics: { available: true, fault: {
      reason: 'invalid_force_sample', action: 'gripper closing', session_elapsed_s: 24,
      force_n: [null, 1, null], force_magnitude_n: null, limit_n: 25, invalid_components: ['Fx', 'Fz']
    } }
  };
  await page.evaluate(() => window.app.refreshRobotHealth());
  await expect(page.locator('#robotWarningLabel')).toHaveText('Robot: Invalid force');
  await expect(page.locator('#robotWarningMessage')).toContainText('invalid readings: Fx, Fz');
  await expect.poll(() => page.evaluate(() => window.currentMassageSession === null)).toBe(true);
  expect(stops).toHaveLength(0);
});

test('old pendant program shows an update requirement until the new program reports readiness', async ({ page }) => {
  const health = healthyState();
  health.state.urscript_state.diagnostics = { available: false };
  const starts = [];
  await page.route('**/robot/state', route => route.fulfill({ json: health }));
  await page.route('**/api/command', route => { starts.push(true); return route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await expect(page.locator('#robotWarningLabel')).toHaveText('Robot: Update required');
  await expect(page.locator('#robotWarningMessage')).toContainText('ur10e_demo_smooth_27.urs');
  health.state.urscript_state.diagnostics = { available: true, fault: null };
  await page.evaluate(() => window.app.refreshRobotHealth());
  await expect(page.locator('#robotWarning')).toBeHidden();
  expect(starts).toHaveLength(0);
});
