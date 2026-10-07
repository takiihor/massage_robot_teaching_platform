import test from 'node:test';
import assert from 'node:assert/strict';
import { sendRobotCommand, sendRobotJog, restoreCalibration } from '../static/src/massage/RobotController.js';

test('robot transport requires explicit command confirmation', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { API_URL: '' };
  try {
    for (const [data, expected] of [[{}, false], [{ ok: false }, false],
      [{ status: 'error' }, false], [{ ok: true }, true], [{ status: 'success' }, true]]) {
      globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => data });
      assert.equal(await sendRobotCommand('stop'), expected);
      assert.equal((await sendRobotJog('/robot/jog/z_up')).ok, expected);
      assert.equal((await restoreCalibration()).ok, expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test('Stop has a bounded deadline even if its response body stalls', async () => {
  const saved = { fetch: globalThis.fetch, window: globalThis.window, setTimeout: globalThis.setTimeout };
  const deadlines = [];
  globalThis.window = { API_URL: '' };
  globalThis.setTimeout = (callback, delay) => { deadlines.push(delay); return saved.setTimeout(callback, 5); };
  globalThis.fetch = async (url, { signal }) => ({
    ok: true, status: 200,
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    })
  });
  try {
    assert.equal(await sendRobotCommand('stop'), false);
    assert.deepEqual(deadlines, [5000]);
    assert.match(window.__lastRobotApiResult.detail, /aborted/);
  } finally {
    Object.assign(globalThis, saved);
  }
});
