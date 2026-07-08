import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SCENARIO_CONTROLLER_PATH = new URL('./ScenarioController.js', import.meta.url);
const DEBRIEF_PANEL_PATH = new URL('./DebriefPanel.js', import.meta.url);
const YEAR65_HTML_PATH = new URL('../../year65_v3_avatar_v3.html', import.meta.url);

test('scenario controller records paused duration in completion payload', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /pausedAccumulatedMs/);
  assert.match(code, /pausedMs:\s*totalPausedMs/);
});

test('scenario controller maps stage expression preset ids', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /expressionPresetId/);
  assert.match(code, /id:\s*stage\.expressionPresetId\s*\|\|\s*stage\.id/);
});

test('debrief panel renders paused duration for scenario completion', async () => {
  const code = await readFile(DEBRIEF_PANEL_PATH, 'utf8');
  assert.match(code, /SCENARIO_COMPLETED/);
  assert.match(code, /Paused:/);
});

test('instructor header includes scenario quick badge', async () => {
  const html = await readFile(YEAR65_HTML_PATH, 'utf8');
  assert.match(html, /id="teachingScenarioBadge"/);
});

test('scenario controller updates instructor quick badge text', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /updateScenarioBadge/);
  assert.match(code, /teachingScenarioBadge/);
});

test('scenario controller updates badge severity classes', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /is-s0/);
  assert.match(code, /is-s1/);
  assert.match(code, /is-s2/);
  assert.match(code, /is-off/);
  assert.match(code, /y65ScenarioChip/);
});

test('teaching css defines badge severity styles', async () => {
  const cssPath = new URL('../../css/components/teaching.css', import.meta.url);
  const css = await readFile(cssPath, 'utf8');
  assert.match(css, /teaching-scenario-badge\.is-off/);
  assert.match(css, /teaching-scenario-badge\.is-s0/);
  assert.match(css, /teaching-scenario-badge\.is-s1/);
  assert.match(css, /teaching-scenario-badge\.is-s2/);
});

test('off scenario enforces fixed baseline on session start', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /selectedScenarioId === 'off'/);
  assert.match(code, /vitalsMonitor\.stopTeachingTimeline\?\.\(\)/);
  assert.match(code, /vitalsMonitor\.setManualMode\?\.\(true\)/);
  assert.match(code, /vitalsMonitor\.setVitalsFreeze\?\.\(true\)/);
  assert.match(code, /id:\s*'off_baseline'/);
});

test('scenario 0 enables keyboard expression practice without timeline', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /scenario_0/);
  assert.match(code, /enableKeyboardExpressionMode/);
  assert.match(code, /window\.instructorTools\?\.setVitalsMode/);
  assert.match(code, /status:\s*'KEYBOARD'/);
});

test('vitals monitor supports freeze mode for fixed baseline', async () => {
  const vmPath = new URL('./VitalsMonitor.js', import.meta.url);
  const code = await readFile(vmPath, 'utf8');
  assert.match(code, /setVitalsFreeze\(enabled\)/);
  assert.match(code, /if \(vitalsFrozen\) \{/);
  assert.match(code, /teachingLiveState\.vitals\s*=\s*vitalsFrozen\s*\?/);
});

test('instructor tools reuses shared global vitals monitor instance', async () => {
  const itPath = new URL('./InstructorTools.js', import.meta.url);
  const code = await readFile(itPath, 'utf8');
  assert.match(code, /window\.nursingVitalsMonitorInstance\s*\|\|\s*window\.NursingVitalsMonitor\.createVitalsMonitor/);
  assert.doesNotMatch(code, /window\.nursingVitalsMonitorInstance\?\.cleanup\(\)/);
});

test('year65 page includes scenario selector and badge elements', async () => {
  const html = await readFile(YEAR65_HTML_PATH, 'utf8');
  assert.match(html, /id="teachingScenarioSelect"/);
  assert.match(html, /value="scenario_0"/);
  assert.match(html, /id="teachingScenarioBadge"/);
});

test('year65 front UI includes read-only scenario chip', async () => {
  const html = await readFile(YEAR65_HTML_PATH, 'utf8');
  assert.match(html, /id="y65ScenarioChip"/);
  assert.match(html, /Scenario:\s*Off/);
});

test('instructor tools auto-initializes scenario controller once', async () => {
  const itPath = new URL('./InstructorTools.js', import.meta.url);
  const code = await readFile(itPath, 'utf8');
  assert.match(code, /!window\.nursingScenarioControllerInstance/);
  assert.match(code, /window\.NursingScenarioController\.createScenarioController/);
});

test('scenario stages include soundtrack IDs', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /soundtrackId/);
  assert.match(code, /soundtrack_01/);
});

test('scenario controller plays predefined audio on stage apply', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /playScenarioDialogue/);
  assert.match(code, /nursingScenarioVoice/);
  assert.match(code, /predefined_sound_track/);
});

test('scenario stages include virtual time metadata', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /virtualMinutesOnFire/);
  assert.match(code, /virtualRateSecsPerSec/);
});

test('scenario controller dispatches virtual time updates', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /scenarioVirtualTimeUpdate/);
});

test('year65 html includes virtual time chip and voice selector', async () => {
  const html = await readFile(YEAR65_HTML_PATH, 'utf8');
  assert.match(html, /y65VirtualTimeText/);
  assert.match(html, /nursingScenarioVoiceSelect/);
});

test('year65 cue rendering supports 0..5 levels', async () => {
  const uiPath = new URL('../../year65-ui.js', import.meta.url);
  const code = await readFile(uiPath, 'utf8');
  assert.match(code, /Math\.max\(0, Math\.min\(5, Math\.round\(numeric\)\)\)/);
  assert.match(code, /low:\s*\{\s*label:\s*"Low\s*\/\s*輕微",\s*level:\s*0\s*\}/);
  assert.match(code, /calm:\s*\{\s*label:\s*"Calm\s*\/\s*冷靜",\s*level:\s*0\s*\}/);
});

test('vitals monitor cue mapping includes zero baseline', async () => {
  const vmPath = new URL('./VitalsMonitor.js', import.meta.url);
  const code = await readFile(vmPath, 'utf8');
  assert.match(code, /if \(normalized === 'LOW'\) return 0;/);
  assert.match(code, /if \(normalized === 'CALM'\) return 0;/);
  assert.match(code, /if \(normalized === 'UNCOMFORTABLE'\) return 0;/);
});

test('scenario 1 worsening stage uses anxiety level 4', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /id:\s*'s1_1_3_b'[\s\S]*subjective:\s*\{\s*pain:\s*2,\s*anxiety:\s*4,\s*comfort:\s*1\s*\}/);
  assert.match(code, /id:\s*'s1_1_3_b'[\s\S]*cues:\s*\{\s*pain:\s*'MILD',\s*anxiety:\s*'ANXIOUS',\s*comfort:\s*'UNCOMFORTABLE'\s*\}/);
});

test('scenario controller waits for stage audio before completing worsening branch', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /function requestScenarioCompletion\(completionReason, waitForAudio = false, minDelayMs = 0, postAudioDelayMs = 0\)/);
  assert.match(code, /scenarioAudio\.addEventListener\('ended', \(\) => \{[\s\S]*audioDone = true;[\s\S]*maybeFinish\(\);[\s\S]*\}, \{ once: true \}\)/);
  assert.match(code, /if \(activeScenario\.continueIntermediate && !intermediateDecisionWindowOpen\)[\s\S]*else \{[\s\S]*requestScenarioCompletion\('continue_worsening', true, FINAL_OUTCOME_HOLD_MS\)/);
});

test('scenario controller defers non-stop session end completion when audio is active', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /requestScenarioCompletion\(`session_end_\$\{reason\}`, true\)/);
  assert.match(code, /if \(!waitForAudio \|\| !scenarioAudio\)/);
  assert.match(code, /if \(audioDone && minDone\) finish\(\);/);
});

test('scenario 1 stop at stage12 applies stop outcome immediately', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /if \(decisionWindowOpen\) \{[\s\S]*applyStage\(activeScenario\.stopOutcome, `stop_\$\{reason\}`[,)]/);
  assert.match(code, /else if \(decisionWindowOpen\) \{[\s\S]*applyStage\(activeScenario\.stopOutcome, 'soft_stop_stage12'\)/);
});

test('scenario stop keeps 1.3.a visible for 10s from stage entry', async () => {
  const code = await readFile(SCENARIO_CONTROLLER_PATH, 'utf8');
  assert.match(code, /requestScenarioCompletion\('student_stopped', false, 10000\)/);
});
