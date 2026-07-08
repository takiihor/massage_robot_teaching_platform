"use strict";

/*
 * Module: FollowUpListening
 * Purpose: Follow-up listening timers and state.
 * Exports: createFollowUpListening
 * Module bridge globals: window.createFollowUpListening (via module-bridge)
 */

export function createFollowUpListening(deps) {
        const getBrowserRecognition = deps.getBrowserRecognition;
        const getWakeWordDetector = deps.getWakeWordDetector;
        const getIsMassageSessionActive = deps.getIsMassageSessionActive;
        const getIsTTSPlaying = deps.getIsTTSPlaying;
        const getIsAutoListening = deps.getIsAutoListening;
        const getWakeWordToggleChecked = deps.getWakeWordToggleChecked;
        const updateFollowUpIndicator = deps.updateFollowUpIndicator;
        const updateMicCountdownRing = deps.updateMicCountdownRing;
        const hideListeningIndicator = deps.hideListeningIndicator;
        const hideMicCountdownRing = deps.hideMicCountdownRing;
        const setIsFollowUpListening = deps.setIsFollowUpListening;
        const setFollowUpTimeRemaining = deps.setFollowUpTimeRemaining;
        const setPendingFollowUp = deps.setPendingFollowUp;
        const setLastRecognitionActivity = deps.setLastRecognitionActivity;
        const setIsIntentionalStop = deps.setIsIntentionalStop;
        const getFollowUpDuration = deps.getFollowUpDuration;
        const getFollowUpExtension = deps.getFollowUpExtension;

        let isFollowUpListening = false;
        let followUpTimer = null;
        let followUpTimeRemaining = 0;
        let followUpCountdownInterval = null;

        function _syncGlobals() {
            setIsFollowUpListening(isFollowUpListening);
            setFollowUpTimeRemaining(followUpTimeRemaining);
        }

        function startFollowUpListening() {
            // Don't start if massage session is active (it has its own listening)
            if (getIsMassageSessionActive()) {
                console.log('[FollowUp] Skipped - massage session active');
                return;
            }

            // Don't start if TTS is still playing
            if (getIsTTSPlaying()) {
                console.log('[FollowUp] Skipped - TTS still playing');
                return;
            }

            // Clear any existing follow-up timer
            stopFollowUpListening(false); // false = don't restart wake word yet

            console.log('[FollowUp] Starting follow-up listening mode...');
            isFollowUpListening = true;
            followUpTimeRemaining = getFollowUpDuration();
            _syncGlobals();

            // Show follow-up indicator with countdown
            updateFollowUpIndicator();
            updateMicCountdownRing(followUpTimeRemaining, getFollowUpDuration());

            // Start speech recognition
            const browserRecognition = getBrowserRecognition();
            if (browserRecognition) {
                try {
                    // Stop wake word detector while in follow-up mode
                    const wakeWordDetector = getWakeWordDetector();
                    if (wakeWordDetector && wakeWordDetector.isListening) {
                        wakeWordDetector.stop();
                    }

                    browserRecognition.start();
                    setLastRecognitionActivity(Date.now());
                    console.log('[FollowUp] Speech recognition started');
                } catch (error) {
                    if (error.message && error.message.includes('already started')) {
                        console.log('[FollowUp] Recognition already running');
                    } else {
                        console.error('[FollowUp] Failed to start recognition:', error);
                        stopFollowUpListening(true);
                        return;
                    }
                }
            }

            // Start countdown interval (update UI every 100ms)
            followUpCountdownInterval = setInterval(() => {
                followUpTimeRemaining -= 100;
                _syncGlobals();
                updateFollowUpIndicator();

                if (followUpTimeRemaining <= 0) {
                    console.log('[FollowUp] Timeout - returning to wake word mode');
                    stopFollowUpListening(true);
                }
            }, 100);

            // Set main timeout as backup
            followUpTimer = setTimeout(() => {
                console.log('[FollowUp] Timer expired');
                stopFollowUpListening(true);
            }, getFollowUpDuration() + 500); // Extra 500ms buffer
        }

        /**
         * Stop follow-up listening and optionally restart wake word detector
         * @param {boolean} restartWakeWord - Whether to restart wake word detector
         */
        function stopFollowUpListening(restartWakeWord = true) {
            console.log('[FollowUp] Stopping follow-up mode');

            // Clear timers
            if (followUpTimer) {
                clearTimeout(followUpTimer);
                followUpTimer = null;
            }
            if (followUpCountdownInterval) {
                clearInterval(followUpCountdownInterval);
                followUpCountdownInterval = null;
            }

            // Reset state
            isFollowUpListening = false;
            followUpTimeRemaining = 0;
            _syncGlobals();
            setPendingFollowUp(false); // Clear pending flag too

            // Hide indicator
            hideListeningIndicator();
            hideMicCountdownRing();

            // Stop recognition if running (but not during massage)
            const browserRecognition = getBrowserRecognition();
            if (browserRecognition && !getIsMassageSessionActive() && !getIsAutoListening()) {
                try {
                    setIsIntentionalStop(true);
                    browserRecognition.stop();
                } catch (e) {
                    // Ignore errors when stopping
                }
            }

            // Restart wake word detector if requested
            if (restartWakeWord && !getIsMassageSessionActive()) {
                const wakeWordDetector = getWakeWordDetector();
                if (wakeWordDetector && getWakeWordToggleChecked()) {
                    console.log('[FollowUp] Resuming wake word detector');
                    setTimeout(() => {
                        if (!getIsTTSPlaying() && !getIsMassageSessionActive() && !isFollowUpListening) {
                            wakeWordDetector.start();
                        }
                    }, 300);
                }
            }
        }

        /**
         * Extend follow-up timer when user starts speaking
         * Called when interim speech results are detected
         */
        function extendFollowUpTimer() {
            if (!isFollowUpListening) return;

            console.log('[FollowUp] User speaking - extending timer');

            // Reset to extension duration
            followUpTimeRemaining = getFollowUpExtension();
            _syncGlobals();

            // Reset the main timeout
            if (followUpTimer) {
                clearTimeout(followUpTimer);
            }
            followUpTimer = setTimeout(() => {
                console.log('[FollowUp] Extended timer expired');
                stopFollowUpListening(true);
            }, getFollowUpExtension() + 500);

            updateFollowUpIndicator();
        }

        function getState() {
            return {
                isFollowUpListening,
                followUpTimeRemaining
            };
        }

        _syncGlobals();

        return {
            startFollowUpListening,
            stopFollowUpListening,
            extendFollowUpTimer,
            getState
        };
}
