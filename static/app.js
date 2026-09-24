/*
 * stable app runtime
 *
 * This is the active browser entry for the daily teaching build.
 * It intentionally keeps the active startup path small and explicit.
 */
(function () {
    'use strict';

    const DEFAULT_VITALS = { hr: 89, sbp: 115, dbp: 73, rr: 18, spo2: 97 };
    const DEFAULT_SUBJECTIVE = { pain: 0, anxiety: 0, comfort: 2 };
    const SETUP_BASELINE_CUES = { pain: 'NONE', anxiety: 'NONE', comfort: 'SLIGHTLY_UNCOMFORTABLE' };
    const WAKE_WORD_DEFAULT_ON_MIGRATION_KEY = 'wakeWordDefaultOnMigrated.20260706';
    const INTENSITY_TEXT = { low: '小', mid: '中', high: '大' };
    const MODE_TO_API = {
        1: 'push_up',
        2: 'wave_push',
        3: 'spiral_press',
        4: 'knead'
    };

    const state = {
        uiMode: 'SETUP',
        massage: {
            mode: 4,
            intensity: 'mid',
            durationMin: 5,
            autoRead: true
        },
        session: {
            remainingSec: 0,
            totalSec: 0,
            startedAt: 0,
            pausedAt: 0,
            pausedMs: 0
        },
        connection: {
            // Backend-authoritative operating state. Never inferred from
            // connectivity on the client. See docs/audit/full-repo-audit.md (Sec 4).
            connected: false,
            simulation: false,
            state: 'UNKNOWN',        // PHYSICAL_READY | PHYSICAL_NOT_READY | SIMULATION | FAULT
            profile: null,
            faulted: false,
            capabilities: {},
            reason: null
        },
        vitals: { ...DEFAULT_VITALS },
        instructor: {
            scenario: {
                ...DEFAULT_SUBJECTIVE,
                presetActive: 'baseline'
            },
            presetActive: 'baseline'
        }
    };

    let initialized = false;
    let renderTimer = null;
    let healthTimer = null;
    let sttUnsubscribers = [];
    let voiceSetupSnapshot = null;
    let voiceSetupProgress = null;
    let asrWakePhraseFragments = [];
    let voiceSetupGuidanceToken = 0;
    let lastVoiceSetupGuidance = { assetId: '', at: 0 };

    function $(id) {
        return document.getElementById(id);
    }

    function clamp(num, min, max) {
        const value = Number(num);
        if (!Number.isFinite(value)) return min;
        return Math.max(min, Math.min(max, value));
    }

    function announce(message) {
        const live = $('liveRegion');
        if (live) live.textContent = message;
    }

    function showToast(title, message) {
        const text = message ? `${title}: ${message}` : title;
        announce(text);
        window.addSystemMessage?.(text, 'info');
    }

    function addSystemMessage(message, level = 'info') {
        console[level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log'](`[${level}] ${message}`);
        announce(message);
        const existing = $('stableToast');
        if (existing) existing.remove();
    }

    window.addSystemMessage = window.addSystemMessage || addSystemMessage;
    window.addFoxMessage = window.addFoxMessage || function addFoxMessageFallback(message) {
        addSystemMessage(message, 'info');
    };

    function waitFor(predicate, timeoutMs = 2500) {
        const started = Date.now();
        return new Promise((resolve) => {
            function tick() {
                if (predicate()) {
                    resolve(true);
                    return;
                }
                if (Date.now() - started >= timeoutMs) {
                    resolve(false);
                    return;
                }
                setTimeout(tick, 25);
            }
            tick();
        });
    }

    // Robot operating state is authoritative from the backend. The frontend
    // never infers "simulation" from a dropped connection or an API error — a
    // physical failure must never be presented as a successful simulated session.
    function applyOperatingState(os) {
        if (!os) return;
        const sim = os.simulation_enabled === true || os.state === 'SIMULATION';
        state.connection.operating = os;
        state.connection.state = os.state || (sim ? 'SIMULATION' : 'PHYSICAL_NOT_READY');
        state.connection.connected = !!os.connected;
        state.connection.simulation = sim;
        state.connection.motionReady = os.state === 'PHYSICAL_READY' || sim;
        state.connection.faulted = os.state === 'FAULT';
        renderRobotState();
    }

    function renderRobotState() {
        const text = $('y65RobotStateText');
        const dot = $('y65RobotStateDot');
        const label = {
            PHYSICAL_READY: 'Robot: Connected · Ready',
            PHYSICAL_NOT_READY: 'Robot: Not ready',
            SIMULATION: 'Robot: SIMULATION',
            FAULT: 'Robot: FAULT',
            UNKNOWN: 'Robot: Unknown'
        }[state.connection.state] || 'Robot: Unknown';
        if (text) {
            text.textContent = label;
            text.dataset.robotState = state.connection.state || 'UNKNOWN';
        }
        if (dot) {
            dot.classList.toggle('offline', state.connection.state !== 'PHYSICAL_READY' && !state.connection.simulation);
            dot.classList.toggle('sim', !!state.connection.simulation);
            dot.classList.toggle('fault', !!state.connection.faulted);
        }
    }

    async function refreshRobotHealth() {
        try {
            const response = await fetch('/robot/state', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            // On an unexpected payload shape, degrade to FAULT/UNKNOWN, not simulation.
            applyOperatingState(data.operating_state || {
                connected: !!data.connected,
                simulation_enabled: !!data.simulation_enabled,
                state: data.simulation_enabled ? 'SIMULATION' : (data.connected ? 'PHYSICAL_NOT_READY' : 'UNKNOWN')
            });
            return data;
        } catch (error) {
            // API/network failure must NOT silently become simulation.
            state.connection.connected = false;
            state.connection.simulation = false;
            state.connection.motionReady = false;
            state.connection.faulted = true;
            state.connection.state = 'UNKNOWN';
            renderRobotState();
            return null;
        }
    }

    function getLiveTeachingState() {
        try {
            return window.nursingVitalsMonitorInstance?.getTeachingLiveState?.() || {};
        } catch (error) {
            return {};
        }
    }

    function syncVitalsFromTeachingState() {
        if (state.uiMode === 'SETUP' && !window.currentMassageSession) {
            state.vitals = { ...DEFAULT_VITALS };
            state.instructor.scenario = {
                ...DEFAULT_SUBJECTIVE,
                presetActive: 'baseline'
            };
            state.instructor.presetActive = 'baseline';
            return;
        }

        const live = getLiveTeachingState();
        const vitals = live.vitals || live.targetVitals || DEFAULT_VITALS;
        state.vitals = {
            hr: Math.round(clamp(vitals.hr ?? DEFAULT_VITALS.hr, 30, 220)),
            sbp: Math.round(clamp(vitals.sbp ?? DEFAULT_VITALS.sbp, 60, 240)),
            dbp: Math.round(clamp(vitals.dbp ?? DEFAULT_VITALS.dbp, 30, 160)),
            rr: Math.round(clamp(vitals.rr ?? DEFAULT_VITALS.rr, 4, 60)),
            spo2: Math.round(clamp(vitals.spo2 ?? DEFAULT_VITALS.spo2, 70, 100))
        };

        const subjective = live.subjective || DEFAULT_SUBJECTIVE;
        state.instructor.scenario = {
            pain: Number(subjective.pain ?? DEFAULT_SUBJECTIVE.pain),
            anxiety: Number(subjective.anxiety ?? DEFAULT_SUBJECTIVE.anxiety),
            comfort: Number(subjective.comfort ?? DEFAULT_SUBJECTIVE.comfort),
            presetActive: live.activePresetId || state.instructor.scenario.presetActive || 'baseline'
        };
        state.instructor.presetActive = state.instructor.scenario.presetActive;
    }

    function updateSessionCountdown() {
        const session = window.currentMassageSession;
        if (!session || state.uiMode === 'SETUP') {
            state.session.remainingSec = 0;
            return;
        }
        state.session.totalSec = session.totalSec;
        state.session.remainingSec = session.getRemainingSec();
    }

    function updateSessionDetails() {
        const modeText = $('sessionModeText');
        const intensityText = $('sessionIntensityText');
        const durationText = $('sessionDurationText');
        const modeLabels = { 1: 'Push Up / 向上推', 2: 'Wave Push / 波浪推', 3: 'Spiral Press / 螺旋按', 4: 'Knead / 揉捏' };
        if (modeText) modeText.textContent = modeLabels[state.massage.mode] || 'Knead / 揉捏';
        if (intensityText) intensityText.textContent = INTENSITY_TEXT[state.massage.intensity] || '中';
        if (durationText) durationText.textContent = `${state.massage.durationMin} min`;
    }

    function resetTeachingVisualsToSetupBaseline() {
        state.vitals = { ...DEFAULT_VITALS };
        state.instructor.scenario = {
            ...DEFAULT_SUBJECTIVE,
            presetActive: 'baseline'
        };
        state.instructor.presetActive = 'baseline';

        const monitor = window.nursingVitalsMonitorInstance;
        if (monitor) {
            try {
                monitor.stopTeachingTimeline?.();
                monitor.setManualMode?.(true);
                monitor.setVitalsFreeze?.(true);
                monitor.applyTeachingPreset?.({
                    id: 'baseline',
                    targets: { ...DEFAULT_VITALS },
                    subjective: { ...DEFAULT_SUBJECTIVE },
                    cues: { ...SETUP_BASELINE_CUES },
                    useBase: true
                });
            } catch (error) {
                console.warn('[stable-app] failed to reset teaching visuals:', error);
            }
        }

        window.Year65UI?.resetVitalsAndExpressionBaseline?.(DEFAULT_VITALS);
    }

    function syncYear65UI() {
        syncVitalsFromTeachingState();
        updateSessionCountdown();
        updateSessionDetails();
        window.APP_STATE = state;
        if (window.Year65UI?.renderAll) {
            window.Year65UI.renderAll(state);
        }
        const tag = $('y65DrawerModeTag');
        if (tag) tag.textContent = state.uiMode;
    }

    window.syncYear65UI = syncYear65UI;
    window.APP_STATE = state;

    async function sendRobotStart(command) {
        // Decide mode from the backend-authoritative operating state only.
        const conn = state.connection;
        if (conn.simulation) {
            // Explicit simulation teaching mode: the session may start, and the
            // UI keeps showing SIMULATION persistently.
            return { ok: true, simulation: true, message: 'Simulation teaching session' };
        }
        if (conn.state !== 'PHYSICAL_READY') {
            // Robot not connected / not ready / faulted: FAIL CLOSED. Do not
            // report a successful start when no real robot will move.
            const reason = conn.state === 'FAULT' ? 'robot faulted' : 'robot unavailable or not ready';
            return { ok: false, error: `Cannot start: ${reason}`, reason: conn.state };
        }
        if (!window.RobotController?.sendRobotCommand) {
            return { ok: false, error: 'RobotController unavailable' };
        }
        const payload = {
            mode: MODE_TO_API[command.mode] || 'knead',
            intensity: INTENSITY_TEXT[command.intensity] || '中',
            duration: Math.max(1, Math.round(command.durationMin * 60)),
            force_assist: false
        };
        const ok = await window.RobotController.sendRobotCommand('start', payload, {});
        return { ok: !!ok, simulation: false };
    }

    async function sendRobotControl(endpoint) {
        const conn = state.connection;
        // Control ops are no-ops that succeed only in simulation; in physical
        // mode they must reach the robot, and when the robot is not usable the
        // call must fail (never silently "true").
        if (conn.simulation) return true;
        if (conn.state === 'UNKNOWN' || conn.state === 'FAULT') return false;
        if (!window.RobotController?.sendRobotCommand) return false;
        return window.RobotController.sendRobotCommand(endpoint);
    }

    class TeachingMassageSession {
        constructor(command) {
            this.command = { ...command };
            this.totalSec = Math.max(60, Math.round(Number(command.durationMin || 5) * 60));
            this.startedAt = 0;
            this.pausedAt = 0;
            this.pausedMs = 0;
            this.isPaused = false;
            this.ended = false;
            this._timer = null;
            this._stopInFlight = false;
        }

        getElapsedMs() {
            if (!this.startedAt) return 0;
            const pausedNow = this.isPaused && this.pausedAt ? Date.now() - this.pausedAt : 0;
            return Math.max(0, Date.now() - this.startedAt - this.pausedMs - pausedNow);
        }

        getRemainingSec() {
            return Math.max(0, this.totalSec - Math.floor(this.getElapsedMs() / 1000));
        }

        async start() {
            const robotResult = await sendRobotStart(this.command);
            if (!robotResult.ok) {
                throw new Error(robotResult.error || 'Robot did not accept command');
            }
            this.startedAt = Date.now();
            this._timer = setInterval(() => {
                if (!this.ended && !this.isPaused && this.getRemainingSec() <= 0) {
                    void this.stop('completed');
                }
                syncYear65UI();
            }, 1000);

            state.uiMode = 'RUNNING';
            state.session.totalSec = this.totalSec;
            state.session.startedAt = this.startedAt;
            state.session.pausedAt = 0;
            state.session.pausedMs = 0;
            window.currentMassageSession = this;
            window.dispatchEvent(new CustomEvent('massageSessionStarted', {
                detail: {
                    command: this.command,
                    simulation: !!robotResult.simulation
                }
            }));
            syncYear65UI();
            if (robotResult.simulation) {
                addSystemMessage('Robot not connected. Virtual patient session is running in simulation mode.', 'warning');
            }
        }

        async pause() {
            if (this.ended || this.isPaused) return;
            const ok = await sendRobotControl('pause');
            if (!ok) throw new Error('Robot pause failed');
            this.isPaused = true;
            this.pausedAt = Date.now();
            state.uiMode = 'PAUSED';
            window.dispatchEvent(new CustomEvent('massageSessionPaused', { detail: { reason: 'soft_stop' } }));
            syncYear65UI();
        }

        async resume() {
            if (this.ended || !this.isPaused) return;
            const ok = await sendRobotControl('resume');
            if (!ok) throw new Error('Robot resume failed');
            this.pausedMs += Math.max(0, Date.now() - this.pausedAt);
            this.pausedAt = 0;
            this.isPaused = false;
            state.uiMode = 'RUNNING';
            window.dispatchEvent(new CustomEvent('massageSessionResumed', { detail: { reason: 'manual_resume' } }));
            syncYear65UI();
        }

        async stop(reason = 'manual') {
            if (this._stopInFlight) return;
            this._stopInFlight = true;
            window.dispatchEvent(new CustomEvent('massageSessionEndRequested', { detail: { reason } }));
            try {
                await sendRobotControl('stop');
            } catch (error) {
                console.warn('[stable-app] robot stop failed:', error);
            }
            this.ended = true;
            if (this._timer) {
                clearInterval(this._timer);
                this._timer = null;
            }
            state.uiMode = 'SETUP';
            state.session.remainingSec = 0;
            state.session.totalSec = 0;
            window.currentMassageSession = null;
            window.dispatchEvent(new CustomEvent('massageSessionEnded', { detail: { reason } }));
            resetTeachingVisualsToSetupBaseline();
            this._stopInFlight = false;
            syncYear65UI();
        }
    }

    Object.defineProperty(window, 'currentMassageSession', {
        configurable: true,
        get() {
            return window.__stableCurrentMassageSession || null;
        },
        set(value) {
            window.__stableCurrentMassageSession = value || null;
        }
    });

    async function startMassage() {
        if (window.currentMassageSession) {
            addSystemMessage('A massage session is already running.', 'warning');
            return;
        }
        try {
            await refreshRobotHealth();
            const session = new TeachingMassageSession(state.massage);
            await session.start();
            voiceSetupSnapshot = null;
            voiceSetupProgress = null;
            toggleStudentDrawer(false);
            hideVoiceSetupBanner();
        } catch (error) {
            addSystemMessage(`Unable to start massage: ${error.message || error}`, 'error');
            state.uiMode = 'SETUP';
            window.currentMassageSession = null;
            syncYear65UI();
        }
    }

    async function pauseOrResumeSession() {
        const session = window.currentMassageSession;
        if (!session) return;
        try {
            if (session.isPaused) await session.resume();
            else await session.pause();
        } catch (error) {
            addSystemMessage(error.message || 'Pause/resume failed', 'error');
        }
    }

    async function stopSession(reason = 'manual') {
        const session = window.currentMassageSession;
        if (!session) {
            state.uiMode = 'SETUP';
            state.session.remainingSec = 0;
            state.session.totalSec = 0;
            resetTeachingVisualsToSetupBaseline();
            syncYear65UI();
            return;
        }
        await session.stop(reason);
    }

    function setMassageConfig(partialOrMode, intensity, durationMin) {
        if (typeof partialOrMode === 'object') {
            state.massage = { ...state.massage, ...partialOrMode };
        } else {
            state.massage.mode = Number(partialOrMode) || state.massage.mode;
            if (intensity) state.massage.intensity = intensity;
            if (durationMin) state.massage.durationMin = Number(durationMin) || state.massage.durationMin;
        }
        state.massage.mode = clamp(state.massage.mode, 1, 4);
        state.massage.durationMin = clamp(state.massage.durationMin, 1, 30);
        syncYear65UI();
    }

    function toggleStudentDrawer(open) {
        const drawer = $('y65StudentDrawer');
        const mask = $('y65StudentMask');
        const shouldOpen = open ?? !drawer?.classList.contains('open');
        drawer?.classList.toggle('open', shouldOpen);
        mask?.classList.toggle('open', shouldOpen);
        mask?.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    }

    function captureVoiceSetupSnapshot() {
        if (voiceSetupSnapshot) return;
        voiceSetupSnapshot = {
            massage: { ...state.massage },
            quickStart: !!$('quickStartModeToggle')?.checked
        };
    }

    function isVoiceSetupActive() {
        return !!voiceSetupSnapshot || !!$('y65StudentDrawer')?.classList.contains('open');
    }

    function showVoiceSetupBanner() {
        $('voiceSetupBanner')?.classList.remove('hidden');
    }

    function hideVoiceSetupBanner() {
        $('voiceSetupBanner')?.classList.add('hidden');
    }

    function cancelVoiceMassageSetup() {
        const snapshot = voiceSetupSnapshot;
        voiceSetupSnapshot = null;
        voiceSetupProgress = null;

        if (snapshot) {
            const toggle = $('quickStartModeToggle');
            if (toggle) toggle.checked = snapshot.quickStart;
            setMassageConfig(snapshot.massage);
        } else {
            syncYear65UI();
        }

        toggleStudentDrawer(false);
        const title = $('voiceSetupTitle');
        const prompt = $('voiceSetupPrompt');
        if (title) title.textContent = 'ASR listening';
        if (prompt) prompt.textContent = 'Voice setup cancelled. Say "massage setting" to start again.';
        resetAsrWakePhraseFragments();
        hideVoiceSetupBanner();
        announce('Voice setup cancelled');
    }

    function openPinModal() {
        const modal = $('y65PinModal');
        modal?.classList.add('open');
        const input = $('y65PinInput');
        if (input) {
            input.value = '';
            input.focus();
        }
        const err = $('y65PinError');
        if (err) err.classList.remove('show');
    }

    function closePinModal() {
        $('y65PinModal')?.classList.remove('open');
    }

    function unlockInstructor() {
        const configuredPin = window.INSTRUCTOR_PIN || localStorage.getItem('instructorPin') || '1234';
        const input = $('y65PinInput');
        if ((input?.value || '') === configuredPin) {
            closePinModal();
            window.instructorTools?.openTeachingOverlay?.();
            return;
        }
        const err = $('y65PinError');
        if (err) err.classList.add('show');
    }

    function bindStudentControls() {
        $('y65StudentHandle')?.addEventListener('click', () => toggleStudentDrawer(true));
        $('y65StudentMask')?.addEventListener('click', () => toggleStudentDrawer(false));
        $('y65DrawerCollapseBtn')?.addEventListener('click', () => toggleStudentDrawer(false));

        $('y65MassagePanelRoot')?.addEventListener('click', (event) => {
            const target = event.target.closest('[data-action]');
            if (!target) return;
            const action = target.dataset.action;
            if (action === 'setMode') setMassageConfig({ mode: Number(target.dataset.mode) || 4 });
            if (action === 'setIntensity') setMassageConfig({ intensity: target.dataset.intensity || 'mid' });
            if (action === 'setDuration') setMassageConfig({ durationMin: Number(target.dataset.duration) || 5 });
            if (action === 'toggleAutoRead') setMassageConfig({ autoRead: !state.massage.autoRead });
            if (action === 'startMassage') void startMassage();
        });

        const frontStopBtn = $('y65FrontStopBtn');
        if (frontStopBtn && !frontStopBtn.dataset.stopBound) {
            frontStopBtn.dataset.stopBound = 'true';
            frontStopBtn.addEventListener('click', () => void stopSession('manual'));
        }
        $('btnStudentStop')?.addEventListener('click', () => void stopSession('manual'));

        $('quickStartModeToggle')?.addEventListener('change', () => {
            if ($('quickStartModeToggle')?.checked) setMassageConfig({ mode: 4, intensity: 'mid', durationMin: 5 });
            syncYear65UI();
        });

        const asrToggle = $('y65AsrToggle');
        if (asrToggle && !asrToggle.dataset.asrBound) {
            asrToggle.dataset.asrBound = 'true';
            asrToggle.style.cursor = 'pointer';
            const toggleAsr = () => {
                if (window.sttService?.isActive?.()) void stopVoiceRecognition();
                else void startVoiceRecognition();
            };
            asrToggle.addEventListener('click', toggleAsr);
            asrToggle.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleAsr();
                }
            });
        }
    }

    function bindInstructorControls() {
        $('y65InstructorEntry')?.addEventListener('click', openPinModal);
        $('y65PinCancel')?.addEventListener('click', closePinModal);
        $('y65PinSubmit')?.addEventListener('click', unlockInstructor);
        $('y65PinInput')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') unlockInstructor();
            if (event.key === 'Escape') closePinModal();
        });
    }

    function bindSettingsControls() {
        const panel = $('settingsPanel');
        const overlay = $('overlay');
        function setOpen(open) {
            panel?.classList.toggle('open', open);
            overlay?.classList.toggle('active', open);
            $('settingsBtn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        $('settingsBtn')?.addEventListener('click', () => setOpen(true));
        $('closeSettings')?.addEventListener('click', () => setOpen(false));
        overlay?.addEventListener('click', () => setOpen(false));

        const normalizeSettingLanguage = (value, fallback = 'zh') => (value === 'en' || value === 'zh') ? value : fallback;
        const languageSelect = $('languageSelect');
        if (languageSelect) {
            const initialLanguage = normalizeSettingLanguage(localStorage.getItem('language'), normalizeSettingLanguage(languageSelect.value));
            languageSelect.value = initialLanguage;
            localStorage.setItem('language', initialLanguage);
            document.documentElement.lang = initialLanguage;
            languageSelect.addEventListener('change', (event) => {
                const language = normalizeSettingLanguage(event.target.value);
                localStorage.setItem('language', language);
                document.documentElement.lang = language;
                event.target.value = language;
            });
        }
        const voiceLanguageSelect = $('voiceLanguageSelect');
        if (voiceLanguageSelect) {
            const initialVoiceLanguage = normalizeSettingLanguage(localStorage.getItem('voiceLanguage'), normalizeSettingLanguage(voiceLanguageSelect.value));
            voiceLanguageSelect.value = initialVoiceLanguage;
            localStorage.setItem('voiceLanguage', initialVoiceLanguage);
            voiceLanguageSelect.addEventListener('change', (event) => {
                const language = normalizeSettingLanguage(event.target.value);
                localStorage.setItem('voiceLanguage', language);
                event.target.value = language;
                updateAsrLanguageBadge();
                if (window.sttService?.isActive?.()) {
                    window.sttService.setLanguage?.(getAsrLanguage());
                }
            });
        }
        const wakeToggle = $('wakeWordToggle');
        if (wakeToggle && !wakeToggle.dataset.stableBound) {
            wakeToggle.dataset.stableBound = 'true';
            const savedWake = localStorage.getItem('wakeWordEnabled');
            const migratedDefaultOn = localStorage.getItem(WAKE_WORD_DEFAULT_ON_MIGRATION_KEY) === 'true';
            if (savedWake === null) {
                wakeToggle.checked = true;
                localStorage.setItem('wakeWordEnabled', 'true');
            } else if (savedWake === 'false' && !migratedDefaultOn) {
                wakeToggle.checked = true;
                localStorage.setItem('wakeWordEnabled', 'true');
                localStorage.setItem(WAKE_WORD_DEFAULT_ON_MIGRATION_KEY, 'true');
            } else {
                wakeToggle.checked = savedWake === 'true';
            }
            wakeToggle.addEventListener('change', () => {
                localStorage.setItem(WAKE_WORD_DEFAULT_ON_MIGRATION_KEY, 'true');
                localStorage.setItem('wakeWordEnabled', wakeToggle.checked ? 'true' : 'false');
                if (wakeToggle.checked) {
                    void startVoiceRecognition({ auto: true });
                } else {
                    void stopVoiceRecognition();
                }
            });
        }
    }

    function getAsrLanguage() {
        const voiceLang = localStorage.getItem('voiceLanguage') || $('voiceLanguageSelect')?.value || 'zh';
        return voiceLang === 'en' ? 'en-US' : 'zh-HK';
    }

    function isWakeWordEnabled() {
        const wakeToggle = $('wakeWordToggle');
        return wakeToggle ? wakeToggle.checked : false;
    }

    function scheduleWakeWordAutoStart() {
        window.setTimeout(() => {
            if (isWakeWordEnabled() && !window.sttService?.isActive?.()) {
                void startVoiceRecognition({ auto: true });
            }
        }, 650);
    }

    function updateAsrLanguageBadge() {
        const badge = $('y65AsrLangText');
        if (badge) badge.textContent = getAsrLanguage() === 'en-US' ? 'ASR EN' : 'ASR 粵';
    }

    function normalizeSpokenNumberToken(value) {
        const homophones = {
            壹: '一', 日: '一', 逸: '一', 乙: '一',
            倆: '兩', 俩: '兩', 易: '二', 以: '二', 耳: '二',
            叁: '三', 參: '三', 参: '三', 山: '三', 衫: '三', 杉: '三', 生: '三',
            肆: '四', 是: '四', 事: '四', 市: '四', 試: '四', 试: '四', 死: '四',
            伍: '五', 午: '五', 唔: '五', 吾: '五',
            陸: '六', 陆: '六', 鹿: '六', 綠: '六', 绿: '六', 路: '六',
            柒: '七', 出: '七',
            捌: '八', 百: '八',
            玖: '九', 久: '九', 狗: '九',
            拾: '十', 實: '十', 实: '十'
        };
        return String(value || '')
            .trim()
            .toLowerCase()
            .split('')
            .map((char) => homophones[char] || char)
            .join('');
    }

    function parseSpokenNumber(value) {
        const raw = normalizeSpokenNumberToken(value);
        const digits = raw.match(/\d+/);
        if (digits) return Number(digits[0]);

        const english = {
            one: 1, won: 1,
            two: 2, to: 2, too: 2,
            three: 3, tree: 3, free: 3,
            four: 4, for: 4, fore: 4,
            five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
            fifteen: 15, twenty: 20, thirty: 30
        };
        if (english[raw]) return english[raw];

        const zh = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
        const tenIndex = raw.indexOf('十');
        if (tenIndex >= 0) {
            const tens = tenIndex === 0 ? 1 : (zh[raw[tenIndex - 1]] || 1);
            const ones = raw[tenIndex + 1] ? (zh[raw[tenIndex + 1]] || 0) : 0;
            return tens * 10 + ones;
        }
        for (const char of raw) {
            if (zh[char]) return zh[char];
        }
        return null;
    }

    function normalizeAsrForMassageCommand(transcript) {
        let text = String(transcript || '').trim();
        if (!text) return '';
        const replacements = [
            [/模食|磨式|魔式|模識|模识|模試|模试|模式式|無式|无式|某式|木式/g, '模式'],
            [/歷道|历道|歷度|历度|力道|力到|利道|粒度|粒道|嚦度|力度度/g, '力度'],
            [/分鍾|分钟|分中|分種|分种|分眾|分众|分鐘鐘|分钟钟/g, '分鐘'],
            [/開始|开始|開市|开市|開時|开时/g, '開始'],
            [/確定|确定|確認|确认/g, '確認']
        ];
        replacements.forEach(([pattern, replacement]) => {
            text = text.replace(pattern, replacement);
        });
        return text;
    }

    function parseVoiceMassageConfig(transcript) {
        const rawText = String(transcript || '').trim();
        const text = normalizeAsrForMassageCommand(rawText);
        const lower = text.toLowerCase();
        const haystack = lower + text + rawText;
        const config = {};

        const modeNumberWords = '[1-4]|one|won|two|to|too|three|tree|free|four|for|fore';
        const chineseModeNumbers = '[1-4一壹日逸乙二兩两倆俩易以耳三叁參参山衫杉生四肆是事市試试死]';
        const modeMatch = lower.match(new RegExp('\\b(?:mode|mod|mood)\\s*(?:number\\s*)?(' + modeNumberWords + ')\\b'))
            || lower.match(new RegExp('\\b(?:option|number)\\s*(' + modeNumberWords + ')\\b'))
            || text.match(new RegExp('模式\\s*(' + chineseModeNumbers + ')'))
            || text.match(new RegExp('第?(' + chineseModeNumbers + ')個?模式'));
        if (modeMatch) {
            config.mode = parseSpokenNumber(modeMatch[1]);
        } else if (/push\s*up|向上推|往上推|上推|推上/.test(haystack)) {
            config.mode = 1;
        } else if (/wave\s*push|波浪推|波浪|波朗推|玻浪推/.test(haystack)) {
            config.mode = 2;
        } else if (/spiral\s*press|螺旋按|螺旋|羅旋按|罗旋按|螺旋壓|螺旋压/.test(haystack)) {
            config.mode = 3;
        } else if (/knead|揉捏|揉按|柔捏|柔按|搓揉|按揉/.test(haystack)) {
            config.mode = 4;
        }

        if (/\b(high|strong|hard|firm|deep|heavy|powerful)\b|大力|重力|深力|力度.*(?:大|強|强|重|深)|強力|强力|加大|加強|加强/.test(haystack)) {
            config.intensity = 'high';
        } else if (/\b(low|lower|light|gentle|soft|easy|mild)\b|細力|细力|小力|少力|輕力|轻力|低力|弱力|力度.*(?:小|少|細|细|低|輕|轻|弱)|減力|减力/.test(haystack)) {
            config.intensity = 'low';
        } else if (/\b(mid|medium|middle|moderate|normal|standard|regular)\b|力度.*(?:中|鐘|钟|忠|宗|終|终)|中等|中力|適中|适中/.test(haystack)) {
            config.intensity = 'mid';
        }

        const durationWords = 'one|won|two|to|too|three|tree|free|four|for|fore|five|six|seven|eight|nine|ten|fifteen|twenty|thirty';
        const chineseDurationNumbers = '一壹日逸乙二兩两倆俩易以耳三叁參参山衫杉生四肆是事市試试死五伍午唔吾六陸陆鹿綠绿路七柒出八捌百九玖久狗十拾實实';
        const durationMatch = lower.match(new RegExp('\\b(?:for\\s+)?(\\d+|' + durationWords + ')\\s*(minutes?|mins?|min)\\b'))
            || text.match(new RegExp('([' + chineseDurationNumbers + '\\d]+)\\s*(分鐘|分鍾|分钟|分中|分種|分种|分眾|分众|分)'));
        if (durationMatch) {
            const duration = parseSpokenNumber(durationMatch[1]);
            if (duration) config.durationMin = duration;
        }

        const hasConfig = Object.keys(config).length > 0;
        let hasStartIntent = /\b(start|begin|confirm|yes|go)\b|開始|确认|確認|可以開始|啟動|启动/.test(haystack);
        const setupOnlyIntent = /\b(setup|settings?)\b|設定|設置|设置/.test(haystack) && !hasConfig && !/\b(confirm|yes|go)\b|確認|确认/.test(haystack);
        if (setupOnlyIntent && !/start\s+massage|開始按摩/.test(haystack)) {
            hasStartIntent = false;
        }

        return { config, hasConfig, hasStartIntent };
    }

    function ensureAudioManager() {
        if (!window.audioManager && typeof window.AudioManager === 'function') {
            try {
                window.audioManager = new window.AudioManager();
            } catch (error) {
                console.warn('[stable-app] unable to initialize audio manager:', error);
            }
        }
        return window.audioManager || null;
    }

    function summarizeVoiceConfig(config) {
        const parts = [];
        const modeLabels = { 1: 'Mode 1', 2: 'Mode 2', 3: 'Mode 3', 4: 'Mode 4' };
        const intensityLabels = { low: 'Low', mid: 'Medium', high: 'High' };
        if (config.mode) parts.push(modeLabels[config.mode] || `Mode ${config.mode}`);
        if (config.intensity) parts.push(`${intensityLabels[config.intensity] || config.intensity} intensity`);
        if (config.durationMin) parts.push(`${config.durationMin} min`);
        return parts.join(' · ');
    }

    function resetVoiceSetupProgress() {
        voiceSetupProgress = {
            mode: false,
            intensity: false,
            durationMin: false
        };
    }

    function markVoiceSetupProgress(config) {
        if (!voiceSetupProgress) resetVoiceSetupProgress();
        ['mode', 'intensity', 'durationMin'].forEach((key) => {
            if (config[key] !== undefined && config[key] !== null) voiceSetupProgress[key] = true;
        });
    }

    function getVoiceSetupMissingFields() {
        if (!voiceSetupProgress) resetVoiceSetupProgress();
        return ['mode', 'intensity', 'durationMin'].filter((key) => !voiceSetupProgress[key]);
    }

    function isVoiceSetupComplete() {
        return getVoiceSetupMissingFields().length === 0;
    }

    function getVoiceSetupGuidanceAsset(field) {
        return {
            mode: 'system.choose_mode',
            intensity: 'system.choose_force',
            durationMin: 'system.choose_duration',
            confirm: 'system.confirm_summary'
        }[field] || null;
    }

    function playVoiceSetupGuidance(field) {
        const assetId = getVoiceSetupGuidanceAsset(field);
        const manager = ensureAudioManager();
        if (!assetId || !manager?.playAsset) return;

        const eventTime = Date.now();
        if (lastVoiceSetupGuidance.assetId === assetId && eventTime - lastVoiceSetupGuidance.at < 1400) return;
        lastVoiceSetupGuidance = { assetId, at: eventTime };
        const token = ++voiceSetupGuidanceToken;
        window.__lastVoiceSetupGuidanceAsset = assetId;
        window.__setupPromptPlaying = true;
        window.__setupAsrAcceptAfter = Math.max(window.__setupAsrAcceptAfter || 0, eventTime + 1800);

        Promise.resolve(manager.playAsset(assetId, {
            priority: window.AudioPriority?.P1 ?? 1,
            ttlMs: 5000,
            interrupt: true,
            eventTime
        })).catch((error) => {
            console.warn('[stable-app] voice setup guidance failed:', assetId, error);
        }).finally(() => {
            if (token !== voiceSetupGuidanceToken) return;
            window.__setupAsrAcceptAfter = Math.max(window.__setupAsrAcceptAfter || 0, Date.now() + 250);
            window.setTimeout(() => {
                if (token !== voiceSetupGuidanceToken) return;
                if (Date.now() >= (window.__setupAsrAcceptAfter || 0)) {
                    window.__setupPromptPlaying = false;
                }
            }, 275);
        });
    }

    function updateVoiceSetupPrompt(summary = '', options = {}) {
        const prompt = $('voiceSetupPrompt');
        if (!prompt) return;
        const next = getVoiceSetupMissingFields()[0];
        const prefix = summary ? `Selected: ${summary}. ` : '';
        const prompts = {
            mode: 'Select massage mode: mode 1, 2, 3, or 4.',
            intensity: 'Select intensity: low, medium, or high.',
            durationMin: 'Select duration: 1 minute, 3 minutes, or 5 minutes.'
        };
        prompt.textContent = next
            ? `${prefix}${prompts[next]}`
            : `Setup complete: ${summarizeVoiceConfig(state.massage)}. Say "start massage" to begin.`;
        if (options.playGuidance) playVoiceSetupGuidance(next || 'confirm');
    }

    function parseVoiceSetupStepConfig(transcript, parsedConfig = {}) {
        if (!isVoiceSetupActive()) return {};
        const next = getVoiceSetupMissingFields()[0];
        const rawText = String(transcript || '').trim();
        const text = normalizeAsrForMassageCommand(rawText);
        const lower = text.toLowerCase();
        const compactChinese = text.replace(/[^\u3400-\u9fff\d]/g, '');
        const config = {};

        if (next === 'mode' && !parsedConfig.mode) {
            const bareModeMatch = lower.match(/^\s*(?:mode\s*)?([1-4]|one|won|two|to|too|three|tree|free|four|for|fore)\s*$/)
                || text.match(/^\s*(?:模式\s*)?([1-4一壹日逸乙二兩两倆俩易以耳三叁參参山衫杉生四肆是事市試试死])\s*$/);
            const mode = bareModeMatch ? parseSpokenNumber(bareModeMatch[1]) : null;
            if (mode >= 1 && mode <= 4) config.mode = mode;
        }

        if (next === 'intensity' && !parsedConfig.intensity) {
            if (/^(high|strong|hard|firm|deep|heavy|powerful)$/i.test(lower) || /^(大|強|强|重|深|大力|強力|强力)$/.test(compactChinese)) {
                config.intensity = 'high';
            } else if (/^(low|lower|light|gentle|soft|easy|mild)$/i.test(lower) || /^(小|少|細|细|輕|轻|低|弱|小力|輕力|轻力)$/.test(compactChinese)) {
                config.intensity = 'low';
            } else if (/^(mid|medium|middle|moderate|normal|standard|regular)$/i.test(lower) || /^(中|鐘|钟|忠|宗|終|终|中等|中力|適中|适中)$/.test(compactChinese)) {
                config.intensity = 'mid';
            }
        }

        if (next === 'durationMin' && !parsedConfig.durationMin) {
            const bareDurationMatch = lower.match(/^\s*([1-9]|one|won|two|to|too|three|tree|free|four|for|fore|five|six|seven|eight|nine|ten)\s*$/)
                || text.match(/^\s*([1-9一壹日逸乙二兩两倆俩易以耳三叁參参山衫杉生四肆是事市試试死五伍午唔吾六陸陆鹿綠绿路七柒出八捌百九玖久狗十拾實实])\s*$/);
            const duration = bareDurationMatch ? parseSpokenNumber(bareDurationMatch[1]) : null;
            if (duration >= 1 && duration <= 30) config.durationMin = duration;
        }

        return config;
    }

    function disableQuickStartForVoiceConfig() {
        const toggle = $('quickStartModeToggle');
        if (toggle?.checked) {
            toggle.checked = false;
        }
    }

    function resetAsrWakePhraseFragments() {
        asrWakePhraseFragments = [];
    }

    function rememberAsrWakePhraseFragment(transcript) {
        const text = String(transcript || '').trim();
        if (!text) return '';
        const now = Date.now();
        asrWakePhraseFragments = asrWakePhraseFragments.filter((item) => now - item.at <= 4500);
        const last = asrWakePhraseFragments[asrWakePhraseFragments.length - 1];
        if (!last || last.text !== text) {
            asrWakePhraseFragments.push({ text, at: now });
        }
        const combined = asrWakePhraseFragments.map((item) => item.text).join(' ');
        window.__lastAsrWakeBuffer = combined;
        return combined;
    }

    function shouldEnterVoiceMassageSetup(transcript) {
        const raw = String(transcript || '').trim();
        window.__lastAsrTranscript = raw;
        if (window.currentMassageSession) {
            window.__lastAsrWakeDecision = { raw, matched: false, reason: 'session-running' };
            return false;
        }
        if (isVoiceSetupActive() && $('y65StudentDrawer')?.classList.contains('open')) {
            window.__lastAsrWakeDecision = { raw, matched: false, reason: 'setup-already-active' };
            return false;
        }
        if (isMassageSetupWakePhrase(raw)) {
            window.__lastAsrWakeDecision = { raw, matched: true, reason: 'direct' };
            resetAsrWakePhraseFragments();
            return true;
        }
        const combined = rememberAsrWakePhraseFragment(raw);
        if (combined && combined !== raw && isMassageSetupWakePhrase(combined)) {
            window.__lastAsrWakeDecision = { raw, combined, matched: true, reason: 'buffer' };
            resetAsrWakePhraseFragments();
            return true;
        }
        window.__lastAsrWakeDecision = { raw, combined, matched: false, reason: 'no-match' };
        return false;
    }

    function enterVoiceMassageSetup() {
        resetAsrWakePhraseFragments();
        resetVoiceSetupProgress();
        captureVoiceSetupSnapshot();
        disableQuickStartForVoiceConfig();
        toggleStudentDrawer(true);
        const title = $('voiceSetupTitle');
        if (title) title.textContent = 'ASR massage setup';
        updateVoiceSetupPrompt('', { playGuidance: true });
        showVoiceSetupBanner();
        announce('ASR massage setup ready');
    }

    function normalizeAsrForWakePhrase(transcript) {
        let text = String(transcript || '').trim().toLowerCase();
        if (!text) return '';
        const replacements = [
            [/按\s*[摸磨魔模摩]|安\s*[摸磨魔模摩]|暗\s*[摸磨魔模摩]|案\s*[摸磨魔模摩]|岸\s*[摸磨魔模摩]|按\s*末|按摩摩/g, '按摩'],
            [/設\s*[頂丁停訂釘制置定]|社\s*[定頂丁停訂聽]|涉\s*[定頂丁停訂]|舌\s*[定頂丁停訂]|石\s*[定頂丁停訂]|實\s*[定頂丁停訂]|識\s*[定頂丁停訂]|识\s*[定顶丁停订]|色\s*[定頂丁停訂]|息\s*[定頂丁停訂]|惜\s*[定頂丁停訂]|錫\s*[定頂丁停訂]|失\s*[定頂丁停訂]|食\s*[定頂丁停訂]|攝\s*[定頂丁停訂]|摄\s*[定顶丁停订]|設定定/g, '設定'],
            [/设定|设頂|设顶|设置|設置/g, '設定'],
            [/開時|開市|開事|开始/g, '開始'],
            [/模食|磨式|魔式|模識|模识|模試|模试|模式式|無式|无式|某式|木式/g, '模式'],
            [/\bmessage\b/g, 'massage'],
            [/\bmassaging\b/g, 'massage'],
            [/\bmass\s+age\b/g, 'massage'],
            [/\bmassage\s+set\s+up\b/g, 'massage setup'],
            [/\bmassage\s+sit(?:ting)?\b/g, 'massage setting'],
            [/\bmassage\s+seat(?:ing)?\b/g, 'massage setting'],
            [/\bmassage\s+get(?:ting)?\b/g, 'massage setting']
        ];
        replacements.forEach(([pattern, replacement]) => {
            text = text.replace(pattern, replacement);
        });
        return text;
    }

    function hasFuzzyChineseMassageSetting(chineseCompact) {
        if (!chineseCompact) return false;
        const massagePattern = /按摩|按摸|按磨|按魔|按模|安摩|安摸|安磨|暗摩|暗摸|案摩|案摸|岸摩|按末/;
        const settingPattern = /設定|设定|設置|设置|設頂|設丁|設停|設訂|社定|社頂|社聽|涉定|舌定|石定|石頂|實定|實頂|識定|識頂|色定|息定|惜定|錫定|失定|食定|攝定|摄定/;
        const massageMatch = chineseCompact.match(massagePattern);
        const settingMatch = chineseCompact.match(settingPattern);
        if (!massageMatch || !settingMatch) return false;
        return Math.abs(settingMatch.index - massageMatch.index) <= 14;
    }

    function hasFuzzyEnglishMassageSetting(englishCompact, normalized) {
        if (!englishCompact) return false;
        const exactPhrases = [
            'massagesetting',
            'massagesettings',
            'massagesetup',
            'messagesetting',
            'messagesettings',
            'messagesetup',
            'massagesitting',
            'messagesitting',
            'massageseating',
            'massagegetting',
            'startsetup',
            'opensetup'
        ];
        if (exactPhrases.some((phrase) => englishCompact.includes(phrase))) return true;
        return /\b(massage|message)\b/.test(normalized)
            && /\b(setting|settings|setup|set\s*up|sitting|seating|getting)\b/.test(normalized);
    }

    function isMassageSetupWakePhrase(transcript) {
        const normalized = normalizeAsrForWakePhrase(transcript);
        const compact = normalized.replace(/[\s.,!?;:'"()[\]{}\-_/\\|，。！？、；：「」『』（）【】《》]+/g, '');
        const englishCompact = compact.replace(/[^a-z]/g, '');
        const chineseCompact = compact.replace(/[^\u3400-\u9fff]/g, '');
        return hasFuzzyEnglishMassageSetting(englishCompact, normalized)
            || [
                '按摩設定',
                '設定按摩',
                '開始設定',
                '開始按摩設定',
                '設定模式',
                '按摩模式',
                '進入按摩',
                '轉換成按摩'
            ].some((phrase) => chineseCompact.includes(phrase))
            || hasFuzzyChineseMassageSetting(chineseCompact);
    }

    function isVoiceSetupCancelIntent(transcript) {
        const text = String(transcript || '').trim();
        const lower = text.toLowerCase();
        return /\b(cancel|cancel setup|cancel selection|clear|reset|undo|abort|never mind|nevermind|close setup|exit setup|quit setup)\b/.test(lower)
            || /取消|唔要|不要|不用|重設|重置|清除|關閉設定|关闭设置|退出設定|退出设置/.test(text);
    }

    function applyVoiceMassageSetup(transcript) {
        const parsed = parseVoiceMassageConfig(transcript);
        const activeSetup = isVoiceSetupActive();
        const stepConfig = activeSetup ? parseVoiceSetupStepConfig(transcript, parsed.config) : {};
        const config = { ...parsed.config, ...stepConfig };
        const hasConfig = Object.keys(config).length > 0;
        if (!hasConfig && !parsed.hasStartIntent) return false;

        if (window.currentMassageSession && hasConfig) {
            addSystemMessage('End the current massage session before changing massage settings.', 'warning');
            return true;
        }

        if (hasConfig) {
            disableQuickStartForVoiceConfig();
            setMassageConfig(config);
            if (activeSetup) markVoiceSetupProgress(config);
            const summary = summarizeVoiceConfig(config);
            if (activeSetup) {
                updateVoiceSetupPrompt(summary, { playGuidance: true });
                showVoiceSetupBanner();
            } else {
                hideVoiceSetupBanner();
            }
            announce(`Voice setup: ${summary}`);
        }

        if (parsed.hasStartIntent) {
            if (activeSetup && !isVoiceSetupComplete()) {
                updateVoiceSetupPrompt('', { playGuidance: true });
                showVoiceSetupBanner();
                announce('Please finish mode, intensity, and duration before starting.');
                return true;
            }
            voiceSetupSnapshot = null;
            voiceSetupProgress = null;
            hideVoiceSetupBanner();
            void startMassage();
        }
        return true;
    }

    function handleTranscript(text) {
        const normalized = String(text || '').trim();
        if (!normalized) return;
        $('asrDebugText') && ($('asrDebugText').textContent = normalized);
        const lower = normalized.toLowerCase();

        if (shouldEnterVoiceMassageSetup(normalized)) {
            enterVoiceMassageSetup();
            return;
        }

        if (isVoiceSetupActive() && isVoiceSetupCancelIntent(normalized)) {
            cancelVoiceMassageSetup();
            return;
        }

        if (/pause|hold|soft stop|暫停|停一停/.test(lower)) {
            void pauseOrResumeSession();
            return;
        }
        if (/end session|endsession|finish|quit|stop massage|\bstop\b|停止療程|停止按摩|停止|結束|完結|停機/.test(lower)) {
            void stopSession('voice_endsession');
            return;
        }
        if (/resume|continue|繼續/.test(lower)) {
            const session = window.currentMassageSession;
            if (session?.isPaused) void session.resume();
            return;
        }
        if (applyVoiceMassageSetup(normalized)) {
            return;
        }
    }

    async function startVoiceRecognition(options = {}) {
        if (!window.sttService) {
            addSystemMessage('STT service is not ready yet.', 'warning');
            return false;
        }
        if (window.sttService.isActive?.()) return true;
        try {
            await window.sttService.start(getAsrLanguage());
            if (!window.sttService.isActive?.()) {
                throw new Error('No STT provider could start listening');
            }
            return true;
        } catch (error) {
            const reason = error?.message || String(error || 'Unknown ASR error');
            const prefix = options?.auto ? 'Wake word ASR did not start' : 'ASR did not start';
            addSystemMessage(`${prefix}: ${reason}`, 'warning');
            return false;
        }
    }

    async function stopVoiceRecognition() {
        if (!window.sttService) return;
        try {
            await window.sttService.stop();
        } catch (error) {
            addSystemMessage(`ASR stop failed: ${error?.message || error}`, 'warning');
        }
    }

    function bindSessionVisualReset() {
        if (window.__stableSessionVisualResetBound) return;
        window.__stableSessionVisualResetBound = true;
        window.addEventListener('massageSessionEnded', () => {
            window.setTimeout(() => {
                if (window.currentMassageSession) return;
                state.uiMode = 'SETUP';
                state.session.remainingSec = 0;
                state.session.totalSec = 0;
                resetTeachingVisualsToSetupBaseline();
                syncYear65UI();
            }, 0);
        });
    }

    function bindSttService() {
        if (!window.sttService || window.__stableSttBound) return;
        window.__stableSttBound = true;
        sttUnsubscribers = [
            window.sttService.onResult?.((event) => handleTranscript(event.text || event.transcript || '')),
            window.sttService.onPartial?.((event) => {
                const text = event.text || event.transcript || '';
                const debug = $('asrDebugText');
                if (debug && text) debug.textContent = text;
                if (shouldEnterVoiceMassageSetup(text)) {
                    enterVoiceMassageSetup();
                    return;
                }
            }),
            window.sttService.onStarted?.(() => {
                $('asrStatusDot')?.classList.add('active');
                if (isVoiceSetupActive()) showVoiceSetupBanner();
            }),
            window.sttService.onStopped?.(() => {
                $('asrStatusDot')?.classList.remove('active');
                hideVoiceSetupBanner();
            }),
            window.sttService.onError?.((event) => addSystemMessage(event.error || 'STT error', 'warning'))
        ].filter(Boolean);
    }

    function initTeachingModules() {
        const vitalsMonitor = window.nursingVitalsMonitorInstance || window.NursingVitalsMonitor?.createVitalsMonitor?.({
            teachingVitalsPanel: $('teachingVitalsPanel'),
            teachingCuesPanel: $('teachingCuesPanel')
        });
        if (vitalsMonitor) window.nursingVitalsMonitorInstance = vitalsMonitor;

        if (window.NursingInstructorTools?.initInstructorTools && !window.instructorTools) {
            window.instructorTools = window.NursingInstructorTools.initInstructorTools({
                showToast,
                teachingOverlay: $('teachingOverlay'),
                teachingOverlayMask: $('teachingOverlayMask'),
                teachingOverlayClose: $('teachingOverlayClose'),
                teachingEventGrid: $('teachingEventGrid'),
                teachingFineTuneGrid: $('teachingFineTuneGrid'),
                teachingPainInput: $('teachingPainInput'),
                teachingAnxietyInput: $('teachingAnxietyInput'),
                teachingComfortInput: $('teachingComfortInput'),
                teachingPainValue: $('teachingPainValue'),
                teachingAnxietyValue: $('teachingAnxietyValue'),
                teachingComfortValue: $('teachingComfortValue'),
                teachingTimelineList: $('teachingTimelineList'),
                teachingAddStepBtn: $('teachingAddStepBtn'),
                teachingAutoExpressionToggle: $('teachingAutoExpressionToggle'),
                teachingVitalsPanel: $('teachingVitalsPanel'),
                teachingCuesPanel: $('teachingCuesPanel'),
                manualHrSlider: $('manualHrSlider'),
                manualSbpSlider: $('manualSbpSlider'),
                manualDbpSlider: $('manualDbpSlider'),
                manualRrSlider: $('manualRrSlider'),
                manualSpo2Slider: $('manualSpo2Slider'),
                manualHrValue: $('manualHrValue'),
                manualSbpValue: $('manualSbpValue'),
                manualDbpValue: $('manualDbpValue'),
                manualRrValue: $('manualRrValue'),
                manualSpo2Value: $('manualSpo2Value'),
                manualVitalsResetBtn: $('manualVitalsResetBtn'),
                manualVitalsApplyBtn: $('manualVitalsApplyBtn'),
                timelineResetBtn: $('timelineResetBtn'),
                timelineApplyBtn: $('timelineApplyBtn'),
                manualPresetGrid: $('manualPresetGrid'),
                teachingMetricsResetBtn: $('teachingMetricsResetBtn'),
                teachingMetricsApplyBtn: $('teachingMetricsApplyBtn'),
                timelineStatus: $('timelineStatus')
            });
        }
    }

    function hideLoading() {
        const loading = $('loadingOverlay');
        if (loading) loading.style.display = 'none';
        $('y65LoadingSkeleton')?.setAttribute('aria-hidden', 'true');
    }

    let robotConnectInFlight = false;

    async function connectRobotFromUI() {
        if (robotConnectInFlight) return;             // cannot be spammed into concurrent attempts
        const ipInput = $('robotIpInput');
        const btn = $('robotConnectBtn');
        const ip = ipInput ? ipInput.value.trim() : '';
        if (!window.RobotController?.connectRobot) {
            addSystemMessage('Robot controls unavailable.', 'warning');
            return;
        }
        robotConnectInFlight = true;
        if (btn) { btn.disabled = true; btn.dataset.wasLabel = btn.textContent; btn.textContent = 'Connecting…'; }
        try {
            const res = await window.RobotController.connectRobot(ip);
            if (res.responseOk && res.data?.ok) {
                addSystemMessage('Robot connected.', 'info');
            } else {
                const code = res.data?.detail?.error_code
                    || (res.data?.detail && res.data.detail.message)
                    || res.detail
                    || `HTTP ${res.status}`;
                const hint = String(code).match(/operator token/i)
                    ? ' For LAN access set window.ROBOT_OPERATOR_TOKEN in the console.'
                    : '';
                addSystemMessage(`Robot connect failed: ${code}${hint}`, 'error');
            }
        } finally {
            await refreshRobotHealth();
            syncYear65UI();
            robotConnectInFlight = false;
            if (btn) { btn.disabled = false; btn.textContent = btn.dataset.wasLabel || 'Connect'; }
        }
    }

    async function disconnectRobotFromUI() {
        if (robotConnectInFlight) return;
        const btn = $('robotDisconnectBtn');
        const running = window.currentMassageSession && !window.currentMassageSession.ended
            && !window.currentMassageSession.simulationOnly;
        if (running && !window.confirm?.('A session is active. Disconnect will attempt a safe stop first. Continue?')) {
            return;
        }
        robotConnectInFlight = true;
        if (btn) btn.disabled = true;
        try {
            // If a physical session is active, stop it first, then disconnect.
            if (window.currentMassageSession && !window.currentMassageSession.ended && !state.connection.simulation) {
                try { await window.currentMassageSession.stop('disconnect'); } catch (e) { /* stop handles its own errors */ }
            }
            const res = await window.RobotController?.disconnectRobot?.();
            if (!res?.responseOk) {
                addSystemMessage(`Robot disconnect reported an error: ${res?.detail || res?.status}`, 'warning');
            } else {
                addSystemMessage('Robot disconnected.', 'info');
            }
        } finally {
            await refreshRobotHealth();
            syncYear65UI();
            robotConnectInFlight = false;
            if (btn) btn.disabled = false;
        }
    }

    function bindRobotConnectionControls() {
        const connectBtn = $('robotConnectBtn');
        const disconnectBtn = $('robotDisconnectBtn');
        if (connectBtn && !connectBtn.dataset.bound) {
            connectBtn.dataset.bound = '1';
            connectBtn.addEventListener('click', connectRobotFromUI);
        }
        if (disconnectBtn && !disconnectBtn.dataset.bound) {
            disconnectBtn.dataset.bound = '1';
            disconnectBtn.addEventListener('click', disconnectRobotFromUI);
        }
    }

    async function initApp() {
        if (initialized) return window.app;
        initialized = true;

        await waitFor(() => window.Year65UI && window.NursingVitalsMonitor && window.NursingInstructorTools, 3000);

        if (window.MassageStateMachine && !window.stateMachine) {
            window.stateMachine = new window.MassageStateMachine();
        }

        ensureAudioManager();
        initTeachingModules();
        bindStudentControls();
        bindInstructorControls();
        bindSettingsControls();
        bindRobotConnectionControls();
        bindSessionVisualReset();
        bindSttService();
        updateAsrLanguageBadge();
        scheduleWakeWordAutoStart();

        await refreshRobotHealth();
        syncYear65UI();
        hideLoading();

        renderTimer = renderTimer || setInterval(syncYear65UI, 1000);
        healthTimer = healthTimer || setInterval(refreshRobotHealth, 5000);

        window.addEventListener('beforeunload', () => {
            if (renderTimer) clearInterval(renderTimer);
            if (healthTimer) clearInterval(healthTimer);
            sttUnsubscribers.forEach((unsubscribe) => {
                try { unsubscribe?.(); } catch (error) { /* ignore */ }
            });
        });

        window.dispatchEvent(new Event('stable-app-ready'));
        return window.app;
    }

    window.initApp = initApp;
    window.startVoiceRecognition = startVoiceRecognition;
    window.stopVoiceRecognition = stopVoiceRecognition;
    window.addUserMessage = handleTranscript;
    window.__stableHandleTranscript = handleTranscript;
    window.app = {
        state,
        initApp,
        setMassageConfig,
        startMassage,
        pauseOrResumeSession,
        stopSession,
        resetTeachingVisualsToSetupBaseline,
        handleTranscript,
        refreshRobotHealth,
        connectRobotFromUI,
        disconnectRobotFromUI,
        getOperatingState: () => state.connection
    };
})();
