import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createVitalsMonitor } from '../static/src/nursing/VitalsMonitor.js';
import { initInstructorTools } from '../static/src/nursing/InstructorTools.js';

test('keyboard presets preview face and vitals in setup and survive refreshes until reset', async () => {
  const elements = new Map();
  const handlers = new Map();
  const storage = new Map([['teachingVitalsMode', 'keyboard']]);
  const makeElement = () => ({
    dataset: {}, style: { setProperty() {} }, textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, setAttribute() {}, closest() { return null; }
  });
  for (const id of ['y65AvatarStage', 'y65AvatarFigure', 'y65AvatarBase',
    'y65ExpressionPresetText', 'vitalHR', 'vitalSBP', 'vitalDBP', 'vitalRR', 'vitalSPO2']) {
    elements.set(id, makeElement());
  }
  globalThis.document = {
    activeElement: null,
    getElementById: id => elements.get(id) || null,
    addEventListener: (name, handler) => {
      const list = handlers.get(name) || [];
      list.push(handler);
      handlers.set(name, list);
    }
  };
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };
  globalThis.window = { dispatchEvent() {}, addEventListener() {} };
  globalThis.requestAnimationFrame = callback => callback();
  const ui = await import('../static/year65-ui.js');
  const monitor = createVitalsMonitor({});
  try {
    window.nursingVitalsMonitorInstance = monitor;
    window.Year65UI = {
      renderAll: ui.renderVitalsOnly,
      resetVitalsAndExpressionBaseline: ui.resetVitalsAndExpressionBaseline
    };
    runInNewContext(await readFile(new URL('../static/app.js', import.meta.url), 'utf8'), {
      window, document, console
    });
    window.instructorTools = initInstructorTools({});
    monitor.setVitalsFreeze(true);
    window.syncYear65UI();
    assert.equal(elements.get('y65AvatarBase').src, '/static/assets/avatar/baseline.png');
    assert.equal(window.APP_STATE.vitals.hr, 89);

    const ids = ['baseline', 'mild_anxiety', 'neutral_pain', 'mild_pain',
      'moderate_pain', 'severe_pain', 'high_anxiety', 'panic'];
    const heartRates = [75, 90, 88, 92, 100, 110, 115, 125];
    for (let index = 0; index < ids.length; index++) {
      for (const handler of handlers.get('keydown')) {
        handler({ key: String(index + 1), preventDefault() {} });
      }
      for (let refresh = 0; refresh < 150; refresh++) window.syncYear65UI();
      assert.equal(window.APP_STATE.uiMode, 'SETUP');
      assert.equal(window.APP_STATE.instructor.presetActive, ids[index]);
      assert.equal(window.APP_STATE.vitals.hr, heartRates[index]);
      assert.deepEqual({ ...window.APP_STATE.vitals }, monitor.getTeachingLiveState().vitals);
      assert.equal(elements.get('vitalHR').textContent, heartRates[index]);
      assert.equal(elements.get('y65AvatarBase').src,
        `/static/assets/avatar/${ui.EXPRESSION_PRESET_FILES[ids[index]]}`);
    }

    window.app.resetTeachingVisualsToSetupBaseline();
    window.syncYear65UI();
    assert.equal(window.APP_STATE.instructor.presetActive, 'baseline');
    assert.equal(elements.get('y65AvatarBase').src, '/static/assets/avatar/baseline.png');
    assert.equal(elements.get('vitalHR').textContent, 89);
    // A background monitor change cannot re-enable an explicit preview after reset.
    monitor.applyTeachingPreset({ id: 'panic', targets: { hr: 125 } });
    window.syncYear65UI();
    assert.equal(window.APP_STATE.vitals.hr, 89);
    assert.equal(window.APP_STATE.instructor.presetActive, 'baseline');

    // Running sessions continue to use the monitor even without a setup preview.
    window.APP_STATE.uiMode = 'RUNNING';
    window.syncYear65UI();
    assert.equal(window.APP_STATE.vitals.hr, 125);
    assert.equal(elements.get('y65AvatarBase').src, '/static/assets/avatar/Panic.png');
  } finally {
    monitor.cleanup();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.localStorage;
    delete globalThis.requestAnimationFrame;
  }
});
