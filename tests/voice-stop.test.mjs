import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../static/app.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const callbacks = {};
  const calls = [];
  const events = [];
  const window = {
    Year65UI: {}, NursingVitalsMonitor: {}, NursingInstructorTools: {},
    setTimeout() {}, clearTimeout() {}, addEventListener() {},
    dispatchEvent: event => events.push(event),
    RobotController: { sendRobotCommand: async endpoint => { calls.push(endpoint); return true; } },
    sttService: Object.fromEntries(['Result', 'Partial', 'Started', 'Stopped', 'Error'].map(name =>
      [`on${name}`, callback => { callbacks[name.toLowerCase()] = callback; }]))
  };
  runInNewContext(source, {
    window, document: { getElementById: () => null }, console,
    localStorage: { getItem: () => null },
    setInterval: () => 1, clearInterval() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    Event: class { constructor(type) { this.type = type; } },
    fetch: async () => ({ ok: true, json: async () => ({ connected: true }) })
  });
  await window.initApp();
  return { window, callbacks, calls, events };
}

test('interim Stop phrases dispatch immediately and repeated results share one stop', async () => {
  for (const text of ['stop', 'Please stop now!', 'stop massage please', '唔該停止按摩', 'end session']) {
    const { window, callbacks, calls } = await harness();
    await window.app.startMassage();
    let confirmStop;
    window.RobotController.sendRobotCommand = endpoint => {
      calls.push(endpoint);
      return new Promise(resolve => { confirmStop = resolve; });
    };
    callbacks.partial({ text });
    assert.deepEqual(calls, ['start', 'stop'], text);
    callbacks.partial({ text });
    callbacks.result({ text });
    assert.deepEqual(calls, ['start', 'stop'], 'Stop must be deduplicated while confirmation is pending');
    assert.ok(window.currentMassageSession, 'Do not report completion before robot confirms');
    confirmStop(true);
    await tick();
    assert.equal(window.currentMassageSession, null);
    assert.equal(window.APP_STATE.uiMode, 'SETUP');
  }
});

test('Stop interrupts pending Start and its late response cannot publish a session', async () => {
  const { window, callbacks, calls, events } = await harness();
  let confirmStart;
  window.RobotController.sendRobotCommand = endpoint => {
    calls.push(endpoint);
    return endpoint === 'start' ? new Promise(resolve => { confirmStart = resolve; }) : Promise.resolve(true);
  };
  const starting = window.app.startMassage();
  await tick();
  assert.deepEqual(calls, ['start']);
  callbacks.partial({ text: 'please stop' });
  assert.deepEqual(calls, ['start', 'stop'], 'Do not wait for Start confirmation to send Stop');
  await tick();
  confirmStart(true);
  await starting;
  assert.equal(window.currentMassageSession, null);
  assert.equal(window.APP_STATE.uiMode, 'SETUP');
  assert.equal(events.filter(event => event.type === 'massageSessionStarted').length, 0);
});

test('Stop failure keeps session available for retry', async () => {
  const { window, callbacks, calls } = await harness();
  await window.app.startMassage();
  window.RobotController.sendRobotCommand = async endpoint => { calls.push(endpoint); return false; };
  callbacks.partial({ text: 'stop' });
  await tick();
  assert.ok(window.currentMassageSession);
  assert.equal(window.currentMassageSession.ended, false);
  window.RobotController.sendRobotCommand = async endpoint => { calls.push(endpoint); return true; };
  callbacks.result({ text: 'stop' });
  await tick();
  assert.equal(window.currentMassageSession, null);
  assert.deepEqual(calls, ['start', 'stop', 'stop']);
});

test('failed Stop during startup keeps the cancelled session reachable for retry', async () => {
  const { window, callbacks, calls } = await harness();
  let confirmStart;
  window.RobotController.sendRobotCommand = endpoint => {
    calls.push(endpoint);
    return endpoint === 'start' ? new Promise(resolve => { confirmStart = resolve; }) : Promise.resolve(false);
  };
  const starting = window.app.startMassage();
  await tick();
  callbacks.partial({ text: 'stop' });
  await tick();
  assert.ok(window.currentMassageSession, 'Unconfirmed physical Stop must remain retryable');
  confirmStart(true);
  await starting;
  assert.ok(window.currentMassageSession);
  window.RobotController.sendRobotCommand = async endpoint => { calls.push(endpoint); return true; };
  await window.app.stopSession();
  assert.equal(window.currentMassageSession, null);
});

test('late pause or resume confirmation cannot restore a stopped session', async () => {
  for (const endpoint of ['pause', 'resume']) {
    const { window, events } = await harness();
    await window.app.startMassage();
    if (endpoint === 'resume') await window.currentMassageSession.pause();
    let confirmControl;
    window.RobotController.sendRobotCommand = command => command === endpoint
      ? new Promise(resolve => { confirmControl = resolve; }) : Promise.resolve(true);
    const session = window.currentMassageSession;
    const controlling = session[endpoint]();
    await window.app.stopSession();
    const eventCount = events.length;
    confirmControl(true);
    await controlling;
    assert.equal(window.currentMassageSession, null);
    assert.equal(window.APP_STATE.uiMode, 'SETUP');
    assert.equal(events.length, eventCount);
  }
});

test('guidance echo and unrelated interim words do not terminate massage', async () => {
  const { window, callbacks, calls } = await harness();
  await window.app.startMassage();
  for (const text of ['Please confirm start or stop', 'unstoppable', 'massage setting', 'soft stop']) {
    callbacks.partial({ text });
  }
  assert.deepEqual(calls, ['start']);
  assert.ok(window.currentMassageSession);
});

test('Stop in a setup phrase takes precedence over starting another session', async () => {
  const { window, callbacks, calls } = await harness();
  callbacks.result({ text: 'stop massage setting mode one start' });
  await tick();
  assert.deepEqual(calls, []);
  assert.equal(window.currentMassageSession, null);
});
