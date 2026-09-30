function _getApiUrl() {
    return window.API_URL || '';
}

/*
 * Module: RobotController
 * Purpose: Robot command transport and telemetry helpers.
 * Exports: sendRobotCommand, sendRobotJog, sendCalibrationCommand,
 *          fetchTelemetry, createRobotEventSource, connectRobot,
 *          disconnectRobot, restoreCalibration, getCalibrationStatus,
 *          RobotController
 * Module bridge globals: window.RobotController (via module-bridge)
 */

export async function sendRobotCommand(endpoint, payload = {}, context = {}) {
        try {
            let url = '';
            let body = null;
            let method = 'POST';

            const modeOverrides = {
                change_action_knead: 'knead',
                change_action_push_up: 'push_up',
                change_action_wave_push: 'wave_push',
                change_action_spiral_press: 'spiral_press',
                change_action_tap: 'wave_push',
                change_action_massage: 'spiral_press',
                change_action_acupressure: 'knead'
            };

            if (endpoint === 'stop') {
                url = `${_getApiUrl()}/api/stop`;
            } else if (endpoint === 'pause') {
                url = `${_getApiUrl()}/massage/pause`;
            } else if (endpoint === 'resume') {
                url = `${_getApiUrl()}/massage/resume`;
            } else {
                url = `${_getApiUrl()}/api/command`;
                const resolvedMode = payload.mode || payload.action || modeOverrides[endpoint];
                if (!resolvedMode) {
                    window.__lastRobotApiResult = { endpoint, ok: false, status: null, detail: 'unsupported_command' };
                    console.warn(`⚠️ Unsupported robot command: ${endpoint}`);
                    return false;
                }
                const currentMassageSession = context.currentMassageSession || null;
                const massageSetupState = context.massageSetupState || null;
                const fallbackMinutes = currentMassageSession?.command?.duration || massageSetupState?.duration || 5;
                const fallbackDuration = Number.isFinite(fallbackMinutes) ? Math.round(fallbackMinutes * 60) : 300;
                const resolvedForceAssist = payload.force_assist != null
                    ? !!payload.force_assist
                    : !!context.forceAssistEnabled;
                body = {
                    mode: resolvedMode,
                    intensity: payload.intensity || currentMassageSession?.command?.intensity || massageSetupState?.intensity || '中',
                    duration: payload.duration != null ? payload.duration : fallbackDuration,
                    force_assist: resolvedForceAssist
                };
            }

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : null
            });
            if (!response.ok) {
                let detail = '';
                try {
                    const err = await response.json();
                    detail = err?.detail ? (typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)) : JSON.stringify(err);
                } catch (e) { /* ignore */ }
                console.error(`🤖 Robot API error: ${response.status}`, detail);
                window.__lastRobotApiResult = { endpoint, ok: false, status: response.status, detail };
                return false;
            }
            const data = await response.json();
            console.log(`🤖 Robot command ${endpoint}:`, data);
            const message = [data.error || data.message, data.hint].filter(Boolean).join(' ');
            window.__lastRobotApiResult = { endpoint, ok: data.ok ?? true, status: response.status, message };
            return data.ok ?? true;
        } catch (error) {
            console.warn(`⚠️ Robot command ${endpoint} failed:`, error.message);
            window.__lastRobotApiResult = { endpoint, ok: false, status: null, detail: error.message || 'network_error' };
            return false;
        }
    }

export async function sendRobotJog(endpoint, payload = {}) {
        try {
            const response = await fetch(`${_getApiUrl()}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {})
            });
            if (!response.ok) {
                let detail = '';
                try {
                    const err = await response.json();
                    detail = err?.detail ? (typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)) : JSON.stringify(err);
                } catch (e) { /* ignore */ }
                return { ok: false, status: response.status, detail };
            }
            const data = await response.json();
            return { ok: data?.ok ?? true, status: response.status, data };
        } catch (error) {
            return { ok: false, status: null, detail: error?.message || 'network_error' };
        }
    }

export async function sendCalibrationCommand(endpoint) {
        try {
            const response = await fetch(`${_getApiUrl()}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (!response.ok) {
                let detail = '';
                try {
                    const err = await response.json();
                    detail = err?.detail ? (typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)) : JSON.stringify(err);
                } catch (e) { /* ignore */ }
                window.__lastRobotApiResult = { endpoint, ok: false, status: response.status, detail };
                return { ok: false, status: response.status, detail };
            }
            const data = await response.json();
            window.__lastRobotApiResult = { endpoint, ok: data?.ok ?? true, status: response.status, message: data?.message || '' };
            return { ok: data?.ok ?? true, status: response.status, data };
        } catch (error) {
            window.__lastRobotApiResult = { endpoint, ok: false, status: null, detail: error?.message || 'network_error' };
            return { ok: false, status: null, detail: error?.message || 'network_error' };
        }
    }

export async function fetchTelemetry() {
        try {
            const response = await fetch(`${_getApiUrl()}/api/telemetry`);
            if (response.ok) {
                const data = await response.json();
                return { ok: true, status: response.status, data };
            }
            return { ok: false, status: response.status };
        } catch (error) {
            return { ok: false, status: null, detail: error?.message || 'network_error' };
        }
    }

export function createRobotEventSource() {
    return new EventSource(`${_getApiUrl()}/robot/stream`);
}

export async function connectRobot(ip) {
        try {
            const response = await fetch(`${_getApiUrl()}/robot/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                const detail = data?.detail || data?.error || `HTTP ${response.status}`;
                return { responseOk: false, status: response.status,
                    detail: typeof detail === 'string' ? detail : JSON.stringify(detail) };
            }
            const data = await response.json();
            return { responseOk: true, status: response.status, data };
        } catch (error) {
            return { responseOk: false, status: null, detail: error?.message || 'network_error' };
        }
    }

export async function disconnectRobot() {
        try {
            const response = await fetch(`${_getApiUrl()}/robot/disconnect`, { method: 'POST' });
            if (!response.ok) {
                let detail = '';
                try {
                    const err = await response.json();
                    detail = err?.detail ? (typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)) : JSON.stringify(err);
                } catch (e) { /* ignore */ }
                return { responseOk: false, status: response.status, detail };
            }
            const data = await response.json();
            return { responseOk: true, status: response.status, data };
        } catch (error) {
            return { responseOk: false, status: null, detail: error?.message || 'network_error' };
        }
    }

export async function restoreCalibration() {
        try {
            const response = await fetch(`${_getApiUrl()}/calibration/restore`, { method: 'POST' });
            let data = null;
            try {
                data = await response.json();
            } catch (e) { /* ignore */ }
            return { ok: response.ok, status: response.status, data };
        } catch (error) {
            return { ok: false, status: null, detail: error?.message || 'network_error' };
        }
    }

export async function getCalibrationStatus() {
        try {
            const response = await fetch(`${_getApiUrl()}/calibration/status`);
            if (!response.ok) {
                return { ok: false, status: response.status };
            }
            const data = await response.json();
            return { ok: true, status: response.status, data };
        } catch (error) {
            return { ok: false, status: null, detail: error?.message || 'network_error' };
        }
    }

export const RobotController = {
    sendRobotCommand,
    sendRobotJog,
    sendCalibrationCommand,
    fetchTelemetry,
    createRobotEventSource,
    connectRobot,
    disconnectRobot,
    restoreCalibration,
    getCalibrationStatus
};
