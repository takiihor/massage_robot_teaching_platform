// ===== AudioManager - Single-channel audio playback engine =====
// Extracted from app.js (Step 12)

import { AudioAssetLibrary } from './AudioAssets.js';

// Priority enum (non-destructive export)
/*
 * Module: AudioManager
 * Purpose: Audio playback orchestration and prioritization.
 * Exports: AudioPriority, shouldDebugAudio, audioDebugLog, AudioManager
 * Module bridge globals: window.AudioPriority, window.AudioManager, window.audioDebugLog (via module-bridge)
 */

export const AudioPriority = window.AudioPriority || { P0: 0, P1: 1, P2: 2, P3: 3 };

// Safe accessors for globals defined in app.js
function getAudioUnlocked() {
    return !!window.audioUnlocked;
}

function waitUnlock() {
    return window.waitForAudioUnlock?.() ?? Promise.resolve();
}

export function shouldDebugAudio() {
    try {
        if (typeof window.debugMode !== 'undefined' && window.debugMode) return true;
        if (window.DEBUG_AUDIO) return true;
        if (localStorage.getItem('audioDebug') === 'true') return true;
    } catch (e) { /* ignore */ }
    return false;
}

export function audioDebugLog(message, data = null) {
    if (!shouldDebugAudio()) return;
    if (data) {
        console.log(`[AudioDebug] ${message}`, data);
    } else {
        console.log(`[AudioDebug] ${message}`);
    }
}

export class AudioManager {
    constructor() {
        this.audioEl = new Audio();
        this.audioEl.preload = 'auto';
        this.current = null;
        this._token = 0;
        this._requestToken = 0;
        this._pendingResolve = null;
    }

    getStatus() {
        return {
            isPlaying: !!(this.current && !this.audioEl.paused),
            current: this.current ? { ...this.current } : null,
        };
    }

    stop(reason = 'stop') {
        try {
            audioDebugLog('stop', {
                reason,
                current: this.current ? { assetId: this.current.assetId, priority: this.current.priority } : null
            });
            this._token += 1;
            this._requestToken += 1;
            this.current = null;
            if (this._pendingResolve) {
                this._pendingResolve({ ok: false, reason });
                this._pendingResolve = null;
            }
            this.audioEl.pause();
            this.audioEl.currentTime = 0;
            this.audioEl.removeAttribute('src');
            this.audioEl.load();
        } catch (e) { /* ignore */ }
    }

    onUserSpeakingStart() {
        audioDebugLog('barge_in', { current: this.current ? this.current.assetId : null });
        this.stop('barge-in');
    }

    async prepareAsset(assetId) {
        if (this.current) return false;
        const requestToken = ++this._requestToken;
        const asset = await AudioAssetLibrary.getAsset(assetId, { forPlayback: true });
        if (requestToken !== this._requestToken || this.current || !asset?.url) return false;
        this._setAssetSource(asset.url);
        return true;
    }

    _setAssetSource(url) {
        // Retain audio prepared before the wake phrase; restarting load() would
        // throw away the buffered data just as the user needs the response.
        if (this.audioEl.getAttribute('src') === url) return;
        this.audioEl.src = url;
        this.audioEl.load();
    }

    async playAsset(assetId, { priority = AudioPriority.P1, ttlMs = 1000, interrupt = true, eventTime = Date.now() } = {}) {
        const requestToken = ++this._requestToken;
        audioDebugLog('request', { assetId, priority, ttlMs, interrupt, eventTime });
        let asset;
        try {
            asset = await AudioAssetLibrary.getAsset(assetId, { forPlayback: true });
        } catch (e) {
            console.error('[AudioManager] Failed to load asset:', assetId, e);
            audioDebugLog('load_failed', { assetId, error: e?.message || String(e) });
            return { ok: false, dropped: true, reason: 'load_failed' };
        }
        if (requestToken !== this._requestToken) {
            return { ok: false, dropped: true, reason: 'superseded' };
        }
        if (!asset?.url) {
            console.warn('[AudioManager] Missing asset:', assetId);
            audioDebugLog('missing_asset', { assetId });
            return { ok: false, dropped: true, reason: 'missing_asset' };
        }
        audioDebugLog('loaded', {
            assetId,
            sizeKb: asset.size ? Math.round(asset.size / 1024) : null,
            durationMs: asset.duration ? Math.round(asset.duration * 1000) : null,
            format: asset.format || null
        });

        const now = Date.now();
        if (ttlMs != null && now - eventTime > ttlMs) {
            console.log('[AudioManager] Dropped stale audio:', { assetId, ageMs: now - eventTime, ttlMs });
            audioDebugLog('drop_ttl', { assetId, ageMs: now - eventTime, ttlMs });
            return { ok: false, dropped: true, reason: 'ttl_expired' };
        }

        // Arbitration: single-channel, no backlog (drop if cannot interrupt)
        const isPlaying = this.current && !this.audioEl.paused;
        if (isPlaying) {
            const curPrio = this.current?.priority ?? AudioPriority.P0;
            if (!(interrupt && priority >= curPrio)) {
                console.log('[AudioManager] Dropped due to priority/busy:', { assetId, priority, curPrio });
                audioDebugLog('drop_busy', {
                    assetId,
                    priority,
                    curPrio,
                    interrupt,
                    current: this.current ? this.current.assetId : null
                });
                return { ok: false, dropped: true, reason: 'busy' };
            }
            this.stop('preempt');
        }

        // Ensure any TTS channel is stopped too (single-channel across TTS + assets)
        try {
            window.robustTTS?.stop?.(true, 'AudioManager.playAsset');
            if (window.ultraFastTTS?.isPlaying) window.ultraFastTTS.stop();
            if ('speechSynthesis' in window && window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
        } catch (e) { /* ignore */ }

        let unlockPromise = null;
        if (!getAudioUnlocked()) {
            try {
                unlockPromise = waitUnlock();
            } catch (e) { /* ignore */ }
        }

        const token = ++this._token;
        this.current = { assetId, priority, ttlMs, eventTime, requestedAt: now };

        return await new Promise((resolve) => {
            this._pendingResolve = resolve;

            const cleanup = (result) => {
                if (this._token !== token) return; // superseded
                this._pendingResolve = null;
                this.current = null;
                this.audioEl.onended = null;
                this.audioEl.onerror = null;
                audioDebugLog('complete', { assetId, result });
                resolve(result);
            };

            this.audioEl.onended = () => {
                audioDebugLog('ended', { assetId });
                cleanup({ ok: true, assetId });
            };
            this.audioEl.onerror = () => {
                const err = this.audioEl?.error || null;
                audioDebugLog('error', {
                    assetId,
                    code: err?.code || null,
                    message: err?.message || null
                });
                cleanup({ ok: false, assetId, reason: 'playback_error' });
            };

            try {
                this._setAssetSource(asset.url);
                audioDebugLog('start', { assetId, url: asset.url });
                let retried = false;
                const attemptPlay = () => {
                    const playPromise = this.audioEl.play();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch((err) => handlePlayReject(err));
                    }
                };

                const handlePlayReject = async (err) => {
                    const msg = String(err?.message || '');
                    const notAllowed = err?.name === 'NotAllowedError' || msg.includes('NotAllowedError');
                    if (!retried && unlockPromise && notAllowed) {
                        retried = true;
                        try {
                            await unlockPromise;
                            if (this._token !== token) return;
                            attemptPlay();
                            return;
                        } catch (e) { /* ignore */ }
                    }
                    audioDebugLog('play_rejected', {
                        assetId,
                        name: err?.name || null,
                        message: msg || null,
                        retried,
                        notAllowed
                    });
                    cleanup({ ok: false, assetId, reason: 'play_rejected' });
                };

                attemptPlay();
            } catch (e) {
                audioDebugLog('exception', { assetId, error: e?.message || String(e) });
                cleanup({ ok: false, assetId, reason: 'exception' });
            }
        });
    }
}

