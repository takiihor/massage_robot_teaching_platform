import { AudioAssetLibrary } from './AudioAssets.js';
import { AudioPriority } from './AudioManager.js';

// Header TTS indicator helper
/*
 * Module: TTSPlayer
 * Purpose: Text-to-speech controls and voice routing helpers.
 * Exports: setTtsIndicator, stopAllTTS, isTTSActive, speakWithVoice,
 *          speakAsMassageRobot, speakAsPatient
 * Module bridge globals: window.setTtsIndicator, window.stopAllTTS, window.isTTSActive,
 *                 window.speakWithVoice, window.speakAsMassageRobot,
 *                 window.speakAsPatient (via module-bridge)
 */

export function setTtsIndicator(state) {
    const dot = document.getElementById('ttsStatusDot');
    if (!dot) return;
    dot.classList.remove('inactive', 'speaking', 'error');
    switch (state) {
        case 'speaking':
            dot.classList.add('speaking');
            break;
        case 'error':
            dot.classList.add('error');
            break;
        case 'inactive':
            dot.classList.add('inactive');
            break;
        case 'ready':
        default:
            // default green base
            break;
    }
}

function shouldSkipAudio() {
    return !!window.__DEV_SMOKE__ || !!window.__ttsDisabledForFrontend;
}

// Global helper to stop all ongoing TTS (used on mode switches)
// Returns true if something was actually stopped
export function stopAllTTS() {
    let stoppedSomething = false;
    try {
        // Preset assets share the same output channel
        if (window.audioManager?.getStatus?.().isPlaying) {
            window.audioManager.stop('stopAllTTS');
            stoppedSomething = true;
        }
        if (window.robustTTS) {
            // Only stop if actually playing or has queued items
            const status = window.robustTTS.getStatus?.() || {};
            if (status.isPlaying || status.queueLength > 0) {
                window.robustTTS.stop(true);
                stoppedSomething = true;
            }
        }
        if (window.ultraFastTTS) {
            window.ultraFastTTS.stop();
        }
        if ('speechSynthesis' in window && window.speechSynthesis?.speaking) {
            window.speechSynthesis.cancel();
            stoppedSomething = true;
        }
        setTtsIndicator('ready');
    } catch (e) {
        console.warn('[stopAllTTS] Error stopping TTS:', e.message);
    }
    return stoppedSomething;
}

// Check if any TTS is currently playing
export function isTTSActive() {
    try {
        if (window.robustTTS?.isBusy?.()) return true;
        if (window.ultraFastTTS?.isPlaying) return true;
        if ('speechSynthesis' in window && window.speechSynthesis?.speaking) return true;
    } catch (e) {
        // Ignore errors
    }
    return false;
}

// ===== Voice Routing Functions =====
// Speak with specific voice (bypasses default voice selection)
export async function speakWithVoice(text, voice, priority = 'normal', stopCurrent = true) {
    if (window.__ttsDisabledForFrontend) {
        return { ok: false, reason: 'tts_removed_frontend' };
    }

    const cleanText = typeof window.preprocessForCantoneseTTS === 'function'
        ? window.preprocessForCantoneseTTS(window.stripHTML(text))
        : window.stripHTML(text);

    if (shouldSkipAudio()) {
        console.warn('[DEV_SMOKE] Skip TTS playback');
        setTtsIndicator('ready');
        return { ok: false, reason: 'dev_smoke_skip' };
    }

    // Stop any ongoing TTS before starting a new one (ensures mode switches cut previous speech)
    // Only if stopCurrent is requested AND there's actually something playing
    if (stopCurrent) {
        try {
            // Stop any preset asset audio too (single-channel)
            window.audioManager?.stop?.('preempt-tts');

            // RobustTTS.stop() now returns false if nothing was playing
            const stoppedRobust = window.robustTTS?.stop?.(true, 'speakWithVoice') || false;

            let stoppedUltraFast = false;
            // ultraFastTTS.isPlaying is a property, not a method
            if (window.ultraFastTTS?.isPlaying) {
                window.ultraFastTTS.stop();
                stoppedUltraFast = true;
            }

            let stoppedSynthesis = false;
            if ('speechSynthesis' in window && window.speechSynthesis?.speaking) {
                window.speechSynthesis.cancel();
                stoppedSynthesis = true;
            }

            if (stoppedRobust || stoppedUltraFast || stoppedSynthesis) {
                console.log('[speakWithVoice] Stopped previous TTS');
            }
        } catch (e) {
            console.warn('[speakWithVoice] Error stopping TTS:', e.message);
        }
    }

    // Show TTS active state
    setTtsIndicator('speaking');

    if (window.robustTTS) {
        try {
            await window.robustTTS.speakAsync(cleanText, {
                voice: voice,
                priority: priority,
                maxAgeMs: priority === 'high' ? 5000 : 10000
            });
            setTtsIndicator('ready');
        } catch (error) {
            setTtsIndicator('error');
            console.warn('[speakWithVoice] TTS error (non-fatal):', error.message);
            setTimeout(() => setTtsIndicator('ready'), 1500);
        }
        return;
    }

    // Fallback to playCantoneseTTS
    if (typeof window.playCantoneseTTS === 'function') {
        await window.playCantoneseTTS(cleanText, voice);
        setTtsIndicator('ready');
    }
}

// Speak as massage robot (WanLung voice)
export async function speakAsMassageRobot(text) {
    if (window.__ttsDisabledForMassage) {
        return { ok: false, reason: 'massage_tts_disabled' };
    }
    if (shouldSkipAudio()) {
        console.warn('[DEV_SMOKE] Skip massage robot audio');
        return { ok: false, reason: 'dev_smoke_skip' };
    }
    const mode = window.stateMachine?.getMode?.() || 'CHAT';
    const presetId = AudioAssetLibrary.matchSystemTextToAssetId(text)
        || ((text || '').includes('進入按摩模式') ? 'system.enter_setup' : null);

    // 🔧 FIX: SETUP mode - only use preset audio, NO TTS fallback
    if (mode === window.SystemMode?.MASSAGE_SETUP) {
        if (presetId) {
            return await window.audioManager.playAsset(presetId, { priority: AudioPriority.P1, ttlMs: 1000, interrupt: true });
        }
        // No preset found - skip audio entirely (no TTS)
        console.warn(`[MassageRobot] SETUP mode: No preset for "${text}" - skipping (no TTS)`);
        return { ok: false, reason: 'no_preset_in_setup' };
    }

    // RUNNING: never use network TTS; only preset assets (drop/beep if missing)
    if (mode === window.SystemMode?.MASSAGE_RUNNING) {
        const runningId = presetId
            || (text?.includes('緊急停止') ? 'system.emergency_stop' : null)
            || (text?.includes('暫停') ? 'system.paused' : null)
            || (text?.includes('繼續') ? 'system.resumed' : null)
            || (text?.includes('停止') ? 'system.stopped' : null)
            || 'system.generic_ack';
        const prio = runningId === 'system.emergency_stop' ? AudioPriority.P3 : (runningId === 'system.generic_ack' ? AudioPriority.P1 : AudioPriority.P2);
        return await window.audioManager.playAsset(runningId, { priority: prio, ttlMs: 1000, interrupt: true });
    }

    // CHAT/other: TTS removed in frontend
    if (window.__ttsDisabledForFrontend) {
        return { ok: false, reason: 'tts_removed_frontend' };
    }

    // CHAT/other: allow TTS
    const cfg = window.VOICE_CONFIG || {};
    return await speakWithVoice(text, cfg.MASSAGE_ROBOT || 'azure-zh-HK-WanLungNeural', 'high');
}

// Speak as patient (WanLung voice) - for patient feedback
export async function speakAsPatient(text) {
    // Patient "reaction" TTS should never interrupt or arrive late during an active session.
    // If ASR/TTS are under load, skip these non-critical utterances to avoid perceived "insertion".
    try {
        if (typeof window.isMassageSessionActive !== 'undefined' && window.isMassageSessionActive) {
            // RUNNING: never use network TTS; keep low-priority and drop when busy
            if (window.audioManager?.getStatus?.().isPlaying) return;
            const now = Date.now();
            if (now - (window.__lastPatientTtsAt || 0) < 12000) return; // rate limit
            window.__lastPatientTtsAt = now;
        }
    } catch (e) { /* ignore */ }
    if (shouldSkipAudio()) {
        console.warn('[DEV_SMOKE] Skip patient audio');
        return { ok: false, reason: 'dev_smoke_skip' };
    }
    const mode = window.stateMachine?.getMode?.() || 'CHAT';
    if (mode === window.SystemMode?.MASSAGE_RUNNING || (typeof window.isMassageSessionActive !== 'undefined' && window.isMassageSessionActive)) {
        return { ok: false, reason: 'virtual_patient_reaction_removed' };
    }
    if (window.__ttsDisabledForFrontend) {
        return { ok: false, reason: 'tts_removed_frontend' };
    }

    const cfg = window.VOICE_CONFIG || {};
    return await speakWithVoice(text, cfg.PATIENT || 'azure-zh-HK-WanLungNeural', 'high');
}
