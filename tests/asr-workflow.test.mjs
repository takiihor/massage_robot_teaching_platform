import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../static/app.js', import.meta.url), 'utf8');

async function harness() {
  const callbacks = {};
  const guidance = [];
  const timers = new Map();
  const elements = new Map();
  let now = 10000;
  let timerId = 0;
  for (const id of ['y65StudentDrawer', 'voiceSetupBanner', 'voiceSetupPrompt', 'voiceSetupTitle', 'liveRegion']) {
    const classes = new Set();
    elements.set(id, {
      textContent: '', addEventListener() {}, setAttribute() {},
      classList: {
        contains: name => classes.has(name),
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
      }
    });
  }
  const window = {
    Year65UI: {}, NursingVitalsMonitor: {}, NursingInstructorTools: {},
    addEventListener() {}, dispatchEvent() {},
    setTimeout(callback, delay = 0) {
      const id = ++timerId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    audioManager: {
      playAsset: async id => { guidance.push(id); return { ok: true }; },
      getStatus: () => ({ current: null }), stop() {}
    },
    sttService: Object.fromEntries(['Result', 'Partial', 'Started', 'Stopped', 'Error'].map(name =>
      [`on${name}`, callback => { callbacks[name.toLowerCase()] = callback; }]))
  };
  runInNewContext(source, {
    window, document: { getElementById: id => elements.get(id) || null },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null },
    Date: class extends Date { static now() { return now; } },
    setInterval: () => 1, clearInterval() {}, Event: class {},
    fetch: async () => ({ ok: true, json: async () => ({ connected: false }) })
  });
  await window.initApp();
  return {
    window, guidance, callbacks,
    say: (text, partial = false) => callbacks[partial ? 'partial' : 'result']({ text }),
    prompt: () => elements.get('voiceSetupPrompt').textContent,
    settings: () => ({ ...window.APP_STATE.massage }),
    collapse: () => elements.get('y65StudentDrawer').classList.remove('open'),
    drawerOpen: () => elements.get('y65StudentDrawer').classList.contains('open'),
    async advance(ms) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
      await Promise.resolve();
    }
  };
}

test('revised interim hypotheses cannot announce duration then return to intensity', async () => {
  const h = await harness();
  h.say('massage setting');
  const before = h.settings();
  h.say('mode three', true);
  await h.advance(250);
  h.say('mode three low intensity', true);
  await h.advance(250);
  h.say('mode three');
  assert.deepEqual(h.guidance, ['system.choose_mode', 'system.choose_force']);
  assert.equal(h.settings().mode, 3);
  assert.equal(h.settings().intensity, before.intensity);
  assert.match(h.prompt(), /Select intensity/);
  h.say('low');
  h.say('five');
  assert.deepEqual(h.guidance, [
    'system.choose_mode', 'system.choose_force', 'system.choose_duration', 'system.confirm_summary'
  ]);
  assert.match(h.prompt(), /Setup complete/);
});

for (const [wake, mode, intensity, duration] of [
  ['massage setting', 'three', 'low', 'five'],
  ['按摩設定', '三', '小', '五']
]) {
  test(`${wake}: interim feedback keeps the current step until its final arrives`, async () => {
    const h = await harness();
    h.say(wake);
    const steps = [
      [mode, /Select massage mode/, 'system.choose_force'],
      [intensity, /Select intensity/, 'system.choose_duration'],
      [duration, /Select duration/, 'system.confirm_summary']
    ];
    for (const [text, currentPrompt, nextAsset] of steps) {
      const before = h.settings();
      const count = h.guidance.length;
      h.say(text, true);
      await h.advance(250);
      assert.match(h.prompt(), /Recognizing/);
      assert.match(h.prompt(), currentPrompt);
      assert.deepEqual(h.settings(), before);
      assert.equal(h.guidance.length, count);
      await h.advance(1600);
      h.say(text);
      assert.equal(h.guidance.at(-1), nextAsset);
      assert.equal(h.guidance.length, count + 1);
    }
    assert.match(h.prompt(), /Setup complete/);
  });
}

test('duplicate and corrected finals do not repeat guidance for the same missing field', async () => {
  const h = await harness();
  h.say('massage setting');
  h.say('mode three');
  await h.advance(1600);
  h.say('mode three');
  h.say('mode two');
  assert.deepEqual(h.guidance, ['system.choose_mode', 'system.choose_force']);
  assert.equal(h.settings().mode, 2);
  h.say('low');
  await h.advance(1600);
  h.say('low');
  h.say('medium');
  assert.deepEqual(h.guidance, ['system.choose_mode', 'system.choose_force', 'system.choose_duration']);
  assert.equal(h.settings().intensity, 'mid');
});

test('guidance echo cannot discard a pending visual hypothesis', async () => {
  const h = await harness();
  h.say('massage setting');
  h.say('mode three', true);
  h.say('Please select mode: mode one');
  await h.advance(250);
  assert.match(h.prompt(), /Recognizing: Mode 3/);
  assert.match(h.prompt(), /Select massage mode/);
  assert.deepEqual(h.guidance, ['system.choose_mode']);
});

for (const [language, wake, modeCommand, intensityCommand, durationCommand] of [
  ['English', 'massage setting', mode => `mode ${mode}`, intensity => `intensity ${intensity}`, duration => `${duration} minutes`],
  ['Cantonese', '按摩設定', mode => `模式${mode}`, intensity => `力度${{ low: '小', mid: '中', high: '大' }[intensity]}`, duration => `${duration}分鐘`]
]) {
  test(`${language}: all 36 step-by-step combinations advance once and never regress`, async () => {
    for (const mode of [1, 2, 3, 4]) {
      for (const intensity of ['low', 'mid', 'high']) {
        for (const duration of [1, 3, 5]) {
          const h = await harness();
          h.say(wake, true);
          h.say(wake);
          assert.match(h.prompt(), /Select massage mode/);
          const steps = [
            [modeCommand(mode), /Select massage mode/, /Select intensity/],
            [intensityCommand(intensity), /Select intensity/, /Select duration/],
            [durationCommand(duration), /Select duration/, /Setup complete/]
          ];
          for (let i = 0; i < steps.length; i++) {
            const [text, currentPrompt, nextPrompt] = steps[i];
            h.say('start');
            assert.match(h.prompt(), currentPrompt, 'premature Start stays at the current step');
            assert.equal(h.window.currentMassageSession, null);
            h.say(text, true);
            await h.advance(250);
            assert.match(h.prompt(), currentPrompt, 'interim results cannot advance the question');
            h.say(text);
            assert.match(h.prompt(), nextPrompt);
            await h.advance(2000);
            for (const previous of steps.slice(0, i + 1)) {
              h.say(previous[0], true);
              await h.advance(250);
              h.say(previous[0]);
              assert.match(h.prompt(), nextPrompt, 'old results cannot bring back a completed step');
            }
            h.say(wake, true);
            h.say(wake);
            assert.match(h.prompt(), nextPrompt, 'repeated wake results cannot restart setup');
          }
          assert.deepEqual(h.guidance, [
            'system.choose_mode', 'system.choose_force', 'system.choose_duration', 'system.confirm_summary'
          ]);
          assert.deepEqual(h.settings(), { mode, intensity, durationMin: duration, autoRead: true });
        }
      }
    }
  });
}

test('hiding the drawer and hearing the wake phrase again preserves each completed step', async () => {
  const h = await harness();
  h.say('massage setting');
  const steps = [
    ['mode three', /Select intensity/],
    ['low', /Select duration/],
    ['five', /Setup complete/]
  ];
  for (const [text, nextPrompt] of steps) {
    h.say(text);
    const before = h.settings();
    h.collapse();
    h.say('massage setting', true);
    h.say('massage setting');
    assert.equal(h.drawerOpen(), true);
    assert.match(h.prompt(), nextPrompt);
    assert.deepEqual(h.settings(), before);
  }
  assert.deepEqual(h.guidance, [
    'system.choose_mode', 'system.choose_force', 'system.choose_duration', 'system.confirm_summary'
  ]);
});

test('invalid input, recognition restart, and earlier corrections cannot move the question backward', async () => {
  const h = await harness();
  h.say('massage setting');
  h.say('mode three');
  h.say('low');
  for (const text of ['mode 10', '0 minutes', '31 minutes', 'background chatter', 'start']) {
    h.say(text, true);
    await h.advance(250);
    h.say(text);
    assert.match(h.prompt(), /Select duration/);
    assert.equal(h.window.currentMassageSession, null);
  }
  h.callbacks.stopped({});
  h.callbacks.started({});
  assert.match(h.prompt(), /Select duration/);
  h.say('mode two');
  h.say('medium');
  assert.match(h.prompt(), /Select duration/);
  h.say('five');
  assert.match(h.prompt(), /Setup complete/);
  h.say('mode four');
  h.say('high');
  h.say('0 minutes');
  assert.match(h.prompt(), /Setup complete/);
  assert.deepEqual(h.settings(), { mode: 4, intensity: 'high', durationMin: 5, autoRead: true });
  const order = ['system.choose_mode', 'system.choose_force', 'system.choose_duration', 'system.confirm_summary'];
  const stages = h.guidance.map(asset => order.indexOf(asset));
  assert.deepEqual(stages, [...stages].sort((a, b) => a - b));
});
