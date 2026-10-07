/**
 * Scenario 1 & 2 Flow Tests
 * Browser smoke coverage for the daily teaching build.
 */

import { test, expect } from '@playwright/test';

// Navigate relatively so the URL comes from playwright.config.cjs `baseURL`
// (TEST_URL, then $PORT, then PORT= in .env).  The hard-coded
// http://localhost:5000 here overrode that and pointed the suite at a dead port
// whenever the app ran on anything other than 5000.
const BASE_URL = process.env.TEST_URL || '/';
const INSTRUCTOR_PIN = process.env.INSTRUCTOR_PIN || '1234';

async function openInstructorOverlay(page) {
  await page.click('#y65InstructorEntry');
  await expect(page.locator('#y65PinModal')).toBeVisible();
  await page.fill('#y65PinInput', INSTRUCTOR_PIN);
  await page.click('#y65PinSubmit');
  await expect(page.locator('#teachingOverlay')).toHaveAttribute('aria-hidden', 'false');
}

async function openLiveTab(page) {
  await page.click('.teaching-tab-btn[data-tab="live"]');
  await expect(page.locator('#teachingScenarioSelect')).toBeVisible();
}

async function closeInstructorOverlay(page) {
  await page.click('#teachingOverlayClose');
  await expect(page.locator('#teachingOverlay')).toHaveAttribute('aria-hidden', 'true');
}

async function startVirtualSession(page) {
  await closeInstructorOverlay(page);
  await page.click('#y65FrontStartBtn');
  await expect(page.locator('#y65UiModeText')).toContainText(/進行中|RUNNING|進行/);
}

async function expectVitalNear(page, selector, expected, tolerance = 2) {
  await expect.poll(async () => {
    const text = await page.textContent(selector);
    return Number.parseInt(text || '', 10);
  }).toBeGreaterThanOrEqual(expected - tolerance);
  await expect.poll(async () => {
    const text = await page.textContent(selector);
    return Number.parseInt(text || '', 10);
  }).toBeLessThanOrEqual(expected + tolerance);
}

test.describe('Scenario Flow Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });
    // Scenario playback is explicitly virtual and must never depend on the
    // server's robot configuration or accidentally send commands to hardware.
    await page.route('**/robot/state', route => route.fulfill({ json: {
      connected: false, simulation_enabled: true
    } }));
    await page.route(/^https?:\/\/[^/]+\/(?:api\/(?:command|stop)|massage\/[^/?]+|robot\/(?:connect|disconnect|jog\/[^/?]+))(?:\?.*)?$/,
      route => route.fulfill({ status: 503, json: { ok: false, error: 'Hardware is isolated in scenario tests' } }));
    await page.goto(BASE_URL);
    await page.waitForSelector('#year65App', { timeout: 10000 });
    await page.waitForFunction(() => window.__stableSttBound && window.__ARCH_REFACTOR_COMPLETE, null, { timeout: 10000 });
  });

  test('loads Scenario 1 and applies baseline vitals after session start', async ({ page }) => {
    await openInstructorOverlay(page);
    await openLiveTab(page);
    await page.selectOption('#teachingScenarioSelect', 'scenario_1');
    await expect(page.locator('#teachingScenarioBadge')).toContainText('S1');

    await startVirtualSession(page);
    await expectVitalNear(page, '#vitalHR', 89, 3);
    await expectVitalNear(page, '#vitalSPO2', 97, 1);
    await expect(page.locator('#y65ScenarioChip')).toContainText('S1');
  });

  test('loads Scenario 2 and verifies badge', async ({ page }) => {
    await openInstructorOverlay(page);
    await openLiveTab(page);
    await page.selectOption('#teachingScenarioSelect', 'scenario_2');
    await expect(page.locator('#teachingScenarioBadge')).toContainText('S2');
    await expect(page.locator('#teachingScenarioSelect')).toHaveValue('scenario_2');
  });

  test('hotkeys select scenario 0, scenario 1, scenario 2, and off', async ({ page }) => {
    await openInstructorOverlay(page);
    await page.keyboard.press('F6');
    await expect(page.locator('#teachingScenarioSelect')).toHaveValue('scenario_0');
    await expect(page.locator('#teachingScenarioBadge')).toContainText('S0');
    await page.keyboard.press('F7');
    await expect(page.locator('#teachingScenarioSelect')).toHaveValue('scenario_1');
    await page.keyboard.press('F8');
    await expect(page.locator('#teachingScenarioSelect')).toHaveValue('scenario_2');
    await page.keyboard.press('F9');
    await expect(page.locator('#teachingScenarioSelect')).toHaveValue('off');
  });

  test('flowchart opens from badge and quick select buttons', async ({ page }) => {
    await openInstructorOverlay(page);
    await openLiveTab(page);
    await page.selectOption('#teachingScenarioSelect', 'scenario_1');
    await page.click('#teachingScenarioBadge');
    await expect(page.locator('#scenarioFlowModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#scenarioFlowModal')).toBeHidden();

    await page.click('#quickSelectS1');
    await expect(page.locator('#scenarioFlowModal')).toBeVisible();
    await expect(page.locator('.sf-tab-btn.active.s1')).toHaveCount(1);
    await page.click('.sf-tab-btn.s2');
    await expect(page.locator('.sf-tab-btn.active.s2')).toHaveCount(1);
  });

  test('virtual timer hides when off and shows during active scenario', async ({ page }) => {
    await openInstructorOverlay(page);
    await openLiveTab(page);
    await page.selectOption('#teachingScenarioSelect', 'off');
    await expect(page.locator('#y65VirtualTimeContainer')).toBeHidden();

    await page.selectOption('#teachingScenarioSelect', 'scenario_1');
    await startVirtualSession(page);
    await expect(page.locator('#y65VirtualTimeContainer')).toBeVisible();
    await expect(page.locator('#y65VirtualTimeText')).toContainText('00:00');
  });

  test('Scenario 0 starts massage with keyboard expression mode', async ({ page }) => {
    await openInstructorOverlay(page);
    await openLiveTab(page);
    await page.selectOption('#teachingScenarioSelect', 'scenario_0');
    await expect(page.locator('#teachingScenarioBadge')).toContainText('S0');

    await startVirtualSession(page);
    await expect(page.locator('#y65ScenarioChip')).toContainText('S0');
    await expect(page.locator('#y65ExpressionModeText')).toContainText('Keyboard');
    await expect(page.locator('#y65VirtualTimeContainer')).toBeHidden();

    await page.keyboard.press('2');
    await expect(page.locator('#y65ExpressionPresetText')).toContainText('Mild Anxiety');
    await expect.poll(() => page.evaluate(() => window.nursingVitalsMonitorInstance?.getTeachingLiveState?.().activePresetId)).toBe('mild_anxiety');
  });

  test('quick start uses locked knead medium 5 minute configuration', async ({ page }) => {
    await expect.poll(() => page.evaluate(() => document.getElementById('quickStartModeToggle')?.checked)).toBe(true);
    await page.click('#y65FrontStartBtn');

    await expect.poll(() => page.evaluate(() => window.APP_STATE?.uiMode)).toBe('RUNNING');
    await expect.poll(() => page.evaluate(() => ({
      dotColor: getComputedStyle(document.getElementById('y65ConnDot')).backgroundColor,
      statusMode: document.getElementById('y65StatusPill')?.dataset.uiMode,
      robotConnected: window.APP_STATE?.connection?.connected
    }))).toEqual({
      dotColor: 'rgb(46, 204, 113)', statusMode: 'running', robotConnected: false
    });
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin,
      totalSec: window.currentMassageSession?.totalSec
    }))).toEqual({
      mode: 4,
      intensity: 'mid',
      durationMin: 5,
      totalSec: 300
    });

    await page.click('#y65FrontStopBtn');
    await expect.poll(() => page.evaluate(() => window.APP_STATE?.uiMode)).toBe('SETUP');
  });

  test('non-quick drawer honors selected mode intensity and duration without internal scroll', async ({ page }) => {
    await page.evaluate(() => {
      const toggle = document.getElementById('quickStartModeToggle');
      if (toggle) {
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await expect(page.locator('#y65NormalUI')).toBeVisible();
    await page.click('#y65StudentHandle');
    await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);

    await expect.poll(() => page.evaluate(() => {
      const drawer = document.getElementById('y65StudentDrawer');
      const body = document.getElementById('y65MassagePanelRoot');
      const bodyStyle = body ? getComputedStyle(body) : null;
      return {
        drawerFits: drawer ? drawer.scrollHeight <= window.innerHeight + 2 : false,
        bodyOverflowY: bodyStyle?.overflowY || '',
        bodyScrolls: body ? body.scrollHeight > body.clientHeight + 2 : true
      };
    })).toEqual({
      drawerFits: true,
      bodyOverflowY: 'visible',
      bodyScrolls: false
    });

    await page.click('[data-action="setMode"][data-mode="2"]');
    await page.click('[data-action="setIntensity"][data-intensity="high"]');
    await page.click('[data-action="setDuration"][data-duration="1"]');
    await page.click('#y65MassagePanelRoot [data-action="startMassage"]');

    await expect.poll(() => page.evaluate(() => window.APP_STATE?.uiMode)).toBe('RUNNING');
    await expect(page.locator('#y65StudentDrawer')).not.toHaveClass(/open/);
    await expect(page.locator('#btnStudentStop')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin,
      totalSec: window.currentMassageSession?.totalSec
    }))).toEqual({
      mode: 2,
      intensity: 'high',
      durationMin: 1,
      totalSec: 60
    });
    await page.click('#btnStudentStop');
    await expect.poll(() => page.evaluate(() => window.APP_STATE?.uiMode)).toBe('SETUP');
    await expect(page.locator('#btnStudentStop')).toBeHidden();
  });

  test('robot connection setting appears directly after language setting', async ({ page }) => {
    await page.click('#settingsBtn');
    await expect(page.locator('#settingsPanel')).toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => {
      const groups = Array.from(document.querySelectorAll('#settingsPanel .setting-group'));
      return groups.map((group) => group.textContent.replace(/\s+/g, ' ').trim()).slice(0, 4);
    })).toEqual([
      expect.stringContaining('Quick Start Mode'),
      expect.stringContaining('語言 / Language'),
      expect.stringContaining('UR10e'),
      expect.stringContaining('Voice Response Language')
    ]);
  });

  test('front end-session control stops session without mini controls or scenario toast', async ({ page }) => {
    await expect(page.locator('#y65MiniBar')).toHaveCount(0);
    await expect(page.locator('#y65MiniPauseBtn')).toHaveCount(0);
    await expect(page.locator('#y65MiniStopBtn')).toHaveCount(0);

    await openInstructorOverlay(page);
    await openLiveTab(page);
    await page.selectOption('#teachingScenarioSelect', 'scenario_1');
    await startVirtualSession(page);

    await expect(page.locator('#y65FrontStopBtn')).toBeVisible();
    await expect(page.locator('#stableToast')).toHaveCount(0);
    await page.evaluate(() => window.addSystemMessage('🧪 Scenario: should not popup', 'info'));
    await expect(page.locator('#stableToast')).toHaveCount(0);

    await page.evaluate(() => {
      window.nursingVitalsMonitorInstance?.applyTeachingPreset?.({
        id: 'severe_pain',
        targets: { hr: 119, sbp: 143, dbp: 95, rr: 26, spo2: 93 },
        subjective: { pain: 5, anxiety: 5, comfort: 0 },
        cues: { pain: 'SEVERE', anxiety: 'PANIC', comfort: 'NONE' },
        useBase: false
      });
      window.syncYear65UI?.();
    });
    await expect.poll(() => page.evaluate(() => ({
      hrHigh: Number(window.APP_STATE?.vitals?.hr || 0) >= 110,
      preset: window.APP_STATE?.instructor?.scenario?.presetActive
    }))).toEqual({ hrHigh: true, preset: 'severe_pain' });

    await page.click('#y65FrontStopBtn');
    await expect(page.locator('#y65UiModeText')).toContainText('待開始');
    await expect.poll(() => page.evaluate(() => ({
      uiMode: window.APP_STATE?.uiMode,
      vitals: window.APP_STATE?.vitals,
      scenario: window.APP_STATE?.instructor?.scenario,
      preset: window.APP_STATE?.instructor?.presetActive,
      avatarFile: document.getElementById('y65AvatarBase')?.dataset.avatarFile,
      hrText: document.getElementById('vitalHR')?.textContent,
      sbpText: document.getElementById('vitalSBP')?.textContent,
      dbpText: document.getElementById('vitalDBP')?.textContent,
      rrText: document.getElementById('vitalRR')?.textContent,
      spo2Text: document.getElementById('vitalSPO2')?.textContent
    }))).toEqual({
      uiMode: 'SETUP',
      vitals: { hr: 89, sbp: 115, dbp: 73, rr: 18, spo2: 97 },
      scenario: { pain: 0, anxiety: 0, comfort: 2, presetActive: 'baseline' },
      preset: 'baseline',
      avatarFile: 'baseline.png',
      hrText: '89',
      sbpText: '115',
      dbpText: '73',
      rrText: '18',
      spo2Text: '97'
    });

    await page.waitForTimeout(1200);
    await expect.poll(() => page.evaluate(() => ({
      uiMode: window.APP_STATE?.uiMode,
      vitals: window.APP_STATE?.vitals,
      scenario: window.APP_STATE?.instructor?.scenario,
      hrText: document.getElementById('vitalHR')?.textContent
    }))).toEqual({
      uiMode: 'SETUP',
      vitals: { hr: 89, sbp: 115, dbp: 73, rr: 18, spo2: 97 },
      scenario: { pain: 0, anxiety: 0, comfort: 2, presetActive: 'baseline' },
      hrText: '89'
    });

    await page.evaluate(() => {
      window.nursingVitalsMonitorInstance?.applyTeachingPreset?.({
        id: 'severe_pain',
        targets: { hr: 119, sbp: 143, dbp: 95, rr: 26, spo2: 93 },
        subjective: { pain: 5, anxiety: 5, comfort: 0 },
        cues: { pain: 'SEVERE', anxiety: 'PANIC', comfort: 'NONE' },
        useBase: false
      });
      window.syncYear65UI?.();
      window.dispatchEvent(new CustomEvent('massageSessionEnded', { detail: { reason: 'external_robot_stop' } }));
    });

    await expect.poll(() => page.evaluate(() => ({
      uiMode: window.APP_STATE?.uiMode,
      vitals: window.APP_STATE?.vitals,
      scenario: window.APP_STATE?.instructor?.scenario,
      avatarFile: document.getElementById('y65AvatarBase')?.dataset.avatarFile,
      hrText: document.getElementById('vitalHR')?.textContent
    }))).toEqual({
      uiMode: 'SETUP',
      vitals: { hr: 89, sbp: 115, dbp: 73, rr: 18, spo2: 97 },
      scenario: { pain: 0, anxiety: 0, comfort: 2, presetActive: 'baseline' },
      avatarFile: 'baseline.png',
      hrText: '89'
    });
  });

  test('ASR wake phrase opens massage setup', async ({ page }) => {
    await page.evaluate(() => window.addUserMessage('massage setting'));

    await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => ({
      quick: document.getElementById('quickStartModeToggle')?.checked,
      prompt: document.getElementById('voiceSetupPrompt')?.textContent || '',
      uiMode: window.APP_STATE?.uiMode
    }))).toEqual({
      quick: false,
      prompt: 'Select massage mode: mode 1, 2, 3, or 4.',
      uiMode: 'SETUP'
    });

    await page.evaluate(() => window.addUserMessage('按摩設定'));
    await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);

    await page.evaluate(() => {
      document.getElementById('y65StudentDrawer')?.classList.remove('open');
      document.getElementById('y65StudentMask')?.classList.remove('open');
      window.addUserMessage('按磨設頂');
    });
    await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);

    await page.evaluate(() => {
      document.getElementById('y65StudentDrawer')?.classList.remove('open');
      document.getElementById('y65StudentMask')?.classList.remove('open');
      window.sttService?.eventBus?.emit?.('partial', { text: 'message set up' });
    });
    await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);
  });

  test('ASR listening banner only appears during voice setup', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('voiceSetupBanner')?.classList.add('hidden');
      window.sttService?.eventBus?.emit?.('started', { provider: 'mock', language: 'zh-HK' });
    });

    await expect(page.locator('#asrStatusDot')).toHaveClass(/active/);
    await expect(page.locator('#voiceSetupBanner')).toHaveClass(/hidden/);

    await page.evaluate(() => {
      window.sttService?.eventBus?.emit?.('partial', { text: 'massage' });
    });
    await expect(page.locator('#voiceSetupBanner')).toHaveClass(/hidden/);

    await page.evaluate(() => {
      window.sttService?.eventBus?.emit?.('partial', { text: 'setting' });
    });
    await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);
    await expect(page.locator('#voiceSetupBanner')).not.toHaveClass(/hidden/);

    await page.evaluate(() => window.addUserMessage('mode 2 high intensity 3 minutes'));
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin,
      bannerHidden: document.getElementById('voiceSetupBanner')?.classList.contains('hidden'),
      prompt: document.getElementById('voiceSetupPrompt')?.textContent || ''
    }))).toEqual({
      mode: 2,
      intensity: 'high',
      durationMin: 3,
      bannerHidden: false,
      prompt: 'Setup complete: Mode 2 · High intensity · 3 min. Say "start massage" to begin.'
    });

  });

  test('stored disabled wake word migrates on for daily teaching use', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('wakeWordEnabled', 'false');
      localStorage.removeItem('wakeWordDefaultOnMigrated.20260706');
      location.reload();
    });
    await page.waitForSelector('#year65App', { timeout: 10000 });
    await page.waitForFunction(() => window.app && window.APP_STATE, null, { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => ({
      checked: document.getElementById('wakeWordToggle')?.checked,
      stored: localStorage.getItem('wakeWordEnabled')
    }))).toEqual({
      checked: true,
      stored: 'true'
    });
  });

  test('split Chinese ASR wake phrase opens massage setup', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('y65StudentDrawer')?.classList.remove('open');
      document.getElementById('voiceSetupBanner')?.classList.add('hidden');
      window.sttService?.eventBus?.emit?.('partial', { text: '安摸' });
    });
    await expect(page.locator('#voiceSetupBanner')).toHaveClass(/hidden/);

    await page.evaluate(() => {
      window.sttService?.eventBus?.emit?.('partial', { text: '石頂' });
    });
    await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);
    await expect(page.locator('#voiceSetupBanner')).not.toHaveClass(/hidden/);
    await expect.poll(() => page.evaluate(() => window.__lastAsrWakeDecision?.matched)).toBe(true);
  });

  test('wake word toggle controls ASR listening state', async ({ page }) => {
    await page.evaluate(() => {
      const toggle = document.getElementById('wakeWordToggle');
      if (toggle) {
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      }
      window.__asrStartCalls = 0;
      window.__asrStopCalls = 0;
      window.__asrLastLanguage = null;
      window.sttService.start = async (language) => {
        window.__asrStartCalls += 1;
        window.__asrLastLanguage = language;
        window.sttService.isListening = true;
        window.sttService.eventBus.emit('started', { provider: 'mock', language });
      };
      window.sttService.stop = async () => {
        window.__asrStopCalls += 1;
        window.sttService.isListening = false;
        window.sttService.eventBus.emit('stopped', { provider: 'mock' });
      };
      window.sttService.isActive = () => window.sttService.isListening;
    });

    await page.evaluate(() => {
      const toggle = document.getElementById('wakeWordToggle');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__asrStartCalls)).toBe(1);
    await expect(page.locator('#asrStatusDot')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => window.__asrLastLanguage)).toBe('zh-HK');

    await page.evaluate(() => {
      const toggle = document.getElementById('wakeWordToggle');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__asrStopCalls)).toBe(1);
    await expect(page.locator('#asrStatusDot')).not.toHaveClass(/active/);
  });

  test('unexpected Azure stopped status falls back instead of staying falsely active', async ({ page }) => {
    await page.evaluate(() => {
      const service = window.sttService;
      const azure = service.providers.get('azure-speech-sdk');
      const browser = service.providers.get('browser');
      window.__fallbackStarted = false;
      window.__fallbackLanguage = null;
      service.currentProvider = 'azure-speech-sdk';
      service.isListening = true;
      service.language = 'zh-HK';
      azure.isListening = true;
      azure.ws = { readyState: WebSocket.OPEN, close() { this.readyState = WebSocket.CLOSED; } };
      azure.processor = null;
      azure.source = null;
      azure.audioContext = null;
      azure.stream = null;
      browser.isAvailable = true;
      browser.start = async (language) => {
        window.__fallbackStarted = true;
        window.__fallbackLanguage = language;
        browser.isListening = true;
      };
      browser.stop = async () => { browser.isListening = false; };
      azure._handleMessage({ type: 'status', state: 'stopped', reason: 'session_stopped' });
    });

    await expect.poll(() => page.evaluate(() => window.__fallbackStarted)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.sttService.currentProvider)).toBe('browser');
    await expect.poll(() => page.evaluate(() => window.sttService.isActive())).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__fallbackLanguage)).toBe('zh-HK');
  });

  test('ASR sequential setup keeps dialog open until intensity and duration are selected', async ({ page }) => {
    await page.evaluate(() => {
      window.__playedVoiceSetupGuidance = [];
      window.audioManager = {
        playAsset: async (assetId) => {
          window.__playedVoiceSetupGuidance.push(assetId);
          return { ok: true, assetId };
        },
        getStatus: () => ({ isPlaying: false, current: null }),
        stop: () => {}
      };
      window.addUserMessage('massage setting');
    });
    await expect(page.locator('#voiceSetupBanner')).not.toHaveClass(/hidden/);
    await expect.poll(() => page.evaluate(() => window.__playedVoiceSetupGuidance)).toEqual(['system.choose_mode']);

    await page.evaluate(() => window.addUserMessage('massage setting'));
    await expect.poll(() => page.evaluate(() => window.__playedVoiceSetupGuidance)).toEqual(['system.choose_mode']);

    await page.evaluate(() => window.addUserMessage('mode 2'));
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      bannerHidden: document.getElementById('voiceSetupBanner')?.classList.contains('hidden'),
      prompt: document.getElementById('voiceSetupPrompt')?.textContent || '',
      guidance: window.__playedVoiceSetupGuidance
    }))).toEqual({
      mode: 2,
      bannerHidden: false,
      prompt: 'Selected: Mode 2. Select intensity: low, medium, or high.',
      guidance: ['system.choose_mode', 'system.choose_force']
    });

    await page.evaluate(() => window.addUserMessage('中'));
    await expect.poll(() => page.evaluate(() => ({
      intensity: window.APP_STATE?.massage?.intensity,
      bannerHidden: document.getElementById('voiceSetupBanner')?.classList.contains('hidden'),
      prompt: document.getElementById('voiceSetupPrompt')?.textContent || '',
      guidance: window.__playedVoiceSetupGuidance
    }))).toEqual({
      intensity: 'mid',
      bannerHidden: false,
      prompt: 'Selected: Medium intensity. Select duration: 1 minute, 3 minutes, or 5 minutes.',
      guidance: ['system.choose_mode', 'system.choose_force', 'system.choose_duration']
    });

    await page.evaluate(() => window.addUserMessage('三'));
    await expect.poll(() => page.evaluate(() => ({
      durationMin: window.APP_STATE?.massage?.durationMin,
      bannerHidden: document.getElementById('voiceSetupBanner')?.classList.contains('hidden'),
      prompt: document.getElementById('voiceSetupPrompt')?.textContent || '',
      guidance: window.__playedVoiceSetupGuidance
    }))).toEqual({
      durationMin: 3,
      bannerHidden: false,
      prompt: 'Setup complete: Mode 2 · Medium intensity · 3 min. Say "start massage" to begin.',
      guidance: ['system.choose_mode', 'system.choose_force', 'system.choose_duration', 'system.confirm_summary']
    });

    await page.evaluate(() => window.addUserMessage('確認'));
    await expect.poll(() => page.evaluate(() => window.APP_STATE?.uiMode)).toBe('RUNNING');
  });

  test('voice guidance mp3 assets are served from mounted assets directory', async ({ request }) => {
    const files = [
      '/assets/audio/system_female/%E8%AB%8B%E9%81%B8%E6%93%87%E6%A8%A1%E5%BC%8F.mp3',
      '/assets/audio/system_female/%E8%AB%8B%E9%81%B8%E6%93%87%E5%8A%9B%E5%BA%A6.mp3',
      '/assets/audio/system_female/%E8%AB%8B%E9%81%B8%E6%93%87%E6%99%82%E9%96%93.mp3',
      '/assets/audio/system_female/%E8%AB%8B%E7%A2%BA%E8%AA%8D%E9%96%8B%E5%A7%8B.mp3',
      '/assets/audio/system_female_english/Please%20select%20mode.mp3',
      '/assets/audio/system_female_english/Please%20select%20intensity.mp3',
      '/assets/audio/system_female_english/Please%20select%20duration.mp3',
      '/assets/audio/system_female_english/Please%20confirm%20to%20start.mp3'
    ];
    for (const file of files) {
      const response = await request.get(file);
      expect(response.ok(), file).toBe(true);
      expect(Number(response.headers()['content-length'] || 0), file).toBeGreaterThan(1000);
    }
  });


  test('voice guidance follows Cantonese voice language selection', async ({ page }) => {
    const cantoneseAsset = await page.evaluate(async () => {
      localStorage.setItem('language', 'en');
      localStorage.setItem('voiceLanguage', 'zh');
      document.getElementById('languageSelect').value = 'zh';
      document.getElementById('voiceLanguageSelect').value = 'zh';
      const asset = await window.AudioAssetLibrary.getAsset('system.choose_mode', { fallback: false });
      return { lang: asset.lang, url: decodeURIComponent(asset.url) };
    });

    expect(cantoneseAsset.lang).toBe('zh');
    expect(cantoneseAsset.url).toContain('/assets/audio/system_female/請選擇模式.mp3');
    expect(cantoneseAsset.url).not.toContain('system_female_english');

    const englishAsset = await page.evaluate(async () => {
      localStorage.setItem('language', 'zh');
      localStorage.setItem('voiceLanguage', 'en');
      document.getElementById('languageSelect').value = 'zh';
      document.getElementById('voiceLanguageSelect').value = 'en';
      const asset = await window.AudioAssetLibrary.getAsset('system.choose_mode', { fallback: false });
      return { lang: asset.lang, url: decodeURIComponent(asset.url) };
    });

    expect(englishAsset.lang).toBe('en');
    expect(englishAsset.url).toContain('/assets/audio/system_female_english/Please select mode.mp3');
  });

  test('ASR transcript configures massage setup without starting', async ({ page }) => {
    await page.evaluate(() => window.addUserMessage('mode 2 high intensity 3 minutes'));

    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin,
      quick: document.getElementById('quickStartModeToggle')?.checked,
      uiMode: window.APP_STATE?.uiMode
    }))).toEqual({
      mode: 2,
      intensity: 'high',
      durationMin: 3,
      quick: false,
      uiMode: 'SETUP'
    });
  });

  test('ASR English setup tolerates common recognition variants', async ({ page }) => {
    await page.evaluate(() => window.addUserMessage('mode too middle intensity for five minutes'));

    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin,
      uiMode: window.APP_STATE?.uiMode
    }))).toEqual({
      mode: 2,
      intensity: 'mid',
      durationMin: 5,
      uiMode: 'SETUP'
    });

    await page.evaluate(() => window.addUserMessage('mode for firm pressure 3 mins'));
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin
    }))).toEqual({
      mode: 4,
      intensity: 'high',
      durationMin: 3
    });
  });

  test('ASR Chinese setup tolerates common homophone recognition variants', async ({ page }) => {
    await page.evaluate(() => window.addUserMessage('模式杉 歷道小 一分中'));
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin
    }))).toEqual({
      mode: 3,
      intensity: 'low',
      durationMin: 1
    });

    await page.evaluate(() => window.addUserMessage('模式日 力道大 五分鐘'));
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin
    }))).toEqual({
      mode: 1,
      intensity: 'high',
      durationMin: 5
    });

    await page.evaluate(() => window.addUserMessage('模式是 力度鐘 兩分鍾'));
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin
    }))).toEqual({
      mode: 4,
      intensity: 'mid',
      durationMin: 2
    });
  });

  test('ASR cancel restores voice setup selection and closes drawer', async ({ page }) => {
    await page.evaluate(() => {
      window.app.setMassageConfig({ mode: 4, intensity: 'mid', durationMin: 5 });
      const toggle = document.getElementById('quickStartModeToggle');
      if (toggle) toggle.checked = true;
      window.addUserMessage('massage setting');
    });

    await expect(page.locator('#y65StudentDrawer')).toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => document.getElementById('quickStartModeToggle')?.checked)).toBe(false);

    await page.evaluate(() => window.addUserMessage('mode too middle intensity for five minutes'));
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin
    }))).toEqual({
      mode: 2,
      intensity: 'mid',
      durationMin: 5
    });

    await page.evaluate(() => window.addUserMessage('cancel'));
    await expect.poll(() => page.evaluate(() => ({
      drawerOpen: document.getElementById('y65StudentDrawer')?.classList.contains('open'),
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin,
      quick: document.getElementById('quickStartModeToggle')?.checked,
      prompt: document.getElementById('voiceSetupPrompt')?.textContent || '',
      uiMode: window.APP_STATE?.uiMode
    }))).toEqual({
      drawerOpen: false,
      mode: 4,
      intensity: 'mid',
      durationMin: 5,
      quick: true,
      prompt: 'Voice setup cancelled. Say "massage setting" to start again.',
      uiMode: 'SETUP'
    });
  });

  test('ASR transcript starts massage and stop command ends it', async ({ page }) => {
    await page.evaluate(() => window.addUserMessage('mode 3 low intensity one minute start massage'));

    await expect.poll(() => page.evaluate(() => window.APP_STATE?.uiMode)).toBe('RUNNING');
    await expect.poll(() => page.evaluate(() => ({
      mode: window.APP_STATE?.massage?.mode,
      intensity: window.APP_STATE?.massage?.intensity,
      durationMin: window.APP_STATE?.massage?.durationMin
    }))).toEqual({
      mode: 3,
      intensity: 'low',
      durationMin: 1
    });

    await page.evaluate(() => window.addUserMessage('stop'));
    await expect.poll(() => page.evaluate(() => window.APP_STATE?.uiMode)).toBe('SETUP');
    await expect(page.locator('#y65UiModeText')).toContainText('待開始');
  });
});
