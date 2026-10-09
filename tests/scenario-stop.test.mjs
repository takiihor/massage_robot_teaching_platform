import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../static/src/nursing/ScenarioController.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(session, app) {
  const handlers = new Map();
  const timers = new Map();
  let timerId = 0;
  const messages = [];
  const window = {
    app, currentMassageSession: session,
    addEventListener: (name, callback) => handlers.set(name, callback),
    dispatchEvent() {}, addSystemMessage: (message, level) => messages.push({ message, level })
  };
  const context = {
    window, document: { getElementById: () => null, addEventListener() {}, dispatchEvent() {} },
    localStorage: { getItem: () => 'scenario_1', setItem() {} },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    Audio: class { ended = true; addEventListener() {} pause() {} play() { return Promise.resolve(); } },
    console
  };
  runInNewContext(source + '\nglobalThis.makeController = createScenarioController;', context);
  const controller = context.makeController({ vitalsMonitor: { applyTeachingPreset() {} }, scenarioSelectEl: null });
  handlers.get('massageSessionStarted')();
  const fireDelay = delay => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `Expected pending ${delay} ms timer`);
    timers.delete(entry[0]);
    entry[1].callback();
  };
  return { controller, messages, window, handlers, fireDelay };
}

test('scenario completion uses the application Stop handler exactly once', async () => {
  const calls = [];
  const session = { stop: () => { throw new Error('Must use application Stop handler'); } };
  const { controller, messages } = harness(session, { stopSession: async reason => { calls.push(reason); } });
  controller.selectScenario('off');
  await tick();
  assert.deepEqual(calls, ['scenario_completed']);
  assert.deepEqual(messages, []);
});

test('completion callback from an earlier scenario cannot stop a newly started session', async () => {
  const calls = [];
  const { controller, window, handlers, fireDelay } = harness({}, { stopSession: async reason => calls.push(reason) });
  fireDelay(60000); // Stage 1.2
  fireDelay(60000); // Intermediate stage
  fireDelay(30000); // Final stage, with completion queued 60 seconds later
  controller.selectScenario('off');
  await tick();
  assert.deepEqual(calls, ['scenario_completed']);
  const newSession = {};
  window.currentMassageSession = newSession;
  handlers.get('massageSessionStarted')();
  fireDelay(60000); // Delayed completion left over from the first scenario
  await tick();
  assert.deepEqual(calls, ['scenario_completed']);
  assert.equal(window.currentMassageSession, newSession);
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
