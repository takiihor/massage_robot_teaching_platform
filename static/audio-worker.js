/**
 * Audio Processing Web Worker
 * Handles audio processing and speech recognition in a separate thread
 */

// Import scripts for audio processing
self.importScripts('https://cdn.jsdelivr.net/npm/worklet@0.2.0/dist/worklet.bundle.js');

class AudioProcessorWorker {
    constructor() {
        this.audioContext = null;
        this.processor = null;
        this.mediaStream = null;
        this.source = null;
        this.isProcessing = false;
        
        // Audio processing parameters
        this.sampleRate = 16000;
        this.bufferSize = 4096;
        this.channels = 1;
        
        // Noise reduction parameters
        this.noiseReductionEnabled = true;
        this.noiseFloor = 0;
        this.noiseFloorSamples = [];
        this.noiseFloorWindow = 20;
        
        // AGC parameters
        this.agcEnabled = true;
        this.targetLevel = 0.7;
        this.maxGain = 3.0;
        this.gainSmoothingFactor = 0.95;
        this.currentGain = 1.0;
        
        // VAD (Voice Activity Detection)
        this.vadEnabled = true;
        this.vadThreshold = 0.01;
        this.speechFrames = 0;
        this.silenceFrames = 0;
        this.minSpeechFrames = 10;
        this.minSilenceFrames = 20;
        
        // Audio buffer for speech recognition
        this.audioBuffer = [];
        this.maxBufferLength = 5; // seconds
        this.recordingStartTime = null;
        
        // Performance monitoring
        this.stats = {
            framesProcessed: 0,
            audioLevel: 0,
            voiceActivity: false,
            processingTime: 0
        };
        
        this.setupMessageHandlers();
    }
    
    setupMessageHandlers() {
        self.onmessage = (event) => {
            const { type, data } = event.data;
            
            switch (type) {
                case 'INIT':
                    this.initialize(data);
                    break;
                    
                case 'START_PROCESSING':
                    this.startProcessing(data);
                    break;
                    
                case 'STOP_PROCESSING':
                    this.stopProcessing();
                    break;
                    
                case 'UPDATE_CONFIG':
                    this.updateConfig(data);
                    break;
                    
                case 'GET_STATS':
                    this.sendStats();
                    break;
                    
                case 'RESET_STATS':
                    this.resetStats();
                    break;
                    
                default:
                    console.warn(`[AudioProcessorWorker] Unknown message type: ${type}`);
            }
        };
    }
    
    async initialize(config = {}) {
        try {
            // Update configuration
            this.updateConfig(config);
            
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.sampleRate,
                latencyHint: 'interactive'
            });
            
            // Create audio processor
            this.processor = this.audioContext.createScriptProcessor(this.bufferSize, this.channels, this.channels);
            this.processor.onaudioprocess = (event) => this.processAudio(event);
            
            this.postMessage('INITIALIZED', {
                sampleRate: this.audioContext.sampleRate,
                bufferSize: this.bufferSize
            });
            
            console.log('[AudioProcessorWorker] Initialized successfully');
            
        } catch (error) {
            this.postMessage('ERROR', { type: 'INITIALIZATION', error: error.message });
        }
    }
    
    async startProcessing(config = {}) {
        if (this.isProcessing) {
            console.warn('[AudioProcessorWorker] Already processing');
            return;
        }
        
        try {
            // Get user media
            const constraints = {
                audio: {
                    echoCancellation: config.echoCancellation !== false,
                    noiseSuppression: config.noiseSuppression !== false,
                    autoGainControl: config.autoGainControl !== false,
                    sampleRate: this.sampleRate,
                    channelCount: this.channels
                }
            };
            
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Connect audio pipeline
            this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.source.connect(this.processor);
            this.processor.connect(this.audioContext.destination);
            
            this.isProcessing = true;
            this.recordingStartTime = Date.now();
            
            this.postMessage('PROCESSING_STARTED', {
                sampleRate: this.audioContext.sampleRate,
                constraints: constraints.audio
            });
            
            console.log('[AudioProcessorWorker] Processing started');
            
        } catch (error) {
            this.postMessage('ERROR', { type: 'START_PROCESSING', error: error.message });
        }
    }
    
    stopProcessing() {
        if (!this.isProcessing) {
            return;
        }
        
        // Disconnect audio pipeline
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        
        if (this.processor) {
            this.processor.disconnect();
        }
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        this.isProcessing = false;
        
        // Send final audio buffer if available
        if (this.audioBuffer.length > 0) {
            this.sendAudioBuffer();
        }
        
        this.postMessage('PROCESSING_STOPPED', {
            finalStats: this.stats
        });
        
        console.log('[AudioProcessorWorker] Processing stopped');
    }
    
    processAudio(event) {
        const startTime = performance.now();
        
        try {
            const inputBuffer = event.inputBuffer;
            const outputBuffer = event.outputBuffer;
            const inputData = inputBuffer.getChannelData(0);
            const outputData = outputBuffer.getChannelData(0);
            
            // Process audio frame
            const processedData = this.processAudioFrame(inputData);
            
            // Copy processed data to output
            outputData.set(processedData);
            
            // Update statistics
            this.updateStats(processedData, performance.now() - startTime);
            
            // Voice activity detection
            if (this.vadEnabled) {
                this.detectVoiceActivity(processedData);
            }
            
            // Buffer audio for speech recognition
            this.bufferAudio(processedData);
            
        } catch (error) {
            console.error('[AudioProcessorWorker] Audio processing error:', error);
        }
    }
    
    processAudioFrame(inputData) {
        const outputData = new Float32Array(inputData.length);
        
        // Calculate current audio level
        let currentLevel = 0;
        for (let i = 0; i < inputData.length; i++) {
            currentLevel += Math.abs(inputData[i]);
        }
        currentLevel /= inputData.length;
        
        // Noise reduction
        let processedData = inputData;
        if (this.noiseReductionEnabled) {
            processedData = this.applyNoiseReduction(inputData);
        }
        
        // Automatic Gain Control
        if (this.agcEnabled) {
            processedData = this.applyAGC(processedData, currentLevel);
        }
        
        // Soft clipping to prevent distortion
        for (let i = 0; i < processedData.length; i++) {
            const sample = processedData[i];
            outputData[i] = Math.tanh(sample * 0.8) / 0.8;
        }
        
        return outputData;
    }
    
    applyNoiseReduction(inputData) {
        const outputData = new Float32Array(inputData.length);
        
        // Update noise floor estimate
        let frameEnergy = 0;
        for (let i = 0; i < inputData.length; i++) {
            frameEnergy += inputData[i] * inputData[i];
        }
        frameEnergy = Math.sqrt(frameEnergy / inputData.length);
        
        this.noiseFloorSamples.push(frameEnergy);
        if (this.noiseFloorSamples.length > this.noiseFloorWindow) {
            this.noiseFloorSamples.shift();
        }
        
        // Calculate noise floor (minimum energy in window)
        this.noiseFloor = Math.min(...this.noiseFloorSamples);
        
        // Apply spectral subtraction (simplified)
        const noiseReductionFactor = Math.max(0, 1 - (this.noiseFloor / (frameEnergy + 1e-10)));
        
        for (let i = 0; i < inputData.length; i++) {
            outputData[i] = inputData[i] * noiseReductionFactor;
        }
        
        return outputData;
    }
    
    applyAGC(inputData, currentLevel) {
        const outputData = new Float32Array(inputData.length);
        
        // Update gain based on current level
        if (currentLevel > 0) {
            const targetGain = this.targetLevel / currentLevel;
            const clampedTargetGain = Math.max(0.1, Math.min(this.maxGain, targetGain));
            
            // Smooth gain changes
            this.currentGain = (this.gainSmoothingFactor * this.currentGain) + 
                              ((1 - this.gainSmoothingFactor) * clampedTargetGain);
        }
        
        // Apply gain
        for (let i = 0; i < inputData.length; i++) {
            outputData[i] = inputData[i] * this.currentGain;
        }
        
        return outputData;
    }
    
    detectVoiceActivity(audioData) {
        // Calculate frame energy
        let frameEnergy = 0;
        for (let i = 0; i < audioData.length; i++) {
            frameEnergy += audioData[i] * audioData[i];
        }
        frameEnergy = Math.sqrt(frameEnergy / audioData.length);
        
        const isSpeech = frameEnergy > this.vadThreshold;
        
        if (isSpeech) {
            this.speechFrames++;
            this.silenceFrames = 0;
        } else {
            this.silenceFrames++;
            
            // If we had speech and now have enough silence, send the buffer
            if (this.speechFrames >= this.minSpeechFrames && 
                this.silenceFrames >= this.minSilenceFrames) {
                
                this.sendAudioBuffer();
                this.resetSpeechDetection();
            }
        }
        
        this.stats.voiceActivity = isSpeech;
    }
    
    resetSpeechDetection() {
        this.speechFrames = 0;
        this.silenceFrames = 0;
        this.audioBuffer = [];
    }
    
    bufferAudio(audioData) {
        // Add audio data to buffer
        for (let i = 0; i < audioData.length; i++) {
            this.audioBuffer.push(audioData[i]);
        }
        
        // Check buffer length
        const bufferDuration = this.audioBuffer.length / this.sampleRate;
        if (bufferDuration > this.maxBufferLength) {
            // Remove oldest data
            const excessSamples = (bufferDuration - this.maxBufferLength) * this.sampleRate;
            this.audioBuffer.splice(0, Math.floor(excessSamples));
        }
    }
    
    sendAudioBuffer() {
        if (this.audioBuffer.length === 0) {
            return;
        }
        
        // Convert Float32Array to Int16Array for speech recognition
        const int16Data = new Int16Array(this.audioBuffer.length);
        for (let i = 0; i < this.audioBuffer.length; i++) {
            int16Data[i] = Math.max(-32768, Math.min(32767, this.audioBuffer[i] * 32768));
        }
        
        this.postMessage('AUDIO_BUFFER', {
            audioData: int16Data.buffer,
            sampleRate: this.sampleRate,
            duration: this.audioBuffer.length / this.sampleRate,
            timestamp: Date.now() - this.recordingStartTime
        });
        
        // Clear buffer after sending
        this.audioBuffer = [];
    }
    
    updateStats(audioData, processingTime) {
        // Calculate audio level
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += Math.abs(audioData[i]);
        }
        this.stats.audioLevel = sum / audioData.length;
        
        this.stats.framesProcessed++;
        this.stats.processingTime = processingTime;
    }
    
    updateConfig(config) {
        if (config.sampleRate) this.sampleRate = config.sampleRate;
        if (config.bufferSize) this.bufferSize = config.bufferSize;
        if (config.noiseReductionEnabled !== undefined) this.noiseReductionEnabled = config.noiseReductionEnabled;
        if (config.agcEnabled !== undefined) this.agcEnabled = config.agcEnabled;
        if (config.vadEnabled !== undefined) this.vadEnabled = config.vadEnabled;
        if (config.vadThreshold) this.vadThreshold = config.vadThreshold;
        if (config.targetLevel) this.targetLevel = config.targetLevel;
        if (config.maxGain) this.maxGain = config.maxGain;
        if (config.maxBufferLength) this.maxBufferLength = config.maxBufferLength;
    }
    
    sendStats() {
        this.postMessage('STATS', this.stats);
    }
    
    resetStats() {
        this.stats = {
            framesProcessed: 0,
            audioLevel: 0,
            voiceActivity: false,
            processingTime: 0
        };
        this.sendStats();
    }
    
    postMessage(type, data) {
        self.postMessage({ type, data });
    }
}

// Initialize the worker
const audioProcessor = new AudioProcessorWorker();