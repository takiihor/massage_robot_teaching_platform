import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../static/src/nursing/ScenarioController.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(session, app) {
  const handlers = new Map();
  const messages = [];
  const window = {
    app, currentMassageSession: session,
    addEventListener: (name, callback) => handlers.set(name, callback),
    dispatchEvent() {}, addSystemMessage: (message, level) => messages.push({ message, level })
  };
  const context = {
    window, document: { getElementById: () => null, addEventListener() {}, dispatchEvent() {} },
    localStorage: { getItem: () => 'scenario_1', setItem() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    Audio: class { addEventListener() {} pause() {} play() { return Promise.resolve(); } },
    console
  };
  runInNewContext(source + '\nglobalThis.makeController = createScenarioController;', context);
  const controller = context.makeController({ vitalsMonitor: { applyTeachingPreset() {} }, scenarioSelectEl: null });
  handlers.get('massageSessionStarted')();
  return { controller, messages, window };
}

test('scenario completion uses the application Stop handler exactly once', async () => {
  const calls = [];
  const session = { stop: () => { throw new Error('Must use application Stop handler'); } };
  const { controller, messages } = harness(session, { stopSession: async reason => { calls.push(reason); } });
  controller.selectScenario('off');
  await tick();
  assert.deepEqual(calls, ['completed']);
  assert.deepEqual(messages, []);
});

test('scenario completion handles rejected Stop and preserves the retryable physical session', async () => {
  for (const synchronous of [false, true]) {
    const session = { stop: () => {
      if (synchronous) throw new Error('Robot Stop was not confirmed');
      return Promise.reject(new Error('Robot Stop was not confirmed'));
    } };
    const { controller, messages, window } = harness(session);
    controller.selectScenario('off');
    await tick();
    assert.equal(window.currentMassageSession, session);
    assert.equal(controller.getActiveScenarioId(), null);
    assert.deepEqual(messages, [{ message: 'Robot Stop was not confirmed', level: 'error' }]);
  }
});
