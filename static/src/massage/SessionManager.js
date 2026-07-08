/*
 * Module: SessionManager
 * Purpose: Session core state machine and callbacks.
 * Exports: SessionCore
 * Module bridge globals: window.SessionCore (via module-bridge)
 */

export class SessionCore {
    constructor(command) {
        this.command = command;
        const durationMin = Number(command?.duration);
        const normalizedDuration = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 5;
        this.durationMs = normalizedDuration * 60 * 1000;
        this.startTime = Date.now();
        this.checkInPoints = [10, 30, 50, 70, 90];
        this.completedCheckIns = new Set();
        this.userResponses = [];
        this.isPaused = false;
        this.pausedTime = 0;
        this.pauseStartTime = null;
        this.isWaitingForResponse = false;
        this._progressInterval = null;
        this._onProgress = [];
        this._onCheckIn = [];
        this._onCompleted = [];
    }

    onProgress(fn) {
        if (typeof fn === 'function') this._onProgress.push(fn);
    }

    onCheckIn(fn) {
        if (typeof fn === 'function') this._onCheckIn.push(fn);
    }

    onCompleted(fn) {
        if (typeof fn === 'function') this._onCompleted.push(fn);
    }

    startTicker(intervalMs = 1000) {
        if (this._progressInterval) {
            console.warn('[SessionCore] Ticker already running, ignoring startTicker()');
            return;
        }
        this.startTime = Date.now();
        this.pausedTime = 0;
        this.pauseStartTime = null;
        this.isPaused = false;
        this.completedCheckIns = new Set();
        if (window.DEBUG_LOGS) {
            console.log('[SessionCore] Starting ticker with interval:', intervalMs, 'ms');
            console.log('[SessionCore] Initial tick...');
        }
        this.tick();
        this._progressInterval = setInterval(() => {
            this.tick();
        }, intervalMs);
        if (window.DEBUG_LOGS) {
            console.log('[SessionCore] Ticker started successfully');
        }
    }

    stopTicker() {
        if (this._progressInterval) {
            clearInterval(this._progressInterval);
            this._progressInterval = null;
        }
    }

    isTickerRunning() {
        return !!this._progressInterval;
    }

    setWaitingForResponse(value) {
        this.isWaitingForResponse = !!value;
    }

    recordUserResponse(text) {
        this.userResponses.push(text);
    }

    pause() {
        if (this.isPaused) return;
        this.isPaused = true;
        this.pauseStartTime = Date.now();
    }

    resume() {
        if (!this.isPaused) return;
        this.isPaused = false;
        if (this.pauseStartTime) {
            this.pausedTime += (Date.now() - this.pauseStartTime);
            this.pauseStartTime = null;
        }
    }

    _getElapsedMs() {
        const currentPausedTime = this.pauseStartTime
            ? (Date.now() - this.pauseStartTime)
            : 0;
        const totalPausedTime = this.pausedTime + currentPausedTime;
        return Date.now() - this.startTime - totalPausedTime;
    }

    _computeProgress(elapsedMs) {
        const progress = (elapsedMs / this.durationMs) * 100;
        const totalSeconds = this.durationMs / 1000;
        const elapsedSeconds = elapsedMs / 1000;
        const remainingSeconds = Math.max(0, totalSeconds - elapsedSeconds);
        return { progress, remainingSeconds, totalSeconds, elapsedMs };
    }

    tick() {
        if (this.isPaused) {
            if (window.DEBUG_LOGS) {
                console.log('[SessionCore] Tick skipped - session is paused');
            }
            return;
        }
        const elapsedMs = this._getElapsedMs();
        const { progress, remainingSeconds, totalSeconds } = this._computeProgress(elapsedMs);

        if (window.DEBUG_LOGS) {
            console.log('[SessionCore] Tick:', { elapsedMs, progress: progress.toFixed(2), remainingSeconds, totalSeconds });
        }

        this._onProgress.forEach((fn) => {
            try {
                fn({ progress, remainingSeconds, totalSeconds, elapsedMs });
            } catch (e) {
                console.error('[SessionCore] Error in onProgress callback:', e);
            }
        });

        if (progress >= 100) {
            if (window.DEBUG_LOGS) {
                console.log('[SessionCore] Session completed!');
            }
            this._onCompleted.forEach((fn) => {
                try {
                    fn({ progress });
                } catch (e) { /* ignore */ }
            });
            return;
        }

        this.checkInPoints.forEach((point) => {
            if (progress >= point && !this.completedCheckIns.has(point)) {
                this.completedCheckIns.add(point);
                this._onCheckIn.forEach((fn) => {
                    try {
                        fn(point);
                    } catch (e) { /* ignore */ }
                });
            }
        });
    }
}
