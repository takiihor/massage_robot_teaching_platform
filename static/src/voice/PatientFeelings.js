// ===== PatientFeelings - Patient feeling audio routing =====
// Extracted from app.js (Step 13)

'use strict';

    // Asset ID mapping for patient feelings
const PATIENT_FEELING_ASSET_IDS = {
        '舒適': ['patient.comfy_01', 'patient.comfy_02', 'patient.comfy_03', 'patient.comfy_04'],
        '少痛': ['patient.slight_discomfort_01', 'patient.slight_discomfort_02', 'patient.slight_discomfort_03', 'patient.slight_discomfort_04'],
        '中痛': ['patient.pain_01', 'patient.pain_02', 'patient.pain_03', 'patient.pain_04'],
        '很痛': ['patient.severe_pain_01', 'patient.severe_pain_02', 'patient.severe_pain_03', 'patient.severe_pain_04'],
    };

    // Defensive debug logging (audioDebugLog may not be exported)
function debugLog(message, data) {
        if (typeof window.audioDebugLog === 'function') {
            window.audioDebugLog(message, data);
        }
    }

    // Safe random choice (uses window.randomChoice if available)
function safeRandomChoice(arr) {
        if (typeof window.randomChoice === 'function') {
            return window.randomChoice(arr);
        }
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // Session state accessors (read-only)
function getSessionState() {
        return {
            isPaused: !!(window.__massageSessionPaused || window.currentMassageSession?.isPaused),
            isActive: !!window.isMassageSessionActive,
            isAutoListening: !!window.isAutoListening
        };
    }

    // Listening control (defensive)
function pauseListening() {
        try {
            if (typeof window.stopContinuousMassageListening === 'function') {
                window.stopContinuousMassageListening();
            } else {
                window._massageListening?.stopContinuousMassageListening?.();
            }
        } catch (e) { /* ignore */ }
    }

function resumeListening() {
        try {
            if (typeof window.safeRestartMassageListening === 'function') {
                window.safeRestartMassageListening();
            }
        } catch (e) { /* ignore */ }
    }

    // Token management
function bumpToken() {
        try {
            window.__patientFeelingToken = (window.__patientFeelingToken || 0) + 1;
        } catch (e) { /* ignore */ }
    }

function getToken() {
        return window.__patientFeelingToken || 0;
    }

    // Stop patient audio if currently playing
function stopIfPlaying() {
        try {
            const st = window.audioManager?.getStatus?.() || {};
            const cur = st.current || null;
            if (st.isPlaying && cur?.assetId && String(cur.assetId).startsWith('patient.')) {
                window.audioManager.stop('patient_pause');
            }
        } catch (e) { /* ignore */ }
    }

    // Auto-reaction control
function isAutoReactionEnabled() {
        return window.__virtualPatientAutoReaction !== false;
    }

function setAutoReaction(enabled) {
        window.__virtualPatientAutoReaction = !!enabled;
        if (!enabled) {
            bumpToken();
            stopIfPlaying();
        }
    }

    // Main play function
async function play(feeling, options = {}) {
        if (!isAutoReactionEnabled()) {
            debugLog('patient_drop', { feeling: feeling || '舒適', reason: 'auto_disabled' });
            return { ok: false, dropped: true, reason: 'auto_disabled' };
        }

        const f = feeling || '舒適';
        const candidates = PATIENT_FEELING_ASSET_IDS[f] || PATIENT_FEELING_ASSET_IDS['舒適'];
        if (!candidates || candidates.length === 0) {
            return { ok: false, reason: 'no_candidates' };
        }

        // Pause patient voice when the task is paused/stopped.
        try {
            const session = getSessionState();
            if (session.isPaused) {
                debugLog('patient_drop', { feeling: f, reason: 'session_paused' });
                return { ok: false, dropped: true, reason: 'session_paused' };
            }
            if (!session.isActive) {
                debugLog('patient_drop', { feeling: f, reason: 'session_inactive' });
                return { ok: false, dropped: true, reason: 'session_inactive' };
            }
        } catch (e) { /* ignore */ }

        const isSevere = f === '很痛';
        const allowInterrupt = isSevere || options.force;
        const now = Date.now();
        const minIntervalMs = isSevere ? 0 : 6000;

        const token = options._token ?? getToken();
        debugLog('patient_request', {
            feeling: f,
            force: !!options.force,
            token,
            ttlMs: options.ttlMs ?? null
        });

        try {
            const lastAt = window.__lastPatientFeelingAt || 0;
            const lastFeeling = window.__lastPatientFeelingValue || null;
            if (!options.force && !isSevere && now - lastAt < minIntervalMs && lastFeeling === f) {
                debugLog('patient_drop', { feeling: f, reason: 'rate_limited' });
                return { ok: false, dropped: true, reason: 'rate_limited' };
            }
            window.__lastPatientFeelingAt = now;
            window.__lastPatientFeelingValue = f;
        } catch (e) { /* ignore */ }

        const attempt = options._attempt || 0;
        const eventTime = options._eventTime || now;
        const ttlMs = options.ttlMs ?? (isSevere ? 8000 : (options.force ? 9000 : 6000));

        // Single-channel: if busy, retry briefly so patient voice still has a chance to play.
        try {
            if (!allowInterrupt && window.audioManager?.getStatus?.().isPlaying && attempt < 6) {
                const delayMs = 220 + attempt * 120;
                return await new Promise((resolve) => {
                    setTimeout(() => {
                        if (getToken() !== token) {
                            debugLog('patient_drop', { feeling: f, reason: 'token_changed' });
                            resolve({ ok: false, dropped: true, reason: 'token_changed' });
                            return;
                        }
                        const session = getSessionState();
                        if (session.isPaused || !session.isActive) {
                            debugLog('patient_drop', { feeling: f, reason: 'session_not_active' });
                            resolve({ ok: false, dropped: true, reason: 'session_not_active' });
                            return;
                        }
                        play(f, { ...options, _attempt: attempt + 1, _eventTime: eventTime, ttlMs })
                            .then(resolve)
                            .catch(() => resolve({ ok: false, reason: 'retry_failed' }));
                    }, delayMs);
                });
            }
        } catch (e) { /* ignore */ }

        const assetId = safeRandomChoice(candidates);

        // Avoid ASR self-listening: pause continuous listening while patient MP3 is playing.
        const session = getSessionState();
        const wasAutoListening = session.isAutoListening && session.isActive;
        if (wasAutoListening) {
            pauseListening();
        }

        // Sync UI emoji exactly when audio is about to start (not when requested/retried).
        try {
            window.dispatchEvent(
                new CustomEvent('virtualPatientFeelingStart', {
                    detail: { feeling: f, token, source: 'audio', assetId }
                })
            );
        } catch (e) { /* ignore */ }

        const result = await window.audioManager.playAsset(assetId, {
            priority: isSevere ? window.AudioPriority.P2 : (options.force ? window.AudioPriority.P2 : window.AudioPriority.P1),
            ttlMs,
            interrupt: allowInterrupt, // allow forced patient cue to preempt soft prompts
            eventTime
        });

        debugLog('patient_result', {
            feeling: f,
            assetId,
            ok: !!result?.ok,
            dropped: !!result?.dropped,
            reason: result?.reason || null
        });

        try {
            window.dispatchEvent(
                new CustomEvent('virtualPatientFeelingEnd', {
                    detail: { token, source: 'audio', assetId, ok: !!result?.ok }
                })
            );
        } catch (e) { /* ignore */ }

        if (wasAutoListening) {
            const currentSession = getSessionState();
            if (!currentSession.isPaused && currentSession.isActive) {
                resumeListening();
            }
        }

        return result;
    }

    // Non-destructive export
/*
 * Module: PatientFeelings
 * Purpose: Virtual patient reactions and audio routing.
 * Exports: PatientFeelings
 * Module bridge globals: window.PatientFeelings (via module-bridge)
 */

export const PatientFeelings = {
    play,
    bumpToken,
    getToken,
    isAutoReactionEnabled,
    setAutoReaction,
    stopIfPlaying
};
