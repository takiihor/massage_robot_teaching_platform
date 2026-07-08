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
    }

    async checkAvailability() {
        try {
            const response = await fetch('/api/stt/status');
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
        }
    }

    async start(language = 'zh-HK') {
        if (this.isListening) return;

        try {
            this.expectedStop = false;
            // Get microphone stream
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // Connect WebSocket
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/stt/stream`);

            this.ws.onopen = () => {
                console.log('🎤 Azure Speech WebSocket connected');
                this.reconnectAttempts = 0;
                // Send config
                this.ws.send(JSON.stringify({
                    type: 'config',
                    language: language
                }));
            };

            this.ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                this._handleMessage(msg);
            };

            this.ws.onerror = (error) => {
                console.error('Azure Speech WebSocket error:', error);
                if (this.errorCallback) {
                    this.errorCallback({ provider: this.name, error: 'WebSocket error' });
                }
            };

            this.ws.onclose = () => {
                console.log('Azure Speech WebSocket closed');
                this.isListening = false;
                this._cleanup();
            };

            // Setup audio processing
            await this._setupAudioProcessing();
            this.isListening = true;

        } catch (e) {
            console.error('Azure Speech start failed:', e);
            this._cleanup();
            throw e;
        }
    }

    async _setupAudioProcessing() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
        });

        this.source = this.audioContext.createMediaStreamSource(this.stream);

        // Use ScriptProcessor for audio capture (deprecated but widely supported)
        const bufferSize = 4096;
        this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

        this.processor.onaudioprocess = (e) => {
            if (!this.isListening || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }

            const inputData = e.inputBuffer.getChannelData(0);
            // Convert to 16-bit PCM
            const pcmData = this._float32ToInt16(inputData);
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
                if (this.errorCallback) {
                    this.errorCallback({
                        provider: this.name,
                        error: msg.message
                    });
                }
                break;

            case 'status':
                console.log(`Azure Speech status: ${msg.state}`);
                if (msg.state === 'stopped' && this.isListening && !this.expectedStop) {
                    const reason = msg.reason ? ` (${msg.reason})` : '';
                    this.isListening = false;
                    this._cleanup();
                    if (this.errorCallback) {
                        this.errorCallback({
                            provider: this.name,
                            error: `Azure Speech recognition stopped unexpectedly${reason}`
                        });
                    }
                }
                break;
        }
    }

    async stop() {
        if (!this.isListening) return;

        this.isListening = false;
        this.expectedStop = true;

        // Send stop command
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'stop' }));
        }

        this._cleanup();
    }

    _cleanup() {
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.expectedStop = false;
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

        this.recognition.lang = language;
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 3;

        this.recognition.onresult = (event) => {
            const lastResult = event.results[event.results.length - 1];
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
        };

        this.recognition.onerror = (event) => {
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
            if (this.isListening) {
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
            this.recognition.stop();
            this.recognition = null;
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

        if (!this.currentProvider) {
            throw new Error('No STT providers available');
        }

        const provider = this.providers.get(this.currentProvider);
        if (!provider) {
            throw new Error(`Provider ${this.currentProvider} not found`);
        }

        try {
            await provider.start(this.language);
            this.isListening = true;
            this.stats.totalRequests++;

            this.eventBus.emit('started', {
                provider: this.currentProvider,
                language: this.language
            });

            console.log(`🎤 STT started with ${this.currentProvider}`);
        } catch (e) {
            console.error(`Failed to start ${this.currentProvider}:`, e);
            await this._switchToFallback();
        }
    }

    async stop() {
        if (!this.isListening) return;

        const provider = this.providers.get(this.currentProvider);
        if (provider) {
            await provider.stop();
        }

        this.isListening = false;
        this.eventBus.emit('stopped', { provider: this.currentProvider });
        console.log('🎤 STT stopped');
    }

    async _switchToFallback() {
        const currentIndex = this.fallbackChain.indexOf(this.currentProvider);

        for (let i = currentIndex + 1; i < this.fallbackChain.length; i++) {
            const nextProvider = this.fallbackChain[i];
            const provider = this.providers.get(nextProvider);

            if (provider && provider.isAvailable) {
                console.log(`🔄 Switching STT from ${this.currentProvider} to ${nextProvider}`);

                // Stop current
                const currentProviderObj = this.providers.get(this.currentProvider);
                if (currentProviderObj) {
                    await currentProviderObj.stop();
                }

                // Start new
                this.currentProvider = nextProvider;
                this.stats.providerSwitches++;

                try {
                    await provider.start(this.language);
                    this.isListening = true;

                    this.eventBus.emit('provider-switched', {
                        from: this.fallbackChain[currentIndex],
                        to: nextProvider,
                        reason: 'fallback'
                    });

                    return;
                } catch (e) {
                    console.error(`Failed to start ${nextProvider}:`, e);
                    continue;
                }
            }
        }

        // All providers failed
        this.isListening = false;
        this.eventBus.emit('all-providers-failed', {
            lastProvider: this.currentProvider,
            error: 'All STT providers failed'
        });
    }

    async _handleProviderError(providerName, error) {
        if (providerName === this.currentProvider && this.isListening) {
            console.warn(`Current provider ${providerName} error, attempting fallback...`);
            await this._switchToFallback();
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
