/**
 * Audio Processing Module - Enhanced Audio Quality for Voice Recognition
 * Implements noise reduction, automatic gain control, and audio enhancement
 */

class AudioProcessor {
    constructor() {
        this.audioContext = null;
        this.source = null;
        this.gainNode = null;
        this.analyser = null;
        this.noiseReducer = null;
        this.agcNode = null;
        this.processor = null;
        this.isInitialized = false;
        
        // Audio processing parameters
        this.config = {
            // Noise reduction settings
            noiseReduction: {
                enabled: true,
                noiseFloor: -60, // dB
                suppressionAmount: 20, // dB
                attackTime: 0.01, // seconds
                releaseTime: 0.1 // seconds
            },
            
            // Automatic Gain Control settings
            agc: {
                enabled: true,
                targetLevel: -20, // dB
                maxGain: 30, // dB
                attackTime: 0.01, // seconds
                releaseTime: 0.1, // seconds
                holdTime: 0.5 // seconds
            },
            
            // Audio quality settings
            quality: {
                sampleRate: 16000,
                channelCount: 1,
                bufferSize: 4096,
                fftSize: 2048
            }
        };
        
        // AGC state
        this.agcState = {
            currentGain: 1.0,
            targetGain: 1.0,
            peakLevel: -100,
            holdTimer: null,
            smoothingFactor: 0.1
        };
        
        // Noise estimation
        this.noiseEstimate = {
            level: -100,
            frames: [],
            windowSize: 10
        };
    }
    
    /**
     * Initialize audio processing chain
     */
    async initialize() {
        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create audio nodes
            this.source = this.audioContext.createMediaStreamSource();
            this.gainNode = this.audioContext.createGain();
            this.analyser = this.audioContext.createAnalyser();
            
            // Configure analyser
            this.analyser.fftSize = this.config.quality.fftSize;
            this.analyser.smoothingTimeConstant = 0.8;
            
            // Create custom audio processor for noise reduction and AGC
            await this.createAudioProcessor();
            
            // Connect audio processing chain
            this.connectAudioChain();
            
            this.isInitialized = true;
            console.log('[AudioProcessor] Initialized successfully');
            
        } catch (error) {
            console.error('[AudioProcessor] Initialization failed:', error);
            throw error;
        }
    }
    
    /**
     * Create custom audio processor using ScriptProcessorNode
     */
    async createAudioProcessor() {
        // Create script processor for custom audio processing
        this.processor = this.audioContext.createScriptProcessor(
            this.config.quality.bufferSize,
            this.config.quality.channelCount,
            this.config.quality.channelCount
        );
        
        // Set up audio processing callback
        this.processor.onaudioprocess = (event) => {
            const inputBuffer = event.inputBuffer;
            const outputBuffer = event.outputBuffer;
            
            // Get input data
            const inputData = inputBuffer.getChannelData(0);
            const outputData = outputBuffer.getChannelData(0);
            
            // Copy input to output
            outputData.set(inputData);
            
            // Apply noise reduction
            if (this.config.noiseReduction.enabled) {
                this.applyNoiseReduction(outputData);
            }
            
            // Apply AGC
            if (this.config.agc.enabled) {
                this.applyAGC(outputData);
            }
            
            // Update audio analysis
            this.updateAudioAnalysis(inputData);
        };
    }
    
    /**
     * Connect audio processing chain
     */
    connectAudioChain() {
        // Source -> Processor -> Analyser -> Gain -> Destination
        this.source.connect(this.processor);
        this.processor.connect(this.analyser);
        this.analyser.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
    }
    
    /**
     * Connect media stream to audio processor
     */
    connectStream(stream) {
        if (!this.isInitialized) {
            throw new Error('AudioProcessor not initialized');
        }
        
        this.source.mediaStream = stream;
        console.log('[AudioProcessor] Connected media stream');
    }
    
    /**
     * Apply noise reduction to audio data
     */
    applyNoiseReduction(audioData) {
        const noiseFloor = Math.pow(10, this.config.noiseReduction.noiseFloor / 20);
        const suppressionFactor = Math.pow(10, -this.config.noiseReduction.suppressionAmount / 20);
        
        for (let i = 0; i < audioData.length; i++) {
            const sample = audioData[i];
            const absSample = Math.abs(sample);
            
            // Update noise estimate
            this.updateNoiseEstimate(absSample);
            
            // Apply noise gate
            if (absSample < this.noiseEstimate.level * 1.5) {
                audioData[i] *= suppressionFactor;
            }
        }
    }
    
    /**
     * Update noise estimation
     */
    updateNoiseEstimate(sampleLevel) {
        this.noiseEstimate.frames.push(sampleLevel);
        
        // Keep only recent frames
        if (this.noiseEstimate.frames.length > this.noiseEstimate.windowSize) {
            this.noiseEstimate.frames.shift();
        }
        
        // Calculate noise floor as average of minimum values
        const minValues = this.noiseEstimate.frames.slice().sort((a, b) => a - b);
        const noiseFrames = Math.floor(this.noiseEstimate.windowSize * 0.3);
        const noiseSum = minValues.slice(0, noiseFrames).reduce((a, b) => a + b, 0);
        this.noiseEstimate.level = noiseSum / noiseFrames;
    }
    
    /**
     * Apply Automatic Gain Control
     */
    applyAGC(audioData) {
        // Find peak level
        let peak = 0;
        for (let i = 0; i < audioData.length; i++) {
            const absSample = Math.abs(audioData[i]);
            if (absSample > peak) {
                peak = absSample;
            }
        }
        
        // Convert to dB
        const peakDb = peak > 0 ? 20 * Math.log10(peak) : -100;
        this.agcState.peakLevel = peakDb;
        
        // Calculate target gain
        const targetLevelDb = this.config.agc.targetLevel;
        const gainReductionNeeded = targetLevelDb - peakDb;
        const maxGainDb = this.config.agc.maxGain;
        
        let targetGainDb = Math.min(gainReductionNeeded, maxGainDb);
        targetGainDb = Math.max(targetGainDb, -maxGainDb);
        
        this.agcState.targetGain = Math.pow(10, targetGainDb / 20);
        
        // Smooth gain changes
        const gainDiff = this.agcState.targetGain - this.agcState.currentGain;
        this.agcState.currentGain += gainDiff * this.config.agc.smoothingFactor;
        
        // Apply gain
        for (let i = 0; i < audioData.length; i++) {
            audioData[i] *= this.agcState.currentGain;
            
            // Soft clipping to prevent distortion
            if (audioData[i] > 0.95) {
                audioData[i] = 0.95 + (audioData[i] - 0.95) * 0.1;
            } else if (audioData[i] < -0.95) {
                audioData[i] = -0.95 + (audioData[i] + 0.95) * 0.1;
            }
        }
    }
    
    /**
     * Update audio analysis
     */
    updateAudioAnalysis(audioData) {
        // Calculate RMS level
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
        
        // Store for monitoring
        this.currentAudioLevel = rmsDb;
    }
    
    /**
     * Get current audio level in dB
     */
    getAudioLevel() {
        return this.currentAudioLevel || -100;
    }
    
    /**
     * Get noise estimate in dB
     */
    getNoiseLevel() {
        const noiseLevel = this.noiseEstimate.level;
        return noiseLevel > 0 ? 20 * Math.log10(noiseLevel) : -100;
    }
    
    /**
     * Get current gain
     */
    getCurrentGain() {
        return this.agcState.currentGain;
    }
    
    /**
     * Enable/disable noise reduction
     */
    setNoiseReduction(enabled) {
        this.config.noiseReduction.enabled = enabled;
        console.log(`[AudioProcessor] Noise reduction ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    /**
     * Enable/disable AGC
     */
    setAGC(enabled) {
        this.config.agc.enabled = enabled;
        console.log(`[AudioProcessor] AGC ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    /**
     * Update AGC parameters
     */
    updateAGCParameters(params) {
        Object.assign(this.config.agc, params);
        console.log('[AudioProcessor] AGC parameters updated:', params);
    }
    
    /**
     * Update noise reduction parameters
     */
    updateNoiseReductionParameters(params) {
        Object.assign(this.config.noiseReduction, params);
        console.log('[AudioProcessor] Noise reduction parameters updated:', params);
    }
    
    /**
     * Get audio statistics
     */
    getAudioStats() {
        return {
            audioLevel: this.getAudioLevel(),
            noiseLevel: this.getNoiseLevel(),
            currentGain: this.getCurrentGain(),
            targetGain: this.agcState.targetGain,
            signalToNoiseRatio: this.getAudioLevel() - this.getNoiseLevel(),
            noiseReductionEnabled: this.config.noiseReduction.enabled,
            agcEnabled: this.config.agc.enabled
        };
    }
    
    /**
     * Disconnect and cleanup
     */
    disconnect() {
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        
        if (this.analyser) {
            this.analyser.disconnect();
            this.analyser = null;
        }
        
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = null;
        }
        
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        this.isInitialized = false;
        console.log('[AudioProcessor] Disconnected');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AudioProcessor = AudioProcessor;
}