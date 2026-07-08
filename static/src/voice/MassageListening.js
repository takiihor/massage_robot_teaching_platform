/*
 * Module: MassageListening
 * Purpose: Massage listening mode orchestration.
 * Exports: createMassageListening
 * Module bridge globals: window.createMassageListening (via module-bridge)
 */

export function createMassageListening(deps) {
        let recognitionRestartPending = false;
        let massageListeningHealthCheck = null;
        let massageListeningTimeout = null;
        let healthCheckFailures = 0;
        let lastHealthCheckWarnAt = 0;
        let lastHealthCheckErrorAt = 0;

        function startMassageListeningHealthCheck() {
            if (massageListeningHealthCheck) {
                clearInterval(massageListeningHealthCheck);
            }

            // Reset failure counter when starting fresh
            healthCheckFailures = 0;

            if (window.DEBUG_LOGS) {
                console.log('🏥 Starting massage listening health check');
            }
            massageListeningHealthCheck = setInterval(async () => {
                if (!deps.getIsMassageSessionActive()) {
                    stopMassageListeningHealthCheck();
                    return;
                }

                // 🔧 FIX: Skip health checks during pause (lack of activity is normal)
                const currentSession = deps.getCurrentMassageSession();
                if (currentSession && currentSession.isPaused) {
                    return; // Don't check during pause
                }

                const timeSinceActivity = Date.now() - deps.getLastRecognitionActivity();

                // If no recognition activity for 15 seconds AND listening should be active
                if (timeSinceActivity > deps.getSPEECH_CONFIG().LISTENING_TIMEOUT_NO_ACTIVITY && !deps.getIsAutoListening()) {
                    healthCheckFailures++;
                    if (window.DEBUG_LOGS || Date.now() - lastHealthCheckWarnAt > 60000) {
                        console.warn(`⚠️ Massage listening stopped unexpectedly (attempt ${healthCheckFailures}/3)`);
                        lastHealthCheckWarnAt = Date.now();
                    }

                    if (healthCheckFailures >= 3) {
                        if (window.DEBUG_LOGS || Date.now() - lastHealthCheckErrorAt > 60000) {
                            console.error('❌ Health check failed 3 times; disabling auto-listening (do not auto-pause massage)');
                            lastHealthCheckErrorAt = Date.now();
                        }
                        deps.addSystemMessage('⚠️ 語音識別似乎卡住咗，我已暫停自動聆聽（按摩會繼續）。你可以按「暫停/停止」，或者講清楚一次「停止按摩」。', 'warning');
                        stopContinuousMassageListening();
                        deps.setIsAutoListening(false);
                        healthCheckFailures = 0;
                        return;
                    }

                    safeRestartMassageListening();
                }
                // If isAutoListening is true but recognition might be stuck
                else if (timeSinceActivity > deps.getSPEECH_CONFIG().LISTENING_TIMEOUT_STUCK && deps.getIsAutoListening()) {
                    healthCheckFailures++;
                    if (window.DEBUG_LOGS || Date.now() - lastHealthCheckWarnAt > 60000) {
                        console.warn(`⚠️ Massage listening may be stuck (attempt ${healthCheckFailures}/3)`);
                        lastHealthCheckWarnAt = Date.now();
                    }

                    if (healthCheckFailures >= 3) {
                        if (window.DEBUG_LOGS || Date.now() - lastHealthCheckErrorAt > 60000) {
                            console.error('❌ Health check failed 3 times (stuck); disabling auto-listening (do not auto-pause massage)');
                            lastHealthCheckErrorAt = Date.now();
                        }
                        deps.addSystemMessage('⚠️ 語音識別似乎卡住咗，我已暫停自動聆聽（按摩會繼續）。你可以按「暫停/停止」，或者講清楚一次「停止按摩」。', 'warning');
                        stopContinuousMassageListening();
                        deps.setIsAutoListening(false);
                        healthCheckFailures = 0;
                        return;
                    }

                    deps.setIsAutoListening(false); // Reset flag
                    safeRestartMassageListening();
                }
                // Reset failure counter on successful activity
                else if (timeSinceActivity < deps.getSPEECH_CONFIG().LISTENING_TIMEOUT_NO_ACTIVITY) {
                    healthCheckFailures = 0;
                }
            }, deps.getSPEECH_CONFIG().HEALTH_CHECK_INTERVAL);
        }

        function stopMassageListeningHealthCheck() {
            if (massageListeningHealthCheck) {
                if (window.DEBUG_LOGS) {
                    console.log('🏥 Stopping massage listening health check');
                }
                clearInterval(massageListeningHealthCheck);
                massageListeningHealthCheck = null;
            }
        }

        // 🔧 FIX: Safe restart function with mutex to prevent concurrent restarts
        function safeRestartMassageListening() {
            if (recognitionRestartPending) {
                if (window.DEBUG_LOGS) {
                    console.log('⚠️ Recognition restart already pending, skipping duplicate request');
                }
                return;
            }

            recognitionRestartPending = true;
            if (window.DEBUG_LOGS) {
                console.log('🔄 Safe restart initiated...');
            }

            setTimeout(() => {
                try {
                    if (!deps.getIsMassageSessionActive()) {
                        if (window.DEBUG_LOGS) {
                            console.log('⚠️ Massage session no longer active, aborting restart');
                        }
                        return;
                    }

                    if (deps.getIsAutoListening()) {
                        if (window.DEBUG_LOGS) {
                            console.log('⚠️ Recognition already active, skipping restart');
                        }
                        return;
                    }

                    const recognition = deps.getBrowserRecognition();
                    if (!recognition) {
                        console.warn('⚠️ Recognition instance unavailable; restart skipped');
                        deps.setIsAutoListening(false);
                        return;
                    }
                    // Now safe to restart - use browser recognition (simple & reliable)
                    deps.setIsAutoListening(true);
                    recognition.start();
                    deps.showListeningIndicator("聆聽中...");
                    deps.setLastRecognitionActivity(Date.now());
                    if (window.DEBUG_LOGS) {
                        console.log('✅ Recognition safely restarted');
                    }

                } catch (e) {
                    if (e.message && e.message.includes('already started')) {
                        if (window.DEBUG_LOGS) {
                            console.log('⚠️ Recognition already running (caught in safe restart)');
                        }
                        deps.setIsAutoListening(true);
                        deps.showListeningIndicator("聆聽中...");
                    } else {
                        console.error('❌ Error in safe restart:', e);
                        deps.setIsAutoListening(false);
                    }
                } finally {
                    recognitionRestartPending = false;
                }
            }, 150); // 150ms delay to avoid race conditions
        }

        async function startContinuousMassageListening() {
            if (deps.getIsAutoListening() && deps.getAsrIsReady()) return;
            if (deps.getIsAutoListening() && !deps.getAsrIsReady()) {
                if (window.DEBUG_LOGS) {
                    console.log('🎤 Continuous listening flag set but ASR not ready, forcing restart...');
                }
                deps.setIsAutoListening(false);
            }
            if (window.DEBUG_LOGS) {
                console.log('🎤 Starting continuous listening for massage session...');
            }

            // Stop any other recognition first
            if (deps.getIsRecording()) {
                deps.stopRecording();
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            const detector = deps.getWakeWordDetector();
            if (detector && detector.isListening) {
                detector.stop();
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            // Stop always-listening mode if active
            if (deps.getIsAlwaysListeningActive() || deps.getIsAlwaysListeningMode()) {
                if (window.DEBUG_LOGS) {
                    console.log('[AlwaysListen] Stopping for massage session');
                }
                deps.setIsAlwaysListeningMode(false); // Temporarily disable mode
                deps.stopAlwaysListening();
                await new Promise(resolve => setTimeout(resolve, 250));
            }

            // Use browser recognition (simple & reliable for massage mode)
            if (!deps.getBrowserRecognition()) {
                deps.initBrowserSpeechRecognition();
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            try {
                const recognition = deps.getBrowserRecognition();
                if (!recognition) {
                    console.error('❌ Continuous listening unavailable: recognition instance is null');
                    deps.setIsAutoListening(false);
                    deps.hideListeningIndicator();
                    return;
                }
                deps.setIsAutoListening(true);
                recognition.start();
                deps.showListeningIndicator("聆聽中..."); // Show a persistent indicator
                deps.setLastRecognitionActivity(Date.now()); // Reset activity timer
                startMassageListeningHealthCheck(); // 🔧 FIX: Start health monitoring

                // 🔧 FIX: Set timeout to restart before browser's 60s recognition limit
                if (massageListeningTimeout) clearTimeout(massageListeningTimeout);
                massageListeningTimeout = setTimeout(() => {
                    if (deps.getIsAutoListening() && deps.getIsMassageSessionActive()) {
                        console.log('🔄 Recognition timeout (55s), proactive restart to avoid browser limit');
                        safeRestartMassageListening();
                    }
                }, deps.getSPEECH_CONFIG().BROWSER_RECOGNITION_TIMEOUT);

                console.log('✅ Continuous listening started - ready for quick commands');
            } catch (error) {
                // Handle "already started" error gracefully
                if (error.message && error.message.includes('already started')) {
                    console.log('⚠️ Continuous listening already running, keeping active');
                    deps.setIsAutoListening(true); // Keep it active
                    deps.showListeningIndicator("聆聽中...");
                } else {
                    console.error('❌ Continuous listening failed to start:', error);
                    deps.setIsAutoListening(false);
                    deps.hideListeningIndicator();
                }
            }
        }

        function stopContinuousMassageListening() {
            if (!deps.getIsAutoListening()) return;
            console.log('🎤 Stopping continuous listening for massage session...');
            deps.setSuppressManualSubmitUntil(Math.max(deps.getSuppressManualSubmitUntil(), Date.now() + 1200));
            deps.setIsAutoListening(false);

            // 🔧 FIX: Clear the recognition timeout
            if (massageListeningTimeout) {
                clearTimeout(massageListeningTimeout);
                massageListeningTimeout = null;
            }

            // Stop browser recognition
            const recognition = deps.getBrowserRecognition();
            if (recognition) {
                try {
                    recognition.stop();
                } catch (e) {
                    console.warn('⚠️ Error stopping continuous recognition:', e);
                }
            }
            stopMassageListeningHealthCheck(); // 🔧 FIX: Stop health monitoring
            deps.hideListeningIndicator();
        }

        return {
            startMassageListeningHealthCheck,
            stopMassageListeningHealthCheck,
            safeRestartMassageListening,
            startContinuousMassageListening,
            stopContinuousMassageListening
        };
}
