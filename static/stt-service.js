/**
 * STT Service - Speech-to-Text Provider Abstraction
 *
 * Provides a unified interface for multiple STT providers with automatic fallback:
 * 1. Azure Speech SDK (Primary) - Best Cantonese support, streaming
 * 2. Browser Web Speech API (Fallback) - Offline capable
 *
 * Note: Azure OpenAI Whisper has been removed
 *
 * @author Claude Code
 * @version 1.0.0
 */

// ==================== Event Bus ====================
class STTEventBus {
    constructor() {
        this.listeners = new Map();
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`STT EventBus error in ${event}:`, e);
                }
            });
        }
    }
}

// ==================== STT Provider Base ====================
class STTProvider {
    constructor(name) {
        this.name = name;
        this.isAvailable = false;
        this.isListening = false;
    }

    async checkAvailability() {
        return this.isAvailable;
    }

    async start(language) {
        throw new Error('start() must be implemented');
    }

    async stop() {
        throw new Error('stop() must be implemented');
    }

    onResult(callback) {
        this.resultCallback = callback;
    }

    onError(callback) {
        this.errorCallback = callback;
    }

    onPartial(callback) {
        this.partialCallback = callback;
    }
}

let _sttStatusWarnedOnce = false;

// ==================== Azure Speech SDK Provider ====================
class AzureSpeechProvider extends STTProvider {
    constructor() {
        super('azure-speech-sdk');
        this.ws = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.processor = null;
        this.source = null;
        this.stream = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
        this.expectedStop = false;
        this.providerErrorReported = false;
        this.audioSuspended = false;
        this.startGeneration = 0;
    }

    async checkAvailability() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
            const response = await fetch('/api/stt/status', { signal: controller.signal });
            if (!response.ok) {
                if (!_sttStatusWarnedOnce) {
                    _sttStatusWarnedOnce = true;
                    console.warn('[STT] /api/stt/status returned non-200; skipping JSON parse');
                }
                this.isAvailable = false;
                return false;
            }
            const data = await response.json().catch(() => null);
            const providers = Array.isArray(data?.providers) ? data.providers : [];
            const provider = providers.find(p => p.name === 'azure-speech-sdk');
            this.isAvailable = provider?.available || false;
            return this.isAvailable;
        } catch (e) {
            if (!_sttStatusWarnedOnce) {
                _sttStatusWarnedOnce = true;
                console.warn('[STT] Azure Speech availability check failed; treating as unavailable');
            }
            this.isAvailable = false;
            return false;
        } finally {
            clearTimeout(timeout);
        }
    }

    async start(language = 'zh-HK') {
        if (this.isListening) return;
        const generation = ++this.startGeneration;

        try {
            this.expectedStop = false;
            this.providerErrorReported = false;
            // getUserMedia only exists in secure contexts (https://, or
            // http://localhost / http://127.0.0.1). On plain http://<LAN-IP>
            // navigator.mediaDevices is undefined and the mic can never open,
            // so fail with an actionable message instead of a TypeError.
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error(
                    'Microphone unavailable: open this page via http://127.0.0.1:PORT or https, ' +
                    'then allow microphone access in the browser.'
                );
            }
            // Connect WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${protocol}//${window.location.host}/ws/stt/stream`);
            this.ws = ws;

            this.ws.onopen = () => {
                if (this.ws !== ws) return;
                console.log('🎤 Azure Speech WebSocket connected');
                this.reconnectAttempts = 0;
                // Send config
                this.ws.send(JSON.stringify({
                    type: 'config',
                    language: language
                }));
            };

            this.ws.onmessage = (event) => {
                if (this.ws !== ws) return;
                try {
                    this._handleMessage(JSON.parse(event.data));
                } catch (error) {
                    this._reportProviderError(`Invalid recognition message: ${error.message}`);
                }
            };

            this.ws.onerror = (error) => {
                if (this.ws !== ws) return;
                console.error('Azure Speech WebSocket error:', error);
                this._reportProviderError('WebSocket error');
            };

            this.ws.onclose = () => {
                if (this.ws !== ws) return;
                console.log('Azure Speech WebSocket closed');
                const closedUnexpectedly = this.isListening && !this.expectedStop;
                this.isListening = false;
                this._cleanup();
                if (closedUnexpectedly) {
                    this._reportProviderError('Azure Speech WebSocket closed unexpectedly');
                }
            };

            // Warm the recognizer while microphone permission/device setup is
            // pending, instead of paying the connection handshake afterwards.
            // Get microphone stream
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            if (generation !== this.startGeneration || this.expectedStop) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            this.stream = stream;

            if (!this.ws || this.ws.readyState >= WebSocket.CLOSING || this.providerErrorReported) {
                throw new Error('Azure Speech connection failed during microphone startup');
            }

            // Setup audio processing
            await this._setupAudioProcessing();
            if (generation !== this.startGeneration || this.expectedStop) return;
            this.isListening = true;

        } catch (e) {
            if (generation !== this.startGeneration) return;
            console.error('Azure Speech start failed:', e);
            this.expectedStop = true;
            this._cleanup();
            throw e;
        }
    }

    async _setupAudioProcessing() {
        // Use the device's native sample rate so createMediaStreamSource works
        // across browsers (Firefox rejects contexts whose sampleRate differs
        // from the microphone's). Audio is resampled to 16 kHz before sending.
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioCtx();

        // Chrome/Firefox start an AudioContext in 'suspended' until a user
        // gesture. A suspended context never fires onaudioprocess, so the mic
        // would stream nothing and no text would ever be recognized. Kick off a
        // best-effort resume (never awaited: pre-gesture resume() stays pending
        // and must not stall startup), retry on the next gesture, and flag the
        // UI when a click/keypress is still needed.
        const wasSuspended = this.audioContext.state === 'suspended';
        this._resumeAudioContext();
        this._armAudioResumeOnGesture();
        this.audioSuspended = wasSuspended && this.audioContext.state === 'suspended';
        if (this.audioSuspended) {
            console.warn(
                '[STT] Microphone pipeline is suspended until the next click/keypress. ' +
                'Click anywhere on the page once to enable voice input.'
            );
        }

        this.source = this.audioContext.createMediaStreamSource(this.stream);
        this.captureSampleRate = this.audioContext.sampleRate;

        // Use ScriptProcessor for audio capture (deprecated but widely supported)
        // Keep capture chunks near 20–65 ms at common device rates.
        // 4096 samples added 85–256 ms before audio could reach Azure.
        const bufferSize = 1024;
        this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        this.processor.onaudioprocess = (e) => {
            if (!this.isListening || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            const inputData = e.inputBuffer.getChannelData(0);
            // Resample to 16 kHz (Azure PushAudioInputStream expects 16 kHz PCM)
            const resampled = this._resampleLinear(
                inputData, this.captureSampleRate, 16000
            );
            // Convert to 16-bit PCM
            const pcmData = this._float32ToInt16(resampled);
            // Send as base64
            const base64 = this._arrayBufferToBase64(pcmData.buffer);

            this.ws.send(JSON.stringify({
                type: 'audio',
                data: base64
            }));
        };

        this.source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);
    }

    _resumeAudioContext() {
        // Fire-and-forget: pre-gesture resume() never settles in Chrome/Firefox,
        // so awaiting it would stall provider startup indefinitely.
        if (!this.audioContext || this.audioContext.state !== 'suspended') return;
        if (typeof this.audioContext.resume !== 'function') return;
        try {
            const result = this.audioContext.resume();
            result?.then?.(() => {
                if (this.audioContext && this.audioContext.state !== 'suspended' && this.audioSuspended) {
                    this.audioSuspended = false;
                    console.log('[STT] Microphone pipeline resumed.');
                }
            }).catch?.(() => {});
        } catch (e) {
            console.warn('[STT] AudioContext resume blocked until user gesture:', e?.message || e);
        }
    }

    _armAudioResumeOnGesture() {
        if (this._audioResumeArmed || typeof window === 'undefined') return;
        if (typeof window.addEventListener !== 'function') return;
        this._audioResumeArmed = true;
        this._audioResumeHandler = () => {
            if (!this.audioContext) return;
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume().catch(() => {});
            } else if (this._audioResumeHandler
                && typeof window.removeEventListener === 'function') {
                window.removeEventListener('pointerdown', this._audioResumeHandler);
                window.removeEventListener('keydown', this._audioResumeHandler);
                this._audioResumeHandler = null;
                this._audioResumeArmed = false;
                if (this.audioSuspended) {
                    this.audioSuspended = false;
                    console.log('[STT] Microphone pipeline resumed by user gesture.');
                }
            }
        };
        window.addEventListener('pointerdown', this._audioResumeHandler);
        window.addEventListener('keydown', this._audioResumeHandler);
    }

    _disarmAudioResumeOnGesture() {
        if (this._audioResumeHandler && typeof window !== 'undefined'
            && typeof window.removeEventListener === 'function') {
            window.removeEventListener('pointerdown', this._audioResumeHandler);
            window.removeEventListener('keydown', this._audioResumeHandler);
        }
        this._audioResumeHandler = null;
        this._audioResumeArmed = false;
    }

    _resampleLinear(input, inputRate, outputRate) {
        if (inputRate === outputRate) {
            return input;
        }
        const outputLength = Math.round(input.length * outputRate / inputRate);
        const output = new Float32Array(outputLength);
        const ratio = inputRate / outputRate;
        for (let i = 0; i < outputLength; i++) {
            const pos = i * ratio;
            const index = Math.floor(pos);
            const frac = pos - index;
            const sample0 = input[index] || 0;
            const sample1 = index + 1 < input.length ? input[index + 1] : sample0;
            output[i] = sample0 + (sample1 - sample0) * frac;
        }
        return output;
    }

    _float32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    _arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case 'partial':
                if (this.partialCallback) {
                    this.partialCallback({
                        provider: this.name,
                        text: msg.text,
                        confidence: msg.confidence || 0
                    });
                }
                break;

            case 'final':
                if (this.resultCallback) {
                    this.resultCallback({
                        provider: this.name,
                        text: msg.text,
                        confidence: msg.confidence || 0,
                        alternatives: msg.alternatives || [],
                        isFinal: true
                    });
                }
                break;

            case 'error':
                console.error('Azure Speech error:', msg.message);
                this._reportProviderError(msg.message);
                break;

            case 'status':
                console.log(`Azure Speech status: ${msg.state}`);
                if (msg.state === 'stopped' && this.isListening && !this.expectedStop) {
                    const reason = msg.reason ? ` (${msg.reason})` : '';
                    this.isListening = false;
                    this._cleanup();
                    this._reportProviderError(
                        `Azure Speech recognition stopped unexpectedly${reason}`
                    );
                }
                break;
        }
    }

    _reportProviderError(error) {
        if (this.providerErrorReported) return;
        this.providerErrorReported = true;
        if (this.errorCallback) {
            this.errorCallback({ provider: this.name, error });
        }
    }

    async stop() {
        this.startGeneration++;
        this.isListening = false;
        this.expectedStop = true;

        // Send stop command
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'stop' }));
        }

        this._cleanup();
    }

    _cleanup() {
        this._disarmAudioResumeOnGesture();
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        if (this.audioContext) {
            this.audioContext.close()?.catch?.(() => {});
            this.audioContext = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        if (this.ws) {
            const ws = this.ws;
            this.ws = null;
            ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
            ws.close();
        }
    }
}

/*
 * Azure OpenAI Provider class has been removed
 * (was between lines 305-429 in original file)
 *
 * To re-enable, uncomment the class below and restore in _initProviders():
 */
// class AzureOpenAIProvider extends STTProvider {
//     constructor() {
//         super('azure-openai');
//         this.mediaRecorder = null;
//         this.audioChunks = [];
//         this.stream = null;
//     }
//
//     async checkAvailability() {
//         try {
//             const response = await fetch('/api/stt/status');
//             if (!response.ok) {
//                 if (!_sttStatusWarnedOnce) {
//                     _sttStatusWarnedOnce = true;
//                     console.warn('[STT] /api/stt/status returned non-200; skipping JSON parse');
//                 }
//                 this.isAvailable = false;
//                 return false;
//             }
//             const data = await response.json().catch(() => null);
//             const providers = Array.isArray(data?.providers) ? data.providers : [];
//             const provider = providers.find(p => p.name === 'azure-openai');
//             this.isAvailable = provider?.available || false;
//             return this.isAvailable;
//         } catch (e) {
//             if (!_sttStatusWarnedOnce) {
//                 _sttStatusWarnedOnce = true;
//                 console.warn('[STT] Azure OpenAI availability check failed; treating as unavailable');
//             }
//             this.isAvailable = false;
//             return false;
//         }
//     }
//
//     async start(language = 'zh-HK') {
//         if (this.isListening) return;
//
//         try {
//             this.stream = await navigator.mediaDevices.getUserMedia({
//                 audio: {
//                     channelCount: 1,
//                     sampleRate: 16000,
//                     echoCancellation: true,
//                     noiseSuppression: true
//                 }
//             });
//
//             this.audioChunks = [];
//             this.mediaRecorder = new MediaRecorder(this.stream, {
//                 mimeType: 'audio/webm;codecs=opus'
//             });
//
//             this.mediaRecorder.ondataavailable = (event) => {
//                 if (event.data.size > 0) {
//                     this.audioChunks.push(event.data);
//                 }
//             };
//
//             this.mediaRecorder.onstop = async () => {
//                 await this._transcribe();
//             };
//
//             this.mediaRecorder.start(1000); // Collect chunks every second
//             this.isListening = true;
//
//         } catch (e) {
//             console.error('Azure OpenAI start failed:', e);
//             throw e;
//         }
//     }
//
//     async _transcribe() {
//         if (this.audioChunks.length === 0) return;
//
//         const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
//         this.audioChunks = [];
//
//         const formData = new FormData();
//         formData.append('file', audioBlob, 'audio.webm');
//         formData.append('deployment', 'whisper');
//
//         try {
//             const response = await fetch('/api/stt/transcribe', {
//                 method: 'POST',
//                 body: formData
//             });
//
//             if (!response.ok) {
//                 throw new Error(`Transcription failed: ${response.status}`);
//             }
//
//             const result = await response.json();
//             if (result.text && this.resultCallback) {
//                 this.resultCallback({
//                     provider: this.name,
//                     text: result.text,
//                     confidence: 0.9,
//                     alternatives: [],
//                     isFinal: true
//                 });
//             }
//         } catch (e) {
//             console.error('Azure OpenAI transcription error:', e);
//             if (this.errorCallback) {
//                 this.errorCallback({ provider: this.name, error: e.message });
//             }
//         }
//     }
//
//     async stop() {
//         if (!this.isListening) return;
//
//         this.isListening = false;
//
//         if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
//             this.mediaRecorder.stop();
//         }
//
//         if (this.stream) {
//             this.stream.getTracks().forEach(track => track.stop());
//             this.stream = null;
//         }
//     }
// }



// ==================== Browser Speech Recognition Provider ====================
class BrowserSTTProvider extends STTProvider {
    constructor() {
        super('browser');
        this.recognition = null;
        this.isAvailable = this._checkSupport();
    }

    _checkSupport() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    async checkAvailability() {
        this.isAvailable = this._checkSupport();
        return this.isAvailable;
    }

    async start(language = 'zh-HK') {
        if (this.isListening) return;

        if (!this.isAvailable) {
            throw new Error('Browser speech recognition not supported');
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        const recognition = this.recognition;

        this.recognition.lang = language;
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 3;

        this.recognition.onresult = (event) => {
            if (this.recognition !== recognition || !this.isListening) return;
            // A single event may finalize one phrase and contain the next interim.
            // Deliver all changed results so completed commands are not lost.
            for (let resultIndex = event.resultIndex ?? 0; resultIndex < event.results.length; resultIndex++) {
                const lastResult = event.results[resultIndex];
                const transcript = lastResult[0].transcript;
                const confidence = lastResult[0].confidence || 0;

                if (lastResult.isFinal) {
                    const alternatives = [];
                    for (let i = 1; i < lastResult.length && i < 4; i++) {
                        alternatives.push({
                            text: lastResult[i].transcript,
                            confidence: lastResult[i].confidence || 0
                        });
                    }

                    if (this.resultCallback) {
                        this.resultCallback({
                            provider: this.name,
                            text: transcript,
                            confidence: confidence,
                            alternatives: alternatives,
                            isFinal: true
                        });
                    }
                } else {
                    if (this.partialCallback) {
                        this.partialCallback({
                            provider: this.name,
                            text: transcript,
                            confidence: confidence
                        });
                    }
                }
            }
        };

        this.recognition.onerror = (event) => {
            if (this.recognition !== recognition || !this.isListening) return;
            console.error('Browser STT error:', event.error);

            // Don't report certain errors
            if (event.error === 'no-speech' || event.error === 'aborted') {
                return;
            }

            if (this.errorCallback) {
                this.errorCallback({
                    provider: this.name,
                    error: event.error
                });
            }
        };

        this.recognition.onend = () => {
            // Auto-restart if still listening
            if (this.recognition === recognition && this.isListening) {
                try {
                    this.recognition.start();
                } catch (e) {
                    // Ignore restart errors
                }
            }
        };

        this.recognition.start();
        this.isListening = true;
        console.log('🎤 Browser speech recognition started');
    }

    async stop() {
        if (!this.isListening) return;

        this.isListening = false;

        if (this.recognition) {
            const recognition = this.recognition;
            this.recognition = null;
            recognition.stop();
        }
    }
}

// ==================== STT Service (Main Class) ====================
class STTService {
    constructor() {
        this.eventBus = new STTEventBus();
        this.providers = new Map();
        this.currentProvider = null;
        this.fallbackChain = ['azure-speech-sdk', 'browser'];
        this.isListening = false;
        this.language = 'zh-HK';
        this.startGeneration = 0;
        this.startPromise = null;
        this.fallbackPromise = null;

        // Statistics
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            providerSwitches: 0,
            lastProvider: null,
            lastError: null
        };

        this._initProviders();
    }

    _initProviders() {
        this.providers.set('azure-speech-sdk', new AzureSpeechProvider());
        // Azure OpenAI provider has been removed
        // this.providers.set('azure-openai', new AzureOpenAIProvider());
        this.providers.set('browser', new BrowserSTTProvider());

        // Setup callbacks for all providers
        this.providers.forEach((provider, name) => {
            provider.onResult((result) => {
                this.stats.successfulRequests++;
                this.stats.lastProvider = name;
                this.eventBus.emit('result', result);
            });

            provider.onPartial((result) => {
                this.eventBus.emit('partial', result);
            });

            provider.onError((error) => {
                this.stats.failedRequests++;
                this.stats.lastError = error;
                this.eventBus.emit('error', error);
                this._handleProviderError(name, error);
            });
        });
    }

    async initialize() {
        console.log('🔧 Initializing STT Service...');

        // Check availability of all providers
        const availabilityPromises = [];
        this.providers.forEach((provider, name) => {
            availabilityPromises.push(
                provider.checkAvailability().then(available => ({ name, available }))
            );
        });

        const results = await Promise.all(availabilityPromises);
        results.forEach(({ name, available }) => {
            console.log(`  ${available ? '✅' : '❌'} ${name}: ${available ? 'available' : 'unavailable'}`);
        });

        // Select primary provider
        for (const providerName of this.fallbackChain) {
            const provider = this.providers.get(providerName);
            if (provider && provider.isAvailable) {
                this.currentProvider = providerName;
                break;
            }
        }

        if (!this.currentProvider) {
            console.warn('⚠️ No STT providers available');
        } else {
            console.log(`📍 Primary STT provider: ${this.currentProvider}`);
        }

        this.eventBus.emit('initialized', {
            primaryProvider: this.currentProvider,
            availableProviders: results.filter(r => r.available).map(r => r.name)
        });

        return this.currentProvider;
    }

    async start(language = null) {
        if (this.startPromise) return this.startPromise;
        const pending = this._start(language, this.startGeneration);
        this.startPromise = pending;
        try {
            return await pending;
        } finally {
            if (this.startPromise === pending) this.startPromise = null;
        }
    }

    async _start(language, generation) {
        if (this.isListening) {
            console.warn('STT already listening');
            return;
        }

        if (language) {
            this.language = language;
        }

        if (!this.currentProvider) {
            await this.initialize();
        }
        if (generation !== this.startGeneration) return;

        if (!this.currentProvider) {
            throw new Error('No STT providers available');
        }

        const provider = this.providers.get(this.currentProvider);
        if (!provider) {
            throw new Error(`Provider ${this.currentProvider} not found`);
        }

        try {
            await provider.start(this.language);
            if (generation !== this.startGeneration) return;
            this.isListening = true;
            this.stats.totalRequests++;

            this.eventBus.emit('started', {
                provider: this.currentProvider,
                language: this.language
            });

            console.log(`🎤 STT started with ${this.currentProvider}`);
        } catch (e) {
            if (generation !== this.startGeneration) return;
            console.error(`Failed to start ${this.currentProvider}:`, e);
            const fallbackStarted = await this._switchToFallback(e);
            if (!fallbackStarted) {
                throw e;
            }
        }
    }

    async stop() {
        this.startGeneration++;

        const provider = this.providers.get(this.currentProvider);
        this.startPromise = null;
        if (provider) {
            await provider.stop();
        }

        this.isListening = false;
        this.eventBus.emit('stopped', { provider: this.currentProvider });
        console.log('🎤 STT stopped');
    }

    async _switchToFallback(initialError = null) {
        const generation = this.startGeneration;
        const currentIndex = this.fallbackChain.indexOf(this.currentProvider);
        let lastError = initialError;

        for (let i = currentIndex + 1; i < this.fallbackChain.length; i++) {
            if (generation !== this.startGeneration) return false;
            const nextProvider = this.fallbackChain[i];
            const provider = this.providers.get(nextProvider);

            if (provider && provider.isAvailable) {
                console.log(`🔄 Switching STT from ${this.currentProvider} to ${nextProvider}`);

                // Stop current
                const currentProviderObj = this.providers.get(this.currentProvider);
                if (currentProviderObj) {
                    await currentProviderObj.stop();
                }
                if (generation !== this.startGeneration) return false;

                // Start new
                this.currentProvider = nextProvider;
                this.stats.providerSwitches++;

                try {
                    await provider.start(this.language);
                    if (generation !== this.startGeneration) return false;
                    this.isListening = true;

                    this.eventBus.emit('provider-switched', {
                        from: this.fallbackChain[currentIndex],
                        to: nextProvider,
                        reason: 'fallback'
                    });

                    this.eventBus.emit('started', { provider: nextProvider, language: this.language });
                    return true;
                } catch (e) {
                    console.error(`Failed to start ${nextProvider}:`, e);
                    lastError = e;
                    continue;
                }
            }
        }

        // All providers failed
        if (generation !== this.startGeneration) return false;
        // Tear down the last provider too: otherwise browser recognition keeps
        // auto-restarting and Azure can keep a microphone/socket open even
        // though the service reports stopped. A later Start must be fresh.
        const failedProvider = this.providers.get(this.currentProvider);
        try {
            await failedProvider?.stop();
        } catch (error) {
            console.warn('Failed to stop exhausted STT provider:', error);
        }
        this.isListening = false;
        const errorMessage = lastError?.message || lastError?.error || 'All STT providers failed';
        this.eventBus.emit('stopped', { provider: this.currentProvider });
        this.eventBus.emit('all-providers-failed', {
            lastProvider: this.currentProvider,
            error: errorMessage
        });
        return false;
    }

    async _handleProviderError(providerName, error) {
        if (providerName === this.currentProvider && this.isListening && !this.fallbackPromise) {
            console.warn(`Current provider ${providerName} error, attempting fallback...`);
            this.fallbackPromise = this._switchToFallback(error);
            try {
                await this.fallbackPromise;
            } finally {
                this.fallbackPromise = null;
            }
        }
    }

    async switchProvider(providerName) {
        if (!this.providers.has(providerName)) {
            throw new Error(`Unknown provider: ${providerName}`);
        }

        const provider = this.providers.get(providerName);
        if (!provider.isAvailable) {
            throw new Error(`Provider ${providerName} is not available`);
        }

        const wasListening = this.isListening;

        if (wasListening) {
            await this.stop();
        }

        const oldProvider = this.currentProvider;
        this.currentProvider = providerName;

        if (wasListening) {
            await this.start(this.language);
        }

        this.eventBus.emit('provider-switched', {
            from: oldProvider,
            to: providerName,
            reason: 'manual'
        });
    }

    setLanguage(language) {
        this.language = language;
        if (this.isListening) {
            // Restart with new language
            this.stop().then(() => this.start(language));
        }
    }

    // Event subscriptions
    onResult(callback) {
        return this.eventBus.on('result', callback);
    }

    onPartial(callback) {
        return this.eventBus.on('partial', callback);
    }

    onError(callback) {
        return this.eventBus.on('error', callback);
    }

    onProviderSwitch(callback) {
        return this.eventBus.on('provider-switched', callback);
    }

    onStarted(callback) {
        return this.eventBus.on('started', callback);
    }

    onStopped(callback) {
        return this.eventBus.on('stopped', callback);
    }

    // Status methods
    getCurrentProvider() {
        return this.currentProvider;
    }

    getAvailableProviders() {
        const available = [];
        this.providers.forEach((provider, name) => {
            if (provider.isAvailable) {
                available.push(name);
            }
        });
        return available;
    }

    getStats() {
        return { ...this.stats };
    }

    isActive() {
        return this.isListening;
    }

    // True when the current provider is up but its microphone pipeline is
    // suspended until a user gesture (autoplay policy). The UI should prompt
    // for one click/keypress instead of leaving the user speaking into silence.
    needsUserGesture() {
        const provider = this.providers.get(this.currentProvider);
        if (!this.isListening || !provider) return false;
        // Prefer the live AudioContext state: it also catches suspensions that
        // happen after startup (e.g. tab hidden, device change).
        if (provider.audioContext) return provider.audioContext.state === 'suspended';
        return !!provider.audioSuspended;
    }
}

// ==================== Global Instance ====================
const sttService = new STTService();

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.STTService = STTService;
    window.sttService = sttService;
}

// Auto-initialize on load
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        sttService.initialize().then(() => {
            console.log('✅ STT Service initialized');
        }).catch(e => {
            console.error('❌ STT Service initialization failed:', e);
        });
    });
}
