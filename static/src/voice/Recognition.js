    // Browser Speech Recognition shared state
    let browserRecognition = null;
    let _asrIsReady = false;
    let lastRecognitionActivity = Date.now();
    let wakeWordDetector = null;

    function safeDefineWindowBridge(prop, getter, setter) {
        const desc = Object.getOwnPropertyDescriptor(window, prop);
        if (desc && desc.configurable === false) return;
        try {
            Object.defineProperty(window, prop, {
                configurable: true,
                get: getter,
                set: setter
            });
        } catch (e) {
            // Ignore duplicate/locked property definitions to avoid boot failure.
        }
    }

    safeDefineWindowBridge('browserRecognition', () => browserRecognition, (val) => { browserRecognition = val; });
    safeDefineWindowBridge('_asrIsReady', () => _asrIsReady, (val) => { _asrIsReady = val; });
    safeDefineWindowBridge('lastRecognitionActivity', () => lastRecognitionActivity, (val) => { lastRecognitionActivity = val; });
    safeDefineWindowBridge('wakeWordDetector', () => wakeWordDetector, (val) => { wakeWordDetector = val; });

/*
 * Module: Recognition
 * Purpose: Speech recognition integration and wake word detection helpers.
 * Exports: normalizeAsrForWakeWord, initBrowserSpeechRecognition, initSetupSpeechRecognition,
 *          startSetupSpeechRecognition, stopSetupSpeechRecognition, WakeWordDetector,
 *          getWakeWord, updateWakeWord, getBrowserRecognition, getAsrReady,
 *          getLastRecognitionActivity, getWakeWordDetector
 * Module bridge globals: window.initBrowserSpeechRecognition, window.normalizeAsrForWakeWord,
 *                 window.WakeWordDetector, window.getWakeWord, window.updateWakeWord,
 *                 window.browserRecognition, window._asrIsReady,
 *                 window.lastRecognitionActivity, window.wakeWordDetector (via module-bridge)
 */

export function getBrowserRecognition() {
    return browserRecognition;
}

export function getAsrReady() {
    return _asrIsReady;
}

export function getLastRecognitionActivity() {
    return lastRecognitionActivity;
}

export function getWakeWordDetector() {
    return wakeWordDetector;
}

// ===== ASR Auto-correct for Wake Word / Setup Trigger =====
    // Common Cantonese ASR confusions for "按摩設定" and related phrases
    export function normalizeAsrForWakeWord(input) {
        if (!input) return input;
        let t = input;

        // Common ASR confusions for "按摩" (on3 mo1)
        t = t.replace(/安摩/g, '按摩');
        t = t.replace(/暗摩/g, '按摩');
        t = t.replace(/按磨/g, '按摩');
        t = t.replace(/岸摩/g, '按摩');
        t = t.replace(/案摩/g, '按摩');
        t = t.replace(/按魔/g, '按摩');
        t = t.replace(/按末/g, '按摩');

        // Common ASR confusions for "設定" (cit3 ding6)
        t = t.replace(/設頂/g, '設定');
        t = t.replace(/設丁/g, '設定');
        t = t.replace(/設停/g, '設定');
        t = t.replace(/社定/g, '設定');
        t = t.replace(/涉定/g, '設定');
        t = t.replace(/舌定/g, '設定');
        t = t.replace(/設訂/g, '設定');
        t = t.replace(/設釘/g, '設定');
        t = t.replace(/設置/g, '設定');
        t = t.replace(/設制/g, '設定');

        // Simplified Chinese variants
        t = t.replace(/设定/g, '設定');
        t = t.replace(/设顶/g, '設定');
        t = t.replace(/设置/g, '設定');

        // Common ASR confusions for "開始" (hoi1 ci2)
        t = t.replace(/開時/g, '開始');
        t = t.replace(/開市/g, '開始');
        t = t.replace(/開事/g, '開始');

        // Common ASR confusions for "模式" (mou4 sik1)
        t = t.replace(/模食/g, '模式');
        t = t.replace(/磨式/g, '模式');

        // Remove extra spaces/punctuation that may interfere with matching
        t = t.replace(/[，,。.!！？?；;：:、【】()（）「」『』""\"']/g, ' ');
        t = t.replace(/\s+/g, ' ');

        // English filler cleanup
        t = t.replace(/\b(please|can\s+you|could\s+you|would\s+you|ok|okay|hey|um|uh)\b/gi, ' ');
        t = t.replace(/\s+/g, ' ').trim();

        return t;
    }

    // BCP-47 speech-recognition locale for the stored UI/voice language.
    // 'en' (or anything starting with 'en') -> 'en-US', everything else -> 'zh-HK'
    // (Cantonese default). Matches the mapping in app.js getAsrLanguage().
    export function getASRLanguage(lang) {
        const v = String(lang || '').trim().toLowerCase();
        if (v.startsWith('en')) return 'en-US';
        return 'zh-HK';
    }

    let setupRecognition = null;

    function _createSetupRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.error("Speech Recognition API is not supported in this browser.");
            return null;
        }
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;
        recognition.lang = getASRLanguage(localStorage.getItem('voiceLanguage') || localStorage.getItem('language') || 'zh');
        return recognition;
    }

    function _shouldRouteSetupInterim(transcript) {
        const text = (transcript || '').trim();
        if (!text) return false;

        const step = (typeof massageSetupState !== 'undefined' && massageSetupState)
            ? massageSetupState.step
            : null;
        const lower = text.toLowerCase();

        if (step === 1 || step === 'simple') {
            return /模式[1-4一二三四]/.test(text)
                || /^(向上推|波浪推|螺旋按|揉捏)$/.test(text)
                || /^(mode\s?[1-4]|mode\s?one|mode\s?two|mode\s?three|mode\s?four)$/.test(lower);
        }
        if (step === 2) {
            return /^(小|中|大)$/.test(text)
                || /(力度|力道)(小|中|大)/.test(text)
                || /^(light|medium|strong)$/.test(lower);
        }
        if (step === 3) {
            return /(\d+\s*(分鐘|min|minute))/.test(lower)
                || /^(一|三|五|十|十五|二十|三十)分鐘$/.test(text)
                || /^(1|3|5|10|15|20|30)$/.test(lower);
        }
        if (step === 4 || step === 'simpleConfirm') {
            return /^(確認|開始|好|係)$/.test(text)
                || /^(confirm|start|ok|okay|yes)$/.test(lower);
        }
        return false;
    }

    export function initSetupSpeechRecognition() {
        if (setupRecognition) return;
        setupRecognition = _createSetupRecognition();
        if (!setupRecognition) return;

        let finalTranscript = '';
        let lastProcessedCommand = '';
        let lastProcessedTime = 0;

        setupRecognition.onstart = () => {
            _asrLastOnStartAt = Date.now();
            _asrIsReady = true;
            lastRecognitionActivity = Date.now();
            window.__setupAsrActive = true;
            isRecording = true;
            _setAsrUiState('listening', 'READY');
            console.log('[SetupASR] onstart fired');
            asrTrace('setup_recognition.start', { isRecording, isAutoListening, isAlwaysListeningActive, isFollowUpListening });
        };

        setupRecognition.onend = () => {
            _asrIsReady = false;
            window.__setupAsrActive = false;
            isRecording = false;
            _setAsrUiState('inactive', '-');
            console.log('[SetupASR] onend fired');
            asrTrace('setup_recognition.end', { isRecording, isAutoListening, isAlwaysListeningActive, isFollowUpListening });

            if (isMassageSetupMode && !window.__setupAsrStopping && !window.__setupAsrRestarted) {
                window.__setupAsrRestarted = true;
                setTimeout(() => {
                    if (isMassageSetupMode && typeof startSetupSpeechRecognition === 'function') {
                        startSetupSpeechRecognition();
                    }
                }, 900);
            }
        };

        setupRecognition.onerror = (event) => {
            if (event.error === 'no-speech' || event.error === 'aborted') {
                return;
            }
            console.error('Setup STT error:', event.error);
            console.log('[SetupASR] onerror fired:', event.error);
        };

        setupRecognition.onresult = (event) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
                if (typeof updateAsrDebugDisplay === 'function') {
                    updateAsrDebugDisplay(transcript);
                }
            }

            const latest = event.results[event.results.length - 1];
            const latestTranscript = (latest?.[0]?.transcript || '').trim();
            if (latest?.isFinal && latestTranscript) {
                const now = Date.now();
                if (finalTranscript === lastProcessedCommand && (now - lastProcessedTime) < 1000) {
                    return;
                }
                lastProcessedCommand = finalTranscript;
                lastProcessedTime = now;
                const transcriptText = finalTranscript.trim();
                const inSetupMode = !!isMassageSetupMode
                    || (typeof stateMachine !== 'undefined' && stateMachine?.isInSetup?.());
                if (transcriptText && inSetupMode && typeof processMassageSetupInput === 'function') {
                    console.log(`[SetupDirect] Routing "${transcriptText}" directly to processMassageSetupInput`);
                    processMassageSetupInput(transcriptText);
                }
                finalTranscript = '';
                return;
            }

            // Fallback: if we never see a final result, route a stable interim
            if (!latest?.isFinal && latestTranscript && isMassageSetupMode) {
                const now = Date.now();
                if (now - lastProcessedTime >= 900 && latestTranscript !== lastProcessedCommand) {
                    if (_shouldRouteSetupInterim(latestTranscript)) {
                        lastProcessedCommand = latestTranscript;
                        lastProcessedTime = now;
                        if (typeof processMassageSetupInput === 'function') {
                            console.log(`[SetupDirect] Routing interim "${latestTranscript}" directly to processMassageSetupInput`);
                            processMassageSetupInput(latestTranscript);
                        }
                    }
                }
            }

            if (interimTranscript && typeof updateAsrDebugDisplay === 'function') {
                updateAsrDebugDisplay(interimTranscript);
            }
        };
    }

    export function startSetupSpeechRecognition() {
        initSetupSpeechRecognition();
        console.log('[SetupASR] startSetupSpeechRecognition()', {
            promptPlaying: !!window.__setupPromptPlaying,
            acceptAfter: window.__setupAsrAcceptAfter || 0,
            asrActive: !!window.__setupAsrActive,
            asrReady: !!_asrIsReady
        });
        if (!setupRecognition) return;
        if (window.__setupAsrActive && _asrIsReady) return;
        if (window.__setupPromptPlaying && Date.now() < (window.__setupAsrAcceptAfter || 0)) {
            console.log('[SetupASR] start blocked by prompt timing');
            return;
        }

        // Stop browserRecognition to avoid Web Speech API conflict (only one can be active)
        if (browserRecognition && (isRecording || _asrIsReady)) {
            try {
                browserRecognition.stop();
            } catch (e) { /* ignore */ }
        }

        window.__setupAsrStopping = false;
        window.__setupAsrRestarted = false;
        try {
            console.log('[SetupASR] Calling setupRecognition.start()');
            setupRecognition.start();
        } catch (error) {
            if (error?.message && error.message.includes('already started')) {
                return;
            }
            window.__setupAsrActive = false;
            _asrIsReady = false;
            isRecording = false;
            console.error('Setup recognition start failed:', error);
            console.log('[SetupASR] start failed:', error?.message || error);
        }
    }

    export function stopSetupSpeechRecognition() {
        if (!setupRecognition) return;
        window.__setupAsrStopping = true;
        try {
            setupRecognition.stop();
        } catch (e) { /* ignore */ }
        window.__setupAsrActive = false;
        _asrIsReady = false;
        isRecording = false;
        _setAsrUiState('inactive', '-');
    }

    export function initBrowserSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.error("Speech Recognition API is not supported in this browser.");
            return;
        }

        browserRecognition = new SpeechRecognition();
        browserRecognition.continuous = true;
        browserRecognition.interimResults = true;
        browserRecognition.maxAlternatives = 3;
        // Set ASR language based on user preference (defaults to Cantonese)
        browserRecognition.lang = getASRLanguage(localStorage.getItem('voiceLanguage') || localStorage.getItem('language') || 'zh');

        // CORRECT: Declare transcript variables here, outside onresult
        let finalTranscript = '';
        let confidenceTimeout = null;
        let fallbackSubmitTimeout = null; // Fallback submit when confidence is low
        let lastProcessedCommand = ''; // Track last command to prevent duplicates
        let lastProcessedTime = 0;

        // Network error retry management with exponential backoff
        let networkErrorRetries = 0;

        browserRecognition.onstart = () => {
            _asrLastOnStartAt = Date.now();
            _asrIsReady = true;
            lastRecognitionActivity = Date.now();
            // The isRecording flag is set by the calling function (startRecording or startAutoVoiceListening)
            const voiceButton = document.getElementById('voiceButton');
            if (!isAutoListening) { // Only show recording UI for manual recording
                if (voiceButton) voiceButton.classList.add('recording');
                updateVoiceHint('錄音中...', '#ff3838');
                setFoxState('listening');
            }
            _setAsrUiState('listening', 'READY');
            // Reset network error counter on successful start
            networkErrorRetries = 0;
            asrTrace('recognition.start', { isRecording, isAutoListening, isAlwaysListeningActive, isFollowUpListening });
        };

        browserRecognition.onend = () => {
            if (window.DEBUG_LOGS) {
                console.log('🛑 Browser recognition ended');
            }
            asrTrace('recognition.end', { isRecording, isAutoListening, isAlwaysListeningActive, isFollowUpListening });
            _asrIsReady = false;
            _setAsrUiState('inactive', '-');

            // ✨ Handle end of Follow-up Mode
            if (isFollowUpListening && followUpTimeRemaining > 0) {
                // Recognition ended but timer not expired - try to restart
                if (window.DEBUG_LOGS) {
                    console.log("[FollowUp] Recognition ended but timer not expired, restarting...");
                }
                try {
                    setTimeout(() => {
                        if (isFollowUpListening && followUpTimeRemaining > 0) {
                            browserRecognition.start();
                            if (window.DEBUG_LOGS) {
                                console.log("[FollowUp] Recognition restarted");
                            }
                        }
                    }, 100);
                } catch (e) {
                    if (window.DEBUG_LOGS) {
                        console.log("[FollowUp] Could not restart recognition:", e.message);
                    }
                    stopFollowUpListening(true);
                }
                return; // End here, don't process other onend logic
            } else if (isFollowUpListening && followUpTimeRemaining <= 0) {
                // Timer expired - stop follow-up mode
                if (window.DEBUG_LOGS) {
                    console.log("🎤 Follow-up timer expired. Returning to wake word mode.");
                }
                stopFollowUpListening(true);
                return; // End here, don't process other onend logic
            }

            if (isIntentionalStop) {
                isIntentionalStop = false; // Reset flag
                const wasAuto = isAutoListening;
                const wasAlways = isAlwaysListeningActive;
                // 🔧 FIX: Now we can safely set isAutoListening to false
                // because recognition has actually stopped
                if (isAutoListening) {
                    isAutoListening = false;
                    if (window.DEBUG_LOGS) {
                        console.log("🎤 Recognition stopped intentionally for TTS. Flag reset. Will be resumed by TTS handler.");
                    }
                }
                if (isAlwaysListeningActive) {
                    isAlwaysListeningActive = false;
                    if (window.DEBUG_LOGS) {
                        console.log("🎤 Always-listening stopped intentionally for TTS. Will be resumed by TTS handler.");
                    }
                }
                // Only short-circuit for modes that will self-restart; for manual recordings fall through to submit
                if (wasAuto || wasAlways) {
                    return; // Do not proceed with any restart logic here
                }
            }

            // 🛠️ Setup mode: auto-restart if recognition stops after idle
            if (isMassageSetupMode && !currentMassageSession) {
                // Ensure flags are cleared so restart won't be blocked
                if (isRecording) isRecording = false;
                if (audioLevelDetector) {
                    audioLevelDetector.stop();
                    audioLevelDetector = null;
                }
                const voiceButton = document.getElementById('voiceButton');
                if (voiceButton) voiceButton.classList.remove('recording');
                updateVoiceHint('按住說話');
                setFoxState(null);

                const acceptAfter = window.__setupAsrAcceptAfter || 0;
                if (Date.now() >= acceptAfter + 200) {
                    if (window.DEBUG_LOGS) {
                        if (window.DEBUG_LOGS) {
                        console.log('[ASR] Setup recognition ended; restarting');
                    }
                    }
                    setTimeout(() => {
                        if (isMassageSetupMode && !currentMassageSession) {
                            startRecordingWithRetry({ reason: 'setup_keepalive' });
                        }
                    }, 200);
                }
                return;
            }

            if (!isAutoListening && !isAlwaysListeningActive) {
                if (!isRecording && suppressManualSubmitUntil && Date.now() < suppressManualSubmitUntil) {
                    const userInput = document.getElementById('userInput');
                    if (userInput) userInput.value = '';
                    return;
                }
                // Normal recording ended
                isRecording = false;
                if (audioLevelDetector) {
                    audioLevelDetector.stop();
                    audioLevelDetector = null;
                }
                const voiceButton = document.getElementById('voiceButton');
                if (voiceButton) voiceButton.classList.remove('recording');
                updateVoiceHint('按住說話');
                setFoxState(null);

                const userInput = document.getElementById('userInput');
                if (userInput && userInput.value.trim()) {
                    sendMessage();
                }
            } else if (isMassageSessionActive && isAutoListening) {
                // 🔧 FIX: If continuous listening stops UNEXPECTEDLY during a massage, restart it using safe restart
                if (window.DEBUG_LOGS) {
                    if (window.DEBUG_LOGS) {
                    console.log("🔄 Continuous recognition ended unexpectedly, restarting...");
                }
                }
                // Reset flag so safe restart can work
                isAutoListening = false;
                // Use safe restart to prevent race conditions
                safeRestartMassageListening();
            } else if (isAlwaysListeningMode && isAlwaysListeningActive) {
                // 🎤 Always-listening mode: auto-restart when recognition ends unexpectedly
                console.log("🔄 [AlwaysListen] Recognition ended unexpectedly, restarting...");
                isAlwaysListeningActive = false;
                // Restart after short delay to avoid rapid restart loops (only if permission not denied)
                setTimeout(() => {
                    if (isAlwaysListeningMode && !isTTSPlaying && !isMassageSessionActive && !alwaysListeningPermissionDenied) {
                        startAlwaysListening();
                    }
                }, 300);
            }

            // Reset for the next recognition
            finalTranscript = '';

            // Ensure wake word or always-listening restarts if enabled
            setTimeout(() => {
                const wakeWordToggle = document.getElementById('wakeWordToggle');
                const currentMode = stateMachine?.getMode?.() || SystemMode?.CHAT || 'CHAT';
                if (!isAutoListening && !isRecording && !isMassageSessionActive && !isAlwaysListeningActive) {
                    if (isAlwaysListeningMode && !isTTSPlaying && !alwaysListeningPermissionDenied) {
                        // Always-listening mode is enabled but not active - restart it
                        console.log("🔄 [AlwaysListen] Restarting after recognition ended...");
                        startAlwaysListening();
                    } else if (!window.__setupWakeWordSuppressed && wakeWordDetector && wakeWordToggle?.checked && (currentMode === 'CHAT' || currentMode === SystemMode?.CHAT)) {
                        console.log("🔄 Restarting wake word detection after recognition ended...");
                        if (!wakeWordDetector.isListening) {
                            wakeWordDetector.start();
                        }
                    }
                }
            }, 800); // Delay to prevent immediate restart conflicts
        };

        browserRecognition.onerror = (event) => {
            // Don't log "no-speech" as error - it's normal when user doesn't speak
            if (event.error === 'no-speech') {
                if (window.DEBUG_LOGS) {
                    console.log('🔇 No speech detected (normal)');
                }
            } else if (event.error === 'aborted') {
                console.log('⏸️ Recognition aborted (normal)');
            } else {
                console.error('❌ Speech recognition error:', event.error);
            }
            asrTrace('recognition.error', {
                error: event.error,
                message: event.message,
                isRecording,
                isAutoListening,
                isAlwaysListeningActive,
                isFollowUpListening
            });

            // Setup mode: treat no-speech/aborted as normal but still process finalTranscript
            if (isMassageSetupMode && !currentMassageSession &&
                (event.error === 'no-speech' || event.error === 'aborted')) {
                // 🔧 FIX: Even if aborted, process finalTranscript if it exists
                if (finalTranscript && finalTranscript.trim().length >= 1) {
                    console.log(`[SetupAborted] Processing finalTranscript despite abort: "${finalTranscript.trim()}"`);
                    if (typeof processMassageSetupInput === 'function') {
                        processMassageSetupInput(finalTranscript.trim());
                    }
                    finalTranscript = '';
                }
                return;
            }

            // 🔧 FIX: Network error recovery with exponential backoff
            if (isMassageSessionActive && event.error === 'network') {
                networkErrorRetries++;
                console.log(`🔄 Network error during massage (attempt ${networkErrorRetries}/${SPEECH_CONFIG.MAX_NETWORK_RETRIES})`);

                if (networkErrorRetries <= SPEECH_CONFIG.MAX_NETWORK_RETRIES) {
                    // Exponential backoff: 250ms, 500ms, 1000ms
                    const delay = SPEECH_CONFIG.BASE_RETRY_DELAY * Math.pow(2, networkErrorRetries - 1);
                    console.log(`🔄 Retrying in ${delay}ms...`);
                    isAutoListening = false;
                    setTimeout(() => {
                        if (isMassageSessionActive) {
                            safeRestartMassageListening();
                        }
                    }, delay);
                } else {
                    console.error('❌ Network error: max retries exceeded');
                    addSystemMessage('語音識別連接失敗，請檢查網絡連接', 'error');
                    networkErrorRetries = 0; // Reset for next attempt
                }
                return; // Don't clean up UI during massage
            }

            // 🔧 CRITICAL FIX: Don't reset isAutoListening during massage for harmless errors
            // Let the onend handler manage auto-restart for massage sessions
            if (isMassageSessionActive && (event.error === 'no-speech' || event.error === 'aborted')) {
                console.log('🎤 Harmless error during massage, letting onend handler manage restart');
                return; // Exit early, don't reset flags or clean up UI
            }

            // 🎤 Always-listening mode: handle harmless errors gracefully
            if (isAlwaysListeningMode && (event.error === 'no-speech' || event.error === 'aborted')) {
                console.log('[AlwaysListen] Harmless error, letting onend handler manage restart');
                return; // Exit early, let onend handler restart
            }

            // 🔧 FIX: Handle not-allowed (permission denied) error specifically
            if (event.error === 'not-allowed') {
                console.error('❌ Microphone permission denied');

                // Handle for massage session
                if (isMassageSessionActive) {
                    addSystemMessage('麥克風權限被拒絕，請在瀏覽器設定中允許麥克風存取', 'error');
                    isAutoListening = false;
                    // Show a button to help user grant permission
                    showMicrophonePermissionHelp();
                    return;
                }

                // Handle for always-listening mode
                if (isAlwaysListeningMode) {
                    alwaysListeningPermissionDenied = true;
                    isAlwaysListeningActive = false;
                    stopAlwaysListeningHealthCheck();
                    updateAlwaysListeningIndicator('error', '需要麥克風權限', '請點擊「重啟語音檢測」');
                    return; // Don't retry - requires user gesture
                }
            }

            // For serious errors or non-listening modes, do normal cleanup
            _asrIsReady = false;
            _setAsrUiState('error', `ERR:${event.error || 'unknown'}`);
            isRecording = false;
            isAutoListening = false;
            if (isAlwaysListeningActive) {
                isAlwaysListeningActive = false;
                alwaysListeningRetryCount++;

                // Try to restart always-listening after a delay (with retry limit)
                if (isAlwaysListeningMode && !isTTSPlaying && !isMassageSessionActive &&
                    !alwaysListeningPermissionDenied && alwaysListeningRetryCount < ALWAYS_LISTENING_MAX_RETRIES) {
                    console.log(`[AlwaysListen] Error occurred, restarting after delay... (attempt ${alwaysListeningRetryCount}/${ALWAYS_LISTENING_MAX_RETRIES})`);
                    updateAlwaysListeningIndicator('error', '發生錯誤', '重新啟動中...');
                    setTimeout(() => startAlwaysListening(), 2000);
                } else if (alwaysListeningRetryCount >= ALWAYS_LISTENING_MAX_RETRIES) {
                    console.error('[AlwaysListen] Max retries reached, stopping auto-restart');
                    updateAlwaysListeningIndicator('error', '無法啟動', '請點擊「重啟語音檢測」');
                }
            }
            if (audioLevelDetector) {
                audioLevelDetector.stop();
                audioLevelDetector = null;
            }
            const voiceButton = document.getElementById('voiceButton');
            if (voiceButton) voiceButton.classList.remove('recording', 'auto-listening');
            updateVoiceHint('按住說話');
            setFoxState(null);
            if (!isAlwaysListeningMode) {
                hideListeningIndicator();
            }
        };

        browserRecognition.onresult = (event) => {
            // 🔧 FIX: Track recognition activity for health check
            lastRecognitionActivity = Date.now();

            // Highest-priority safety path: trigger immediate stop on interim/final stop phrase.
            try {
                const latestStopResult = event.results[event.results.length - 1];
                const rawStopTranscript = (latestStopResult?.[0]?.transcript || '').trim();
                const normalizedStopTranscript = typeof normalizeAsrForControl === 'function'
                    ? normalizeAsrForControl(rawStopTranscript)
                    : rawStopTranscript;
                const stopDetected = typeof window.isImmediateStopPhrase === 'function'
                    ? window.isImmediateStopPhrase(normalizedStopTranscript)
                    : /\b(stop|pause|hold|end|endsession|end session)\b|停止|暫停|結束/.test(String(normalizedStopTranscript || '').toLowerCase());

                if ((window.currentMassageSession || window.isMassageSessionActive) && stopDetected) {
                    console.log('🛑 [ASR] Immediate stop phrase detected:', normalizedStopTranscript);
                    Promise.resolve(window.triggerImmediateVoiceStop?.('asr_result', normalizedStopTranscript)).catch((e) => {
                        console.error('[ASR] Immediate stop failed:', e);
                    });
                    finalTranscript = '';
                    return;
                }
            } catch (e) { /* ignore */ }

            // ✨ Follow-up mode: extend timer on interim, process on final
            if (isFollowUpListening) {
                const latestResult = event.results[event.results.length - 1];
                const transcript = latestResult[0].transcript.trim();

                if (!latestResult.isFinal) {
                    // Interim result - user is speaking, extend timer
                    extendFollowUpTimer();
                    // Update indicator to show what we're hearing
                    const indicator = document.getElementById('autoListeningIndicator');
                    if (indicator) {
                        indicator.querySelector('.listening-text').textContent =
                            `聽到: ${transcript.substring(0, 20)}...`;
                    }
                } else if (transcript.length >= 2) {
                    // Final result with actual content - stop follow-up and submit to chat
                    console.log(`🎤 Follow-up speech final: "${transcript}"`);
                    stopFollowUpListening(false); // Don't restart wake word - we're processing

                    // Directly submit to chat (don't rely on stopRecording which checks isRecording)
                    const userInput = document.getElementById('userInput');
                    if (userInput) {
                        userInput.value = transcript;
                    }
                    finalTranscript = ''; // Reset

                    // Submit the message
                    sendMessage();

                    // 🔧 FIX: Clear userInput immediately to prevent onend handler from calling sendMessage again
                    if (userInput) {
                        userInput.value = '';
                    }
                    return; // Don't fall through to other handlers
                }
            }

            let interimTranscript = '';

            // Cancel any pending fallback submit while we're still receiving audio
            if (fallbackSubmitTimeout) {
                clearTimeout(fallbackSubmitTimeout);
                fallbackSubmitTimeout = null;
            }

            // Use the parent-scoped finalTranscript to accumulate results
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
                // Update ASR debug display during voice setup
                if (typeof updateAsrDebugDisplay === 'function') {
                    updateAsrDebugDisplay(transcript);
                }
            }

            // ASR tracing (throttled): log final results + occasional interim
            try {
                const latest = event.results[event.results.length - 1];
                const latestTranscript = (latest?.[0]?.transcript || '').trim();
                const isFinal = !!latest?.isFinal;
                const confidence = latest?.[0]?.confidence;
                const now = Date.now();
                if (isFinal && latestTranscript) {
                    asrTrace('result.final', { transcript: latestTranscript, confidence });
                } else if (latestTranscript && now - (window.__asrLastInterimLogAt || 0) > 800) {
                    window.__asrLastInterimLogAt = now;
                    asrTrace('result.interim', { transcript: latestTranscript, confidence });
                }
            } catch (e) {
                asrTrace('result.trace_exception', { message: e?.message || String(e) });
            }

            // 🎤 If in auto-listening mode, process immediately
            if (isAutoListening && currentMassageSession) {
                // For faster response during massage: process high-confidence interim or final results
                const latestResult = event.results[event.results.length - 1];
                const rawTranscript = latestResult[0].transcript.trim();
                const transcript = typeof normalizeAsrForControl === 'function'
                    ? normalizeAsrForControl(rawTranscript)
                    : rawTranscript;
                const confidence = latestResult[0].confidence || 0.0;

                // Process the command in massage session
                currentMassageSession.processVoiceResponse(transcript, confidence);
                finalTranscript = '';
                return;
            }

            // Check if confidence is high enough to auto-submit
            if (finalTranscript && finalTranscript.trim().length >= 1) {
                const now = Date.now();

                // Prevent duplicate commands
                if (finalTranscript === lastProcessedCommand && (now - lastProcessedTime) < 1000) {
                    console.log('⚠️ Duplicate command detected, skipping');
                    return;
                }

                lastProcessedCommand = finalTranscript;
                lastProcessedTime = now;

                // Extract the latest confidence score
                const latestResult = event.results[event.results.length - 1];
                const confidence = latestResult[0].confidence || 0.0;
                const transcriptText = finalTranscript.trim();

                // 🔧 FIX: Direct route for massage setup mode - bypass sendMessage
                if (isMassageSetupMode && typeof processMassageSetupInput === 'function') {
                    console.log(`[SetupDirect] Routing "${transcriptText}" directly to processMassageSetupInput`);
                    processMassageSetupInput(transcriptText);
                    finalTranscript = '';
                    return;
                }

                // For non-setup modes, proceed with normal submission logic
                // If confidence is high, submit immediately
                if (confidence >= 0.4) {
                    if (confidenceTimeout) clearTimeout(confidenceTimeout);
                    confidenceTimeout = null;

                    // Update input and submit
                    const userInput = document.getElementById('userInput');
                    if (userInput) {
                        userInput.value = transcriptText;
                    }

                    // Submit the message
                    if (isAutoListening || isAlwaysListeningActive || isFollowUpListening) {
                        // Directly process in streaming mode
                        handleVoiceInput(transcriptText, confidence);
                    } else {
                        sendMessage();
                    }
                    finalTranscript = '';
                } else {
                    // Low confidence: delay submission and wait for more input
                    if (confidenceTimeout) clearTimeout(confidenceTimeout);
                    confidenceTimeout = setTimeout(() => {
                        const userInput = document.getElementById('userInput');
                        if (userInput) {
                            userInput.value = transcriptText;
                        }
                        sendMessage();
                        finalTranscript = '';
                    }, 700); // 700ms delay for low confidence
                }
            }
        };
    }

    export class WakeWordDetector {
        constructor() {
            this.recognition = null;
            this.isListening = false;
            this.wakeWord = getWakeWord(localStorage.getItem('voiceLanguage') || localStorage.getItem('language') || 'zh');
            this.wakeWordDetected = false;
            this.lastActivityTime = Date.now();
            this.healthCheckInterval = null;
            this.healthCheckIntervalMs = 12000; // 12 seconds
            this.inactivityTimeoutMs = 25000; // 25 seconds
            this.errorBackoff = 2000; // start with 2 seconds
            this.maxBackoff = 20000; // max backoff 20 seconds
            this.restartAttempts = 0;
            this.maxRestartAttempts = 3;
            this._pendingStartTimer = null;
            this._isStarting = false;
            this._startCooldownMs = 1200;
            this._lastStartAt = 0;
            this._lastError = null;
        }

        init() {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                console.warn('⚠️ Wake word: SpeechRecognition API not supported');
                return false;
            }

            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.maxAlternatives = 1;
            this.recognition.lang = getASRLanguage(localStorage.getItem('voiceLanguage') || localStorage.getItem('language') || 'zh');

            this.recognition.onstart = () => {
                this._lastError = null;
                if (window.DEBUG_LOGS) {
                    if (window.DEBUG_LOGS) {
                    console.log("🎤 Wake word recognition started.");
                }
                }
                _setAsrUiState('wake', 'READY');
            };

            this.recognition.onresult = (event) => {
                this.lastActivityTime = Date.now();

                if (window.__setupWakeWordSuppressed || isMassageSetupMode) {
                    return;
                }

                const suppressWakeWord = window.__massageModeGuidePlaying
                    || (window.audioManager?.getStatus?.().current?.assetId === 'system.massage_mode_guide');
                if (suppressWakeWord) {
                    return;
                }

                const wakeLang = localStorage.getItem('voiceLanguage') || localStorage.getItem('language') || 'zh';
                const enterSetupRegex = wakeLang === 'en'
                    ? /(massage\s*settings?)/i
                    : /(按摩\s*[設设]\s*[定置]|[設设]\s*[定置]\s*按\s*摩|按摩\s*[設设]\s*[定置]|開始\s*按摩|開始\s*[設设]\s*[定置]|轉換\s*成?\s*按摩|進入\s*按摩)/i;
                let interimTranscript = '';
                const currentMode = stateMachine?.getMode?.() || SystemMode?.CHAT || 'CHAT';
                const isChatMode = currentMode === 'CHAT' || currentMode === SystemMode?.CHAT;

                const wakeWordRegex = new RegExp(this.wakeWord.replace(/ /g, '\\s*'));

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const rawTranscript = event.results[i][0].transcript;
                    const isFinal = event.results[i].isFinal;

                    // 🔧 Apply ASR auto-correction for wake word detection
                    const transcript = typeof normalizeAsrForWakeWord === 'function'
                        ? normalizeAsrForWakeWord(rawTranscript)
                        : rawTranscript;

                    // 🔧 DEBUG: Log what speech is being detected (raw and corrected)
                    console.log(`🎤 [WakeWord] Raw: "${rawTranscript}" -> Corrected: "${transcript}" (final: ${isFinal}, mode: ${currentMode})`);
                    console.log(`🎤 [WakeWord] enterSetupRegex match: ${enterSetupRegex.test(transcript)}, wakeWordRegex match: ${wakeWordRegex.test(transcript)}`);
                    // Update ASR debug display during voice setup
                    if (typeof updateAsrDebugDisplay === 'function') {
                        updateAsrDebugDisplay(rawTranscript);
                    }

                    if (event.results[i].isFinal) {
                        const trigger = detectVoiceTrigger(rawTranscript);
                        if (trigger === 'ENTER_SETUP') {
                            this.onWakeWordDetected('enter_setup', rawTranscript);
                            return;
                        }
                        // Allow direct command to enter massage setup without wake word
                        if (enterSetupRegex.test(transcript)) {
                            this.onWakeWordDetected('enter_setup', rawTranscript);
                            return;
                        }
                        if (isChatMode && wakeWordRegex.test(transcript)) {
                            this.onWakeWordDetected('wake_word', rawTranscript);
                            return;
                        }
                    } else {
                        // Apply correction to interim transcript as well
                        const correctedInterim = typeof normalizeAsrForWakeWord === 'function'
                            ? normalizeAsrForWakeWord(rawTranscript)
                            : rawTranscript;
                        interimTranscript += correctedInterim;
                        // Also allow direct setup on interim results (some browsers delay finals)
                        if (enterSetupRegex.test(interimTranscript)) {
                            this.onWakeWordDetected('enter_setup', interimTranscript);
                            return;
                        }
                        if (isChatMode && wakeWordRegex.test(interimTranscript)) {
                            this.onWakeWordDetected('wake_word', interimTranscript);
                            return;
                        }
                    }
                }
            };

            this.recognition.onend = () => {
                if (window.__setupWakeWordSuppressed || isMassageSetupMode || window.__setupPromptPlaying) {
                    return;
                }
                if (!this.isListening || this._pendingStartTimer || this._lastError === 'audio-capture') {
                    return;
                }
                this.recognition.start();
                if (window.DEBUG_LOGS) {
                    console.log("✅ Wake word recognition started internally");
                }
            };

            this.recognition.onerror = (event) => {
                this._isStarting = false;

                // If user manually stopped listening, skip errors
                if (!this.isListening) {
                    return;
                }

                if (event.error === 'no-speech') {
                    if (window.DEBUG_LOGS) {
                        console.log('🔇 No speech detected (normal)');
                    }
                    return;
                }

                console.error(`❌ Wake word recognition error: ${event.error}`);

                if (event.error === 'audio-capture') {
                    this._lastError = 'audio-capture';
                    this.isListening = false;
                    this._isStarting = false;
                    this.restartAttempts = Math.min(this.restartAttempts + 1, this.maxRestartAttempts);
                    this.errorBackoff = Math.min(this.errorBackoff * 2, this.maxBackoff);
                    this._scheduleRestart(this.errorBackoff);
                    return;
                }

                if (this.isListening) {
                    // 限制重啟次數，防止無限循環
                    if (this.restartAttempts < this.maxRestartAttempts) {
                        this.restartAttempts++;
                        // 🔧 只在第一次重試時輸出 log
                        if (this.restartAttempts === 1) {
                            if (window.DEBUG_LOGS) {
                                console.log(`🔄 Wake word restarting (${this.errorBackoff / 1000}s backoff)...`);
                            }
                        }
                        // 🔧 使用單一排程
                        this._scheduleRestart(this.errorBackoff);
                    } else {
                        if (window.DEBUG_LOGS) {
                            console.warn('⚠️ Wake word: Max restart attempts reached, will retry in 10s');
                        }
                        this.isListening = false;
                        this._isStarting = false;
                        // 🔧 10 秒後重置（原 5 秒）- 使用單一排程
                        this._scheduleRestart(10000);
                    }
                }
            };

            // ✅ 啟動健康檢查
            this.startHealthCheck();

            return true;
        }

        // ✅ 內部啟動方法，避免重複重置標誌
        _internalStart() {
            // 🔧 FIX: Check if already starting or during massage session
            if (this._isStarting || isMassageSessionActive) {
                return;
            }

            try {
                this.recognition.start();
                if (window.DEBUG_LOGS) {
                    console.log("✅ Wake word recognition started internally");
                }
            } catch (error) {
                console.error("❌ Failed to start wake word recognition:", error);
                this.isListening = false;
                this._scheduleRestart(1500);
            }
        }

        start() {
            // 🔧 FIX: Anti-duplicate start protection
            const now = Date.now();

            if (!this.recognition) {
                const ok = this.init();
                if (!ok || !this.recognition) {
                    this.isListening = false;
                    this._isStarting = false;
                    // SpeechRecognition unavailable: don't spin restart loop.
                    console.warn('⚠️ Wake word unavailable: recognition is not initialized');
                    return;
                }
            }

            if (window.__setupWakeWordSuppressed || isMassageSetupMode) {
                if (window.DEBUG_LOGS) {
                    console.log('⚠️ Wake word suppressed during massage setup');
                }
                return;
            }

            // Check if already listening
            if (this.isListening) {
                console.log("⚠️ Wake word already listening");
                return;
            }

            // Check if currently starting (prevent concurrent starts)
            if (this._isStarting) {
                console.log("⚠️ Wake word start already in progress");
                return;
            }

            // Check cooldown (prevent rapid-fire starts)
            if (now - this._lastStartAt < this._startCooldownMs) {
                if (window.DEBUG_LOGS) {
                    console.log(`⚠️ Wake word start cooldown (${this._startCooldownMs}ms)`);
                }
                return;
            }

            this._isStarting = true;
            this._lastStartAt = now;
            this.isListening = true;
            this.wakeWordDetected = false;
            this.errorBackoff = 1000;
            this.restartAttempts = 0;
            this.lastActivityTime = Date.now();

            try {
                this.recognition.start();
                if (window.DEBUG_LOGS) {
                    console.log("🎤 Wake word listening started...");
                }
            } catch (error) {
                // Handle "already started" error gracefully
                if (error.message && error.message.includes('already started')) {
                    if (window.DEBUG_LOGS) {
                        console.log("⚠️ Wake word recognition already running, keeping current state");
                    }
                    // Keep isListening = true, don't retry
                    this._isStarting = false;
                    return;
                }

                console.error("❌ Could not start wake word listening:", error);
                this.isListening = false;

                // ✅ 如果啟動失敗，2秒後重試（使用單一排程）
                this._scheduleRestart(2000);
            } finally {
                this._isStarting = false;
            }
        }

        // 🔧 FIX: Safe start method for external callers - prevents duplicate starts
        safeStart() {
            // Cancel any pending restart
            if (this._pendingStartTimer) {
                clearTimeout(this._pendingStartTimer);
                this._pendingStartTimer = null;
            }

            // Only start if toggle is enabled
            if (!document.getElementById('wakeWordToggle')?.checked) {
                return;
            }

            // Only start if not during massage session
            if (typeof isMassageSessionActive !== 'undefined' && isMassageSessionActive) {
                return;
            }

            this.start();
        }

        // 🔧 FIX: Single-queue restart scheduler
        _scheduleRestart(delayMs) {
            if (!this.recognition) {
                return;
            }
            // Cancel any existing scheduled restart
            if (this._pendingStartTimer) {
                clearTimeout(this._pendingStartTimer);
            }

            this._pendingStartTimer = setTimeout(() => {
                this._pendingStartTimer = null;
                if (document.getElementById('wakeWordToggle')?.checked) {
                    console.log("🔄 Retrying wake word start...");
                    this.start();
                }
            }, delayMs);
        }

        stop() {
            // 🔧 FIX: Cancel any pending restart when stopping
            if (this._pendingStartTimer) {
                clearTimeout(this._pendingStartTimer);
                this._pendingStartTimer = null;
            }

            if (!this.isListening) return;

            this.isListening = false;
            this.wakeWordDetected = false;
            this._isStarting = false;

            try {
            this.recognition.stop();
            if (window.DEBUG_LOGS) {
                console.log("🛑 Wake word listening stopped.");
            }
            } catch (error) {
                console.error("❌ Error stopping wake word:", error);
            }

            // ✅ 停止健康檢查
            this.stopHealthCheck();
        }

        onWakeWordDetected(reason = 'wake_word', transcript = '') {
            // 🔧 FIX: Guard against stale results arriving after stop() was called
            // This happens when interim result triggers detection, stop() is called,
            // but final result still arrives from the speech recognition buffer
            if (!this.isListening && !this.wakeWordDetected) {
                console.log("⚠️ Wake word result arrived after detector stopped, ignoring");
                return;
            }

            if (this.wakeWordDetected) {
                console.log("⚠️ Wake word already detected, ignoring duplicate");
                return;
            }

            this.wakeWordDetected = true;
            console.log(`🦊 Voice trigger detected: ${reason}`, transcript ? `("${transcript}")` : '');
            showFoxReaction('listening', 1500);

            // "按摩設定" should immediately start the guided setup flow
            if (reason === 'enter_setup' && typeof startMassageSetup === 'function') {
                this.stop();
                startMassageSetup();
                return;
            }

            if (typeof startRecording === 'function') {
                this.stop();
                startRecording();
            }
        }

        // 🔧 健康檢查：使用可配置間隔，TTS 播放時暫停
        startHealthCheck() {
            this.stopHealthCheck(); // 先清除舊的

            this.healthCheckInterval = setInterval(() => {
                if (!this.isListening) return;

                // 🔇 TTS 播放時暫停健康檢查，避免干擾
                const ttsStatus = window.robustTTS?.getStatus?.();
                if (isTTSPlaying || ttsStatus?.isPlaying) return;

                const timeSinceActivity = Date.now() - this.lastActivityTime;

                // 使用可配置的超時時間
                if (timeSinceActivity > this.inactivityTimeoutMs) {
                    console.warn('⚠️ Wake word detector inactive, restarting...');
                    this.restart();
                }
            }, this.healthCheckIntervalMs);
        }

        stopHealthCheck() {
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
            }
        }

        // ✅ 強制重啟
        restart() {
            console.log('🔄 Force restarting wake word detector...');
            const wasListening = this.isListening;

            try {
                this.stop();
            } catch (e) {
                console.error('Error during stop:', e);
            }

            if (wasListening && document.getElementById('wakeWordToggle')?.checked) {
                setTimeout(() => {
                    this.start();
                }, 1000);
            }
        }
    }

    /**
     * Get wake word for given language
     * @param {string} lang - Language code
     * @returns {string} Wake word
     */
    export function getWakeWord(lang) {
        const wakeWords = {
            'zh': '你好',      // Hello (Cantonese)
            'en': 'massage setting(s)'    // Massage Setting(s) (English)
        };
        return wakeWords[lang] || '你好';
    }

    /**
     * Update wake word when language changes
     * @param {string} lang - New language code
     */
    export function updateWakeWord(lang) {
        const newWakeWord = getWakeWord(lang);

        // Update wake word detector if it exists
        if (typeof wakeWordDetector !== 'undefined' && wakeWordDetector) {
            wakeWordDetector.wakeWord = newWakeWord;
            if (wakeWordDetector.recognition) {
                wakeWordDetector.recognition.lang = getASRLanguage(lang);
            }
            const wasListening = wakeWordDetector.isListening;
            if (wasListening) {
                wakeWordDetector.stop();
                setTimeout(() => {
                    if (document.getElementById('wakeWordToggle')?.checked) {
                        wakeWordDetector.start();
                    }
                }, 400);
            }
            debugLog('info', `Wake word updated to: ${newWakeWord}`);
        }
    }
