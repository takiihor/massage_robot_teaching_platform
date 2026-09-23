import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const STT_SERVICE_PATH = new URL('../static/stt-service.js', import.meta.url);

async function createHarness() {
  const source = await readFile(STT_SERVICE_PATH, 'utf8');
  const audioContexts = [];
  const webSockets = [];
  const stream = {
    sampleRate: 44100,
    getTracks: () => [{ stop() {} }]
  };

  class FakeAudioContext {
    constructor(options) {
      this.options = options;
      this.sampleRate = options?.sampleRate || stream.sampleRate;
      this.destination = {};
      this.state = 'running';
      audioContexts.push(this);
    }

    createMediaStreamSource(mediaStream) {
      if (this.options?.sampleRate && this.options.sampleRate !== mediaStream.sampleRate) {
        throw new Error('Connecting AudioNodes from AudioContexts with different sample-rate is currently not supported.');
      }
      return { connect() {}, disconnect() {} };
    }

    createScriptProcessor() {
      this.processor = { connect() {}, disconnect() {}, onaudioprocess: null };
      return this.processor;
    }

    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
  }

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.CONNECTING;
      this.sent = [];
      webSockets.push(this);
    }

    send(payload) {
      this.sent.push(payload);
    }

    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }

    close() {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.CLOSED;
      queueMicrotask(() => this.onclose?.());
    }

    closeUnexpectedly() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.();
    }
  }

  const window = {
    location: { protocol: 'http:', host: 'localhost:5033' },
    AudioContext: FakeAudioContext
  };
  const context = vm.createContext({
    window,
    document: { addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    WebSocket: FakeWebSocket,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    console: { log() {}, warn() {}, error() {} },
    btoa: (binary) => Buffer.from(binary, 'binary').toString('base64'),
    Float32Array,
    Int16Array,
    Uint8Array,
    Map,
    Set,
    Promise,
    queueMicrotask
  });

  vm.runInContext(source, context, { filename: 'static/stt-service.js' });
  return {
    service: window.sttService,
    audioContexts,
    webSockets
  };
}

test('Azure capture uses the native audio rate and sends 16 kHz PCM', async () => {
  const { service, audioContexts, webSockets } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  service.currentProvider = 'azure-speech-sdk';
  azure.isAvailable = true;

  await service.start('en-US');
  const ws = webSockets[0];
  ws.open();

  assert.equal(audioContexts[0].options, undefined);
  assert.equal(audioContexts[0].sampleRate, 44100);

  const input = new Float32Array(4410).fill(0.25);
  azure.processor.onaudioprocess({
    inputBuffer: { getChannelData: () => input }
  });

  const audioMessage = ws.sent.map(JSON.parse).find((message) => message.type === 'audio');
  assert.ok(audioMessage, 'expected an audio WebSocket message');
  assert.equal(Buffer.from(audioMessage.data, 'base64').byteLength, 3200);
});

test('STT start rejects with the provider error when all providers fail', async () => {
  const { service } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  const browser = service.providers.get('browser');
  const events = [];
  const startError = new Error('native audio graph mismatch');

  service.currentProvider = 'azure-speech-sdk';
  azure.isAvailable = true;
  azure.start = async () => { throw startError; };
  browser.isAvailable = false;
  service.eventBus.on('all-providers-failed', (event) => events.push(event));

  await assert.rejects(service.start('en-US'), /native audio graph mismatch/);
  assert.equal(service.isActive(), false);
  assert.equal(events[0]?.error, 'native audio graph mismatch');
});

test('runtime provider failure preserves its cause when no fallback is available', async () => {
  const { service } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  const browser = service.providers.get('browser');
  const events = [];

  service.currentProvider = 'azure-speech-sdk';
  service.isListening = true;
  azure.isListening = true;
  browser.isAvailable = false;
  service.eventBus.on('all-providers-failed', (event) => events.push(event));

  azure.errorCallback({ provider: 'azure-speech-sdk', error: 'socket transport failed' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(service.isActive(), false);
  assert.equal(events[0]?.error, 'socket transport failed');
});

test('unexpected Azure WebSocket closure switches to the browser provider', async () => {
  const { service, webSockets } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  const browser = service.providers.get('browser');
  let browserStarts = 0;

  service.currentProvider = 'azure-speech-sdk';
  azure.isAvailable = true;
  browser.isAvailable = true;
  browser.start = async () => {
    browserStarts += 1;
    browser.isListening = true;
  };

  await service.start('en-US');
  webSockets[0].open();
  webSockets[0].closeUnexpectedly();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(browserStarts, 1);
  assert.equal(service.getCurrentProvider(), 'browser');
  assert.equal(service.isActive(), true);
});

test('intentional Azure stop does not start a fallback provider', async () => {
  const { service, webSockets } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  const browser = service.providers.get('browser');
  let browserStarts = 0;

  service.currentProvider = 'azure-speech-sdk';
  azure.isAvailable = true;
  browser.isAvailable = true;
  browser.start = async () => {
    browserStarts += 1;
    browser.isListening = true;
  };

  await service.start('en-US');
  webSockets[0].open();
  await service.stop();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(browserStarts, 0);
  assert.equal(service.getCurrentProvider(), 'azure-speech-sdk');
  assert.equal(service.isActive(), false);
});
