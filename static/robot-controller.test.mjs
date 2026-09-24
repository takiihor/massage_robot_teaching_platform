import test from 'node:test';
import assert from 'node:assert/strict';

// RobotController sends the optional operator token as an X-Robot-Operator
// header on robot-changing POSTs, but only when the operator has configured it
// at runtime (window.ROBOT_OPERATOR_TOKEN). On loopback the global is unset and
// no header is sent. See docs/security/robot-control-boundary.md.

function installFakeFetch() {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url, init });
        return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
        };
    };
    return calls;
}

async function freshModule(windowConfig) {
    globalThis.window = { API_URL: '', ...windowConfig };
    const url = new URL('./src/massage/RobotController.js', import.meta.url);
    // Bust the ESM cache so each case sees a clean module instance.
    url.searchParams.set('case', Math.random().toString(36).slice(2));
    return import(url.href);
}

test('sends X-Robot-Operator when a token is configured', async () => {
    const calls = installFakeFetch();
    const { sendRobotCommand } = await freshModule({ ROBOT_OPERATOR_TOKEN: 'sekret' });
    await sendRobotCommand('stop');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/stop');
    assert.equal(calls[0].init.headers['X-Robot-Operator'], 'sekret');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
});

test('omits X-Robot-Operator when no token is configured (loopback default)', async () => {
    const calls = installFakeFetch();
    const { sendRobotCommand } = await freshModule({});
    await sendRobotCommand('start', { mode: 'knead', duration: 60 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/command');
    assert.ok(!('X-Robot-Operator' in calls[0].init.headers));
});

test('connect/disconnect carry the token too', async () => {
    const calls = installFakeFetch();
    const { connectRobot, disconnectRobot } = await freshModule({ ROBOT_OPERATOR_TOKEN: 'tok2' });
    await connectRobot('127.0.0.1');
    await disconnectRobot();
    assert.equal(calls[0].init.headers['X-Robot-Operator'], 'tok2');
    assert.equal(calls[1].init.headers['X-Robot-Operator'], 'tok2');
});
