"use strict";

/*
 * Module: AlwaysListening
 * Purpose: Always-on listening orchestration and health checks.
 * Exports: createAlwaysListening
 * Module bridge globals: window.createAlwaysListening (via module-bridge)
 */

export function createAlwaysListening(deps) {
        const getIsAlwaysListeningActive = deps.getIsAlwaysListeningActive;
        const setIsAlwaysListeningActive = deps.setIsAlwaysListeningActive;
        const getIsAlwaysListeningMode = deps.getIsAlwaysListeningMode;
        const setIsAlwaysListeningMode = deps.setIsAlwaysListeningMode;
        const getIsMassageSessionActive = deps.getIsMassageSessionActive;
        const getIsRecording = deps.getIsRecording;
        const getIsTTSPlaying = deps.getIsTTSPlaying;
        const getAlwaysListeningPermissionDenied = deps.getAlwaysListeningPermissionDenied;
        const setAlwaysListeningPermissionDenied = deps.setAlwaysListeningPermissionDenied;
        const getAlwaysListeningRetryCount = deps.getAlwaysListeningRetryCount;
        const setAlwaysListeningRetryCount = deps.setAlwaysListeningRetryCount;
        const getAlwaysListeningMaxRetries = deps.getAlwaysListeningMaxRetries;
        const updateAlwaysListeningIndicator = deps.updateAlwaysListeningIndicator;
        const getAlwaysListeningState = deps.getAlwaysListeningState;
        const getWakeWordDetector = deps.getWakeWordDetector;
        const getBrowserRecognition = deps.getBrowserRecognition;
        const initBrowserSpeechRecognition = deps.initBrowserSpeechRecognition;
        const setLastRecognitionActivity = deps.setLastRecognitionActivity;
        const getRobustTtsStatus = deps.getRobustTtsStatus;
        const hideListeningIndicator = deps.hideListeningIndicator;
        const setIsIntentionalStop = deps.setIsIntentionalStop;

        let alwaysListeningHealthCheck = null;

        async function startAlwaysListening() {
            if (getIsAlwaysListeningActive() || getIsMassageSessionActive() || getIsRecording()) {
                console.log('[AlwaysListen] Cannot start - already active or blocked by other mode');
                return;
            }

            // 🔧 FIX: Check if permission was denied - require user gesture to retry
            if (getAlwaysListeningPermissionDenied()) {
                console.log('[AlwaysListen] Cannot start - permission was denied, need user gesture');
                updateAlwaysListeningIndicator('error', '需要麥克風權限', '請點擊「重啟語音檢測」');
                return;
            }

            console.log('[AlwaysListen] Starting always-listening mode...');

            // Stop wake word detector if running
            const wakeWordDetector = getWakeWordDetector();
            if (wakeWordDetector && wakeWordDetector.isListening) {
                wakeWordDetector.stop();
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Initialize browser recognition if needed
            let browserRecognition = getBrowserRecognition();
            if (!browserRecognition) {
                initBrowserSpeechRecognition();
                await new Promise(resolve => setTimeout(resolve, 100));
                browserRecognition = getBrowserRecognition();
            }

            try {
                setIsAlwaysListeningActive(true);
                setIsAlwaysListeningMode(true);
                browserRecognition.start();
                // 🔧 FIX: Reset retry count on successful start
                setAlwaysListeningRetryCount(0);
                updateAlwaysListeningIndicator('ready', '持續聆聽', '準備好了');
                setLastRecognitionActivity(Date.now());
                startAlwaysListeningHealthCheck();
                console.log('[AlwaysListen] Started successfully');
            } catch (error) {
                if (error.message && error.message.includes('already started')) {
                    console.log('[AlwaysListen] Recognition already running, keeping active');
                    setIsAlwaysListeningActive(true);
                    setAlwaysListeningRetryCount(0); // Reset on success
                    updateAlwaysListeningIndicator('ready', '持續聆聽', '準備好了');
                } else if (error.name === 'NotAllowedError' || error.message?.includes('not-allowed')) {
                    // 🔧 FIX: Handle permission denied error in catch block too
                    console.error('[AlwaysListen] Permission denied in catch:', error);
                    setAlwaysListeningPermissionDenied(true);
                    setIsAlwaysListeningActive(false);
                    updateAlwaysListeningIndicator('error', '需要麥克風權限', '請點擊「重啟語音檢測」');
                } else {
                    console.error('[AlwaysListen] Failed to start:', error);
                    setIsAlwaysListeningActive(false);
                    setAlwaysListeningRetryCount(getAlwaysListeningRetryCount() + 1);

                    // Retry after delay (with limit)
                    if (!getAlwaysListeningPermissionDenied() && getAlwaysListeningRetryCount() < getAlwaysListeningMaxRetries()) {
                        updateAlwaysListeningIndicator('error', '啟動失敗', `重試中 (${getAlwaysListeningRetryCount()}/${getAlwaysListeningMaxRetries()})`);
                        setTimeout(() => {
                            if (getIsAlwaysListeningMode() && !getIsAlwaysListeningActive() && !getAlwaysListeningPermissionDenied()) {
                                startAlwaysListening();
                            }
                        }, 2000);
                    } else {
                        updateAlwaysListeningIndicator('error', '無法啟動', '請點擊「重啟語音檢測」');
                    }
                }
            }
        }

        function stopAlwaysListening() {
            if (!getIsAlwaysListeningActive() && !getIsAlwaysListeningMode()) return;

            console.log('[AlwaysListen] Stopping always-listening mode...');
            setIsAlwaysListeningActive(false);
            setIsAlwaysListeningMode(false);
            stopAlwaysListeningHealthCheck();

            const browserRecognition = getBrowserRecognition();
            if (browserRecognition) {
                try {
                    browserRecognition.stop();
                } catch (e) {
                    console.warn('[AlwaysListen] Error stopping recognition:', e);
                }
            }

            hideListeningIndicator();
            console.log('[AlwaysListen] Stopped');
        }

        function pauseAlwaysListening() {
            if (!getIsAlwaysListeningActive()) return;

            console.log('[AlwaysListen] Pausing for TTS...');
            setIsIntentionalStop(true);

            const browserRecognition = getBrowserRecognition();
            if (browserRecognition) {
                try {
                    browserRecognition.stop();
                } catch (e) {
                    console.warn('[AlwaysListen] Error pausing:', e);
                }
            }

            updateAlwaysListeningIndicator('not-ready', '暫停中', 'TTS 播放中');
        }

        function resumeAlwaysListening() {
            if (!getIsAlwaysListeningMode() || getIsMassageSessionActive()) {
                console.log('[AlwaysListen] Resume skipped - mode disabled or massage active');
                return;
            }

            // 🔧 FIX: Don't resume if permission was denied
            if (getAlwaysListeningPermissionDenied()) {
                console.log('[AlwaysListen] Resume skipped - permission denied, need user gesture');
                return;
            }

            console.log('[AlwaysListen] Resuming...');
            setIsAlwaysListeningActive(false); // Reset to allow restart

            setTimeout(() => {
                // Check both runtime flag and robustTTS status
                const ttsStatus = getRobustTtsStatus();
                const isTTSActive = getIsTTSPlaying() || ttsStatus?.isPlaying;

                if (getIsAlwaysListeningMode() && !getIsAlwaysListeningActive() && !getIsMassageSessionActive() && !isTTSActive && !getAlwaysListeningPermissionDenied()) {
                    startAlwaysListening();
                } else if (isTTSActive) {
                    // TTS still playing, defer restart
                    console.log('[AlwaysListen] TTS still playing, deferring resume...');
                    setTimeout(() => resumeAlwaysListening(), 500);
                }
            }, 300);
        }

        function startAlwaysListeningHealthCheck() {
            stopAlwaysListeningHealthCheck();

            console.log('[AlwaysListen] Starting health check');
            alwaysListeningHealthCheck = setInterval(() => {
                if (!getIsAlwaysListeningMode()) {
                    stopAlwaysListeningHealthCheck();
                    return;
                }

                // 🔧 FIX: Stop health check if permission was denied
                if (getAlwaysListeningPermissionDenied()) {
                    console.log('[AlwaysListen] Health check stopped - permission denied');
                    stopAlwaysListeningHealthCheck();
                    return;
                }

                // Skip during TTS or massage - check both runtime flag and robustTTS status
                const ttsStatus = getRobustTtsStatus();
                if (getIsTTSPlaying() || ttsStatus?.isPlaying || getIsMassageSessionActive()) {
                    return;
                }

                const timeSinceActivity = Date.now() - window.lastRecognitionActivity;

                // Check if recognition seems stuck (no activity for 20 seconds)
                if (timeSinceActivity > 20000 && !getIsAlwaysListeningActive() && !getAlwaysListeningPermissionDenied()) {
                    console.warn('[AlwaysListen] Recognition stopped unexpectedly, restarting...');
                    startAlwaysListening();
                }

                // Check if listening might be stuck (40 seconds no activity while supposedly active)
                if (timeSinceActivity > 40000 && getIsAlwaysListeningActive() && !getAlwaysListeningPermissionDenied()) {
                    console.warn('[AlwaysListen] Recognition may be stuck, forcing restart...');
                    setIsAlwaysListeningActive(false);
                    startAlwaysListening();
                }

                // Update indicator to show healthy state
                if (getIsAlwaysListeningActive() && getAlwaysListeningState() !== 'processing') {
                    updateAlwaysListeningIndicator('ready', '持續聆聽', '準備好了');
                }
            }, 5000);
        }

        function stopAlwaysListeningHealthCheck() {
            if (alwaysListeningHealthCheck) {
                console.log('[AlwaysListen] Stopping health check');
                clearInterval(alwaysListeningHealthCheck);
                alwaysListeningHealthCheck = null;
            }
        }

        function getState() {
            return {
                isAlwaysListeningMode: getIsAlwaysListeningMode(),
                isAlwaysListeningActive: getIsAlwaysListeningActive(),
                alwaysListeningHealthCheck
            };
        }

        return {
            startAlwaysListening,
            stopAlwaysListening,
            pauseAlwaysListening,
            resumeAlwaysListening,
            startAlwaysListeningHealthCheck,
            stopAlwaysListeningHealthCheck,
            getState
        };
}
