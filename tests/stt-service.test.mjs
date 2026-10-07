import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const STT_SERVICE_PATH = new URL('../static/stt-service.js', import.meta.url);

async function createHarness(options = {}) {
  const source = await readFile(STT_SERVICE_PATH, 'utf8');
  const audioContexts = [];
  const webSockets = [];
  const initialAudioState = options.audioState || 'running';
  const audioBlocked = options.audioBlocked || false;
  const stream = {
    sampleRate: 44100,
    getTracks: () => [{ stop() {} }]
  };

  class FakeAudioContext {
    constructor(contextOptions) {
      this.options = contextOptions;
      this.sampleRate = contextOptions?.sampleRate || stream.sampleRate;
      this.destination = {};
      this.state = initialAudioState;
      audioContexts.push(this);
    }

    resume() {
      // Models a pre-gesture browser when audioBlocked: resume() never settles.
      if (audioBlocked) return new Promise(() => {});
      this.state = 'running';
      return Promise.resolve();
    }

    createMediaStreamSource(mediaStream) {
      if (this.options?.sampleRate && this.options.sampleRate !== mediaStream.sampleRate) {
        throw new Error('Connecting AudioNodes from AudioContexts with different sample-rate is currently not supported.');
      }
      return { connect() {}, disconnect() {} };
    }

    createScriptProcessor(bufferSize) {
      this.processor = { bufferSize, connect() {}, disconnect() {}, onaudioprocess: null };
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
    AudioContext: FakeAudioContext,
    SpeechRecognition: class { start() {} stop() {} },
    addEventListener() {},
    removeEventListener() {}
  };
  const navigatorStub = { mediaDevices: { getUserMedia: options.getUserMedia || (async () => stream) } };
  const context = vm.createContext({
    window,
    document: { addEventListener() {} },
    navigator: navigatorStub,
    WebSocket: FakeWebSocket,
    fetch: options.fetch || (async () => ({ ok: false, json: async () => ({}) })),
    AbortController,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
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
    webSockets,
    setMediaDevices: (value) => { navigatorStub.mediaDevices = value; }
  };
}

test('a stalled status response body cannot block browser recognition fallback', async () => {
  const { service } = await createHarness({
    fetch: async (url, { signal }) => ({ ok: true, json: () => new Promise((resolve, reject) => {
      if (signal.aborted) reject(new Error('aborted'));
      else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) }),
    setTimeout: callback => { queueMicrotask(callback); return 1; },
    clearTimeout() {}
  });
  assert.equal(await service.initialize(), 'browser');
  assert.equal(service.providers.get('azure-speech-sdk').isAvailable, false);
});

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

test('concurrent STT starts share one microphone and socket', async () => {
  let resolveMedia;
  const stream = { getTracks: () => [{ stop() {} }] };
  const { service, webSockets } = await createHarness({
    getUserMedia: () => new Promise(resolve => { resolveMedia = resolve; })
  });
  service.currentProvider = 'azure-speech-sdk';
  const first = service.start();
  const second = service.start();
  assert.equal(webSockets.length, 1);
  resolveMedia(stream);
  await Promise.all([first, second]);
  assert.equal(service.stats.totalRequests, 1);
  await service.stop();
});

test('Stop during microphone permission prevents a late stream from restarting recognition', async () => {
  let resolveMedia;
  let stoppedTracks = 0;
  const { service, audioContexts, webSockets } = await createHarness({
    getUserMedia: () => new Promise(resolve => { resolveMedia = resolve; })
  });
  service.currentProvider = 'azure-speech-sdk';
  const starting = service.start();
  await service.stop();
  resolveMedia({ getTracks: () => [{ stop() { stoppedTracks++; } }] });
  await starting;
  assert.equal(service.isListening, false);
  assert.equal(stoppedTracks, 1);
  assert.equal(audioContexts.length, 0);
  assert.equal(webSockets[0].readyState, 3);
});

test('old socket callbacks cannot stop a fresh recognition session', async () => {
  const { service, webSockets } = await createHarness();
  service.currentProvider = 'azure-speech-sdk';
  await service.start();
  const oldClose = webSockets[0].onclose;
  const oldMessage = webSockets[0].onmessage;
  await service.stop();
  await service.start();
  oldClose();
  oldMessage({ data: JSON.stringify({ type: 'status', state: 'stopped' }) });
  assert.equal(service.isListening, true);
  assert.equal(service.providers.get('azure-speech-sdk').ws, webSockets[1]);
  assert.equal(webSockets[1].readyState, 0);
  await service.stop();
});

test('new Start can proceed while a cancelled microphone request is still pending', async () => {
  const resolutions = [];
  let oldStopped = 0;
  const { service, audioContexts, webSockets } = await createHarness({
    getUserMedia: () => new Promise(resolve => resolutions.push(resolve))
  });
  service.currentProvider = 'azure-speech-sdk';
  const oldStart = service.start();
  await service.stop();
  const newStart = service.start();
  assert.equal(webSockets.length, 2);
  resolutions[1]({ getTracks: () => [{ stop() {} }] });
  await newStart;
  resolutions[0]({ getTracks: () => [{ stop() { oldStopped++; } }] });
  await oldStart;
  assert.equal(oldStopped, 1);
  assert.equal(service.isListening, true);
  assert.equal(audioContexts.length, 1);
  await service.stop();
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
  assert.equal(azure.isListening, false);
  assert.equal(events[0]?.error, 'socket transport failed');
});

test('terminal Azure failure releases resources and a later start captures again', async () => {
  const { service, audioContexts, webSockets } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  service.currentProvider = 'azure-speech-sdk';
  azure.isAvailable = true;
  service.providers.get('browser').isAvailable = false;
  await service.start('en-US');
  webSockets[0].open();
  azure._reportProviderError('transport failed');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.isActive(), false);
  assert.equal(azure.isListening, false);
  assert.equal(audioContexts[0].state, 'closed');
  assert.equal(webSockets[0].readyState, 3);
  assert.equal(azure.stream, null);

  await service.start('en-US');
  assert.equal(service.isActive(), true);
  assert.equal(audioContexts.length, 2);
  assert.equal(webSockets.length, 2);
  await service.stop();
});

test('terminal browser permission failure prevents automatic recognition restart', async () => {
  const { service } = await createHarness();
  service.currentProvider = 'browser';
  await service.start('en-US');
  const browser = service.providers.get('browser');
  const recognition = browser.recognition;
  let restarts = 0;
  recognition.start = () => { restarts++; };
  recognition.onerror({ error: 'not-allowed' });
  await new Promise(resolve => setImmediate(resolve));
  recognition.onend();
  assert.equal(service.isActive(), false);
  assert.equal(browser.isListening, false);
  assert.equal(browser.recognition, null);
  assert.equal(restarts, 0);
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

test('suspended AudioContext flags the need for a user gesture', async () => {
  const { service } = await createHarness({ audioState: 'suspended', audioBlocked: true });
  const azure = service.providers.get('azure-speech-sdk');

  service.currentProvider = 'azure-speech-sdk';
  azure.isAvailable = true;

  await service.start('en-US');

  assert.equal(azure.audioSuspended, true);
  assert.equal(service.needsUserGesture(), true);
});

test('running AudioContext does not ask for a user gesture', async () => {
  const { service } = await createHarness({ audioState: 'running' });
  const azure = service.providers.get('azure-speech-sdk');

  service.currentProvider = 'azure-speech-sdk';
  azure.isAvailable = true;

  await service.start('en-US');

  assert.equal(azure.audioSuspended, false);
  assert.equal(service.needsUserGesture(), false);
});

test('missing mediaDevices rejects with an actionable microphone message', async () => {
  const { service, setMediaDevices } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');

  service.currentProvider = 'azure-speech-sdk';
  azure.isAvailable = true;
  setMediaDevices(undefined);

  await assert.rejects(azure.start('en-US'), /Microphone unavailable/);
});


test('Azure capture streams each small chunk without waiting for a larger batch', async () => {
  const { service, audioContexts, webSockets } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  await azure.start('zh-HK');
  const ws = webSockets[0];
  ws.open();
  const { bufferSize } = audioContexts[0].processor;
  assert.ok(bufferSize / audioContexts[0].sampleRate <= 0.025,
    'capture must not add more than 25 ms at 44.1 kHz');
  for (let i = 0; i < 3; i++) {
    azure.processor.onaudioprocess({
      inputBuffer: { getChannelData: () => new Float32Array(bufferSize).fill(0.25) }
    });
    const chunks = ws.sent.map(JSON.parse).filter(message => message.type === 'audio');
    assert.equal(chunks.length, i + 1);
    assert.equal(Buffer.from(chunks[i].data, 'base64').length,
      Math.round(bufferSize * 16000 / 44100) * 2);
  }
  await azure.stop();
});

test('browser delivers completed phrases before the next interim in the same event', async () => {
  const { service } = await createHarness();
  const browser = service.providers.get('browser');
  const delivered = [];
  browser.onResult(result => delivered.push(['final', result.text]));
  browser.onPartial(result => delivered.push(['partial', result.text]));
  await browser.start('en-US');
  const result = (text, isFinal) => Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal });
  browser.recognition.onresult({ resultIndex: 1, results: [
    result('previous phrase', true),
    result('mode one', true),
    result('light', true),
    result('ten minutes', false)
  ] });
  assert.deepEqual(delivered, [
    ['final', 'mode one'], ['final', 'light'], ['partial', 'ten minutes']
  ]);
  await browser.stop();
});


test('old browser recognition callbacks cannot emit commands or restart a replacement', async () => {
  const { service } = await createHarness();
  const browser = service.providers.get('browser');
  const results = [];
  const errors = [];
  browser.onResult(result => results.push(result.text));
  browser.onError(error => errors.push(error));
  await browser.start('en-US');
  const previous = browser.recognition;
  await browser.stop();
  await browser.start('en-US');
  let starts = 0;
  browser.recognition.start = () => { starts++; };
  previous.onresult({ resultIndex: 0, results: [
    Object.assign([{ transcript: 'start', confidence: 1 }], { isFinal: true })
  ] });
  previous.onerror({ error: 'network' });
  previous.onend();
  assert.deepEqual(results, []);
  assert.deepEqual(errors, []);
  assert.equal(starts, 0);
  await browser.stop();
});

test('startup fallback emits listening status and total failure clears it', async () => {
  const { service } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  const browser = service.providers.get('browser');
  service.currentProvider = 'azure-speech-sdk';
  azure.isAvailable = browser.isAvailable = true;
  azure.start = async () => { throw new Error('Azure unavailable'); };
  const started = [];
  const stopped = [];
  service.onStarted(event => started.push(event.provider));
  service.onStopped(event => stopped.push(event.provider));
  await service.start('en-US');
  assert.deepEqual(started, ['browser']);
  assert.equal(service.isActive(), true);
  await service._handleProviderError('browser', { error: 'network' });
  assert.deepEqual(stopped, ['browser']);
  assert.equal(service.isActive(), false);
});


test('Azure connects while microphone permission is pending', async () => {
  const { service, webSockets, setMediaDevices } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  let grantMicrophone;
  setMediaDevices({ getUserMedia: () => new Promise(resolve => { grantMicrophone = resolve; }) });
  const starting = azure.start('en-US');
  assert.equal(webSockets.length, 1, 'warm connection before microphone permission resolves');
  webSockets[0].open();
  assert.equal(JSON.parse(webSockets[0].sent[0]).type, 'config');
  assert.equal(azure.processor, null);
  grantMicrophone({ sampleRate: 44100, getTracks: () => [{ stop() {} }] });
  await starting;
  assert.equal(azure.isListening, true);
  await azure.stop();
});

test('Azure startup connection failure cleans up a microphone granted afterwards', async () => {
  const { service, webSockets, setMediaDevices } = await createHarness();
  const azure = service.providers.get('azure-speech-sdk');
  let grantMicrophone;
  let trackStopped = false;
  setMediaDevices({ getUserMedia: () => new Promise(resolve => { grantMicrophone = resolve; }) });
  const starting = azure.start('en-US');
  webSockets[0].closeUnexpectedly();
  grantMicrophone({ sampleRate: 44100, getTracks: () => [{ stop() { trackStopped = true; } }] });
  await assert.rejects(starting, /connection failed during microphone startup/);
  assert.equal(trackStopped, true);
  assert.equal(azure.isListening, false);
});
