/*
 * Module: VitalsMonitor
 * Purpose: Nursing vitals monitor and teaching timeline helpers.
 * Exports: createVitalsMonitor, NursingVitalsMonitor
 * Module bridge globals: window.NursingVitalsMonitor (via module-bridge)
 */

export function createVitalsMonitor(options) {
    const teachingVitalsPanel = options.teachingVitalsPanel || null;
    const teachingCuesPanel = options.teachingCuesPanel || null;

    const DEFAULT_TARGETS = { hr: 78, sbp: 120, dbp: 75, rr: 14, spo2: 98 };
    const DEFAULT_SUBJECTIVE = { pain: 2, anxiety: 2, comfort: 2 };
    const bounds = {
        hr: [40, 160],
        sbp: [80, 200],
        dbp: [40, 120],
        rr: [8, 40],
        spo2: [85, 100]
    };

    let teachingConfig = {
        autoExpressionFromVitals: true,
        timeline: { steps: [] }
    };

    const teachingLiveState = {
        activePresetId: null,
        targetVitals: { ...DEFAULT_TARGETS },
        vitals: { ...DEFAULT_TARGETS },
        cues: { pain: 'LOW', anxiety: 'CALM', comfort: 'COMFORTABLE' },
        subjective: { pain: 2, anxiety: 2, comfort: 2 },
        useBaseAvatar: true,
        transition: null,
        autoExpressionFromVitals: true,
        manualOffset: { hr: 0, sbp: 0, dbp: 0, rr: 0, spo2: 0 },
        timelineActive: false,
        timelineStartAt: null,
        timelinePausedAt: null,
        timelinePausedMs: 0,
        manualMode: false
    };

    let teachingTimeline = [];
    let timelinePlan = [];
    let timelineBaseVitals = { ...DEFAULT_TARGETS };
    let vitalsFrozen = false;

    const jitterPhases = {
        hr: Math.random() * Math.PI * 2,
        sbp: Math.random() * Math.PI * 2,
        dbp: Math.random() * Math.PI * 2,
        rr: Math.random() * Math.PI * 2,
        spo2: Math.random() * Math.PI * 2
    };

    function clamp(val, min, max) {
        return Math.min(max, Math.max(min, val));
    }

    function applyBounds(vitals) {
        return {
            hr: clamp(vitals.hr, ...bounds.hr),
            sbp: clamp(vitals.sbp, ...bounds.sbp),
            dbp: clamp(vitals.dbp, ...bounds.dbp),
            rr: clamp(vitals.rr, ...bounds.rr),
            spo2: clamp(vitals.spo2, ...bounds.spo2)
        };
    }

    function renderTeachingMetrics() {
        if (teachingVitalsPanel) {
            const v = teachingLiveState.vitals;
            teachingVitalsPanel.innerHTML = `
            <span>HR ${v.hr.toFixed(0)} bpm</span>
            <span>BP ${v.sbp.toFixed(0)}/${v.dbp.toFixed(0)}</span>
            <span>RR ${v.rr.toFixed(0)}</span>
            <span>SpO₂ ${v.spo2.toFixed(0)}%</span>
            `;
        }
        if (teachingCuesPanel) {
            const c = teachingLiveState.cues;
            teachingCuesPanel.innerHTML = `
            <span>Pain ${c.pain}</span>
            <span>Anxiety ${c.anxiety}</span>
            <span>Comfort ${c.comfort}</span>
            `;
        }
    }

    function logTeachingEvent(type, payload) {
        teachingTimeline.push({
            ts: Date.now(),
            type,
            payload
        });
    }

    function normalizeSteps(rawSteps) {
        const steps = Array.isArray(rawSteps) ? rawSteps : [];
        let cursor = 0;
        return steps.map((step) => {
            const duration = Math.max(5, Number(step.duration_sec) || 20);
            const targets = step.targets || {};
            const subjective = step.subjective || {};
            const normalized = {
                t_start_sec: cursor,
                duration_sec: duration,
                mode: step.mode === 'fade_back' ? 'fade_back' : 'hold',
                targets: {
                    hr: Number(targets.hr) || DEFAULT_TARGETS.hr,
                    sbp: Number(targets.sbp) || DEFAULT_TARGETS.sbp,
                    dbp: Number(targets.dbp) || DEFAULT_TARGETS.dbp,
                    rr: Number(targets.rr) || DEFAULT_TARGETS.rr,
                    spo2: Number(targets.spo2) || DEFAULT_TARGETS.spo2
                },
                subjective: {
                    pain: Number(subjective.pain ?? DEFAULT_SUBJECTIVE.pain),
                    anxiety: Number(subjective.anxiety ?? DEFAULT_SUBJECTIVE.anxiety),
                    comfort: Number(subjective.comfort ?? DEFAULT_SUBJECTIVE.comfort)
                },
                useBase: step.useBase === true
            };
            cursor += duration;
            return normalized;
        });
    }

    function buildTimelinePlan(baseVitals) {
        const steps = normalizeSteps(teachingConfig.timeline?.steps || []);
        let lastEndVitals = { ...baseVitals };
        return steps.map((step) => {
            const startVitals = { ...lastEndVitals };
            const endVitals = step.mode === 'fade_back' ? { ...startVitals } : { ...step.targets };
            lastEndVitals = { ...endVitals };
            return {
                ...step,
                startVitals,
                endVitals
            };
        });
    }

    function computeStepVitals(step, elapsedSec) {
        const stepElapsed = elapsedSec - step.t_start_sec;
        if (stepElapsed <= 0) return { ...step.startVitals };
        const duration = Math.max(1, step.duration_sec);
        if (step.mode === 'fade_back') {
            const half = duration / 2;
            if (stepElapsed <= half) {
                const t = stepElapsed / half;
                return lerpVitals(step.startVitals, step.targets, t);
            }
            const t = Math.min((stepElapsed - half) / half, 1);
            return lerpVitals(step.targets, step.startVitals, t);
        }
        const transitionDuration = Math.max(2, duration * 0.35);
        if (stepElapsed <= transitionDuration) {
            const t = Math.min(stepElapsed / transitionDuration, 1);
            return lerpVitals(step.startVitals, step.targets, t);
        }
        return { ...step.targets };
    }

    function lerpVitals(a, b, t) {
        return {
            hr: a.hr + (b.hr - a.hr) * t,
            sbp: a.sbp + (b.sbp - a.sbp) * t,
            dbp: a.dbp + (b.dbp - a.dbp) * t,
            rr: a.rr + (b.rr - a.rr) * t,
            spo2: a.spo2 + (b.spo2 - a.spo2) * t
        };
    }

    function computeTimelineTargets(elapsedSec) {
        if (!timelinePlan.length) return { ...timelineBaseVitals };
        let lastEnd = { ...timelineBaseVitals };
        for (const step of timelinePlan) {
            if (elapsedSec < step.t_start_sec) {
                return lastEnd;
            }
            if (elapsedSec <= step.t_start_sec + step.duration_sec) {
                return computeStepVitals(step, elapsedSec);
            }
            lastEnd = { ...step.endVitals };
        }
        return lastEnd;
    }

    function getTimelineStepForTime(elapsedSec) {
        if (!timelinePlan.length) return null;
        for (const step of timelinePlan) {
            if (elapsedSec < step.t_start_sec) {
                return null;
            }
            if (elapsedSec <= step.t_start_sec + step.duration_sec) {
                return step;
            }
        }
        return timelinePlan[timelinePlan.length - 1] || null;
    }

    function computeJitteredVitals(targets) {
        const now = Date.now();
        const jitter = (amp, phase, speed) => amp * Math.sin((now / 1000) * speed + phase);
        return applyBounds({
            hr: targets.hr + jitter(2.2, jitterPhases.hr, 1.4),
            sbp: targets.sbp + jitter(3.2, jitterPhases.sbp, 1.1),
            dbp: targets.dbp + jitter(2.2, jitterPhases.dbp, 1.2),
            rr: targets.rr + jitter(0.8, jitterPhases.rr, 1.6),
            spo2: targets.spo2 + jitter(0.3, jitterPhases.spo2, 1.3)
        });
    }

    function setTeachingConfig(config) {
        if (!config) return;
        teachingConfig = {
            ...teachingConfig,
            ...config,
            timeline: { steps: config.timeline?.steps || [] }
        };
        teachingConfig.timeline.steps = normalizeSteps(teachingConfig.timeline.steps);
        teachingLiveState.autoExpressionFromVitals = config.autoExpressionFromVitals !== false;
        teachingTimeline = cloneTimeline(teachingConfig.timeline.steps);
        if (!teachingLiveState.timelineActive) {
            timelineBaseVitals = { ...teachingLiveState.targetVitals };
            timelinePlan = buildTimelinePlan(timelineBaseVitals);
        }
    }

    function cloneTimeline(steps) {
        return JSON.parse(JSON.stringify(steps || []));
    }

    function startTeachingTimeline() {
        if (!teachingConfig.timeline?.steps?.length) return;
        teachingLiveState.timelineActive = true;
        teachingLiveState.timelineStartAt = Date.now();
        teachingLiveState.timelinePausedAt = null;
        teachingLiveState.timelinePausedMs = 0;
        teachingLiveState.manualOffset = { hr: 0, sbp: 0, dbp: 0, rr: 0, spo2: 0 };
        teachingLiveState.manualMode = false;
        timelineBaseVitals = { ...teachingLiveState.targetVitals };
        timelinePlan = buildTimelinePlan(timelineBaseVitals);
        logTeachingEvent('TIMELINE_STARTED', { started_at: teachingLiveState.timelineStartAt });
    }

    function pauseTeachingTimeline() {
        if (!teachingLiveState.timelineActive || teachingLiveState.timelinePausedAt) return;
        teachingLiveState.timelinePausedAt = Date.now();
    }

    function resumeTeachingTimeline() {
        if (!teachingLiveState.timelineActive || !teachingLiveState.timelinePausedAt) return;
        teachingLiveState.timelinePausedMs += Date.now() - teachingLiveState.timelinePausedAt;
        teachingLiveState.timelinePausedAt = null;
    }

    function stopTeachingTimeline() {
        teachingLiveState.timelineActive = false;
        teachingLiveState.timelineStartAt = null;
        teachingLiveState.timelinePausedAt = null;
        teachingLiveState.timelinePausedMs = 0;
        teachingLiveState.manualOffset = { hr: 0, sbp: 0, dbp: 0, rr: 0, spo2: 0 };
        teachingLiveState.manualMode = false;
    }

    function applyTeachingPreset(preset) {
        if (!preset) return;
        const targets = preset.targets || {};
        teachingLiveState.activePresetId = preset.id;
        teachingLiveState.useBaseAvatar = preset.useBase === true;
        teachingLiveState.targetVitals = applyBounds({
            hr: targets.hr ?? teachingLiveState.targetVitals.hr,
            sbp: targets.sbp ?? teachingLiveState.targetVitals.sbp,
            dbp: targets.dbp ?? teachingLiveState.targetVitals.dbp,
            rr: targets.rr ?? teachingLiveState.targetVitals.rr,
            spo2: targets.spo2 ?? teachingLiveState.targetVitals.spo2
        });
        teachingLiveState.cues = {
            pain: preset.cues?.pain || 'LOW',
            anxiety: preset.cues?.anxiety || 'CALM',
            comfort: preset.cues?.comfort || 'COMFORTABLE'
        };
        teachingLiveState.subjective = {
            pain: preset.subjective?.pain ?? mapCueToNumeric(teachingLiveState.cues.pain, 'pain'),
            anxiety: preset.subjective?.anxiety ?? mapCueToNumeric(teachingLiveState.cues.anxiety, 'anxiety'),
            comfort: preset.subjective?.comfort ?? mapCueToNumeric(teachingLiveState.cues.comfort, 'comfort')
        };
        if (teachingLiveState.timelineActive && teachingLiveState.manualMode) {
            teachingLiveState.targetVitals = applyBounds({
                hr: targets.hr ?? teachingLiveState.targetVitals.hr,
                sbp: targets.sbp ?? teachingLiveState.targetVitals.sbp,
                dbp: targets.dbp ?? teachingLiveState.targetVitals.dbp,
                rr: targets.rr ?? teachingLiveState.targetVitals.rr,
                spo2: targets.spo2 ?? teachingLiveState.targetVitals.spo2
            });
        }
        teachingLiveState.vitals = vitalsFrozen
            ? applyBounds({ ...teachingLiveState.targetVitals })
            : computeJitteredVitals(teachingLiveState.targetVitals);
        logTeachingEvent('PRESET_CHANGED', { preset_id: preset.id });
        renderTeachingMetrics();
    }

    function adjustTeachingVitals(delta) {
        if (!delta) return;
        const applyDelta = (vitals) => applyBounds({
            hr: vitals.hr + (delta.hr || 0),
            sbp: vitals.sbp + (delta.sbp || 0),
            dbp: vitals.dbp + (delta.dbp || 0),
            rr: vitals.rr + (delta.rr || 0),
            spo2: vitals.spo2 + (delta.spo2 || 0)
        });

        if (teachingLiveState.timelineActive) {
            teachingLiveState.manualOffset = {
                hr: (teachingLiveState.manualOffset.hr || 0) + (delta.hr || 0),
                sbp: (teachingLiveState.manualOffset.sbp || 0) + (delta.sbp || 0),
                dbp: (teachingLiveState.manualOffset.dbp || 0) + (delta.dbp || 0),
                rr: (teachingLiveState.manualOffset.rr || 0) + (delta.rr || 0),
                spo2: (teachingLiveState.manualOffset.spo2 || 0) + (delta.spo2 || 0)
            };
        } else {
            teachingLiveState.targetVitals = applyDelta(teachingLiveState.targetVitals);
        }

        logTeachingEvent('FINE_TUNE', { delta });
        if (window.nursingTimelineManagerInstance?.addEvent) {
            window.nursingTimelineManagerInstance.addEvent('FINE_TUNE', { delta });
        }
        renderTeachingMetrics();
    }

    function setInstructorMetrics(metrics) {
        if (!metrics) return;
        const update = { ...teachingLiveState.subjective };
        if (metrics.pain != null) update.pain = Math.max(0, Math.min(10, Number(metrics.pain)));
        if (metrics.anxiety != null) update.anxiety = Math.max(0, Math.min(10, Number(metrics.anxiety)));
        if (metrics.comfort != null) update.comfort = Math.max(1, Math.min(5, Number(metrics.comfort)));
        teachingLiveState.subjective = update;
        teachingLiveState.useBaseAvatar = false;
        teachingLiveState.cues = {
            pain: mapNumericToCue(update.pain, 'pain'),
            anxiety: mapNumericToCue(update.anxiety, 'anxiety'),
            comfort: mapNumericToCue(update.comfort, 'comfort')
        };
        renderTeachingMetrics();
    }

    function tickTeachingTimeline() {
        if (!teachingLiveState.timelineActive) return;
        if (teachingLiveState.timelinePausedAt) return;
        if (!teachingLiveState.timelineStartAt) return;
        if (teachingLiveState.manualMode) return;
        const elapsedMs = Date.now() - teachingLiveState.timelineStartAt - teachingLiveState.timelinePausedMs;
        const elapsedSec = Math.max(0, elapsedMs / 1000);
        const baseTarget = computeTimelineTargets(elapsedSec);
        const offset = teachingLiveState.manualOffset;
        teachingLiveState.targetVitals = applyBounds({
            hr: baseTarget.hr + (offset.hr || 0),
            sbp: baseTarget.sbp + (offset.sbp || 0),
            dbp: baseTarget.dbp + (offset.dbp || 0),
            rr: baseTarget.rr + (offset.rr || 0),
            spo2: baseTarget.spo2 + (offset.spo2 || 0)
        });

        const activeStep = getTimelineStepForTime(elapsedSec);
        if (activeStep?.subjective) {
            const subjective = {
                pain: Number(activeStep.subjective.pain ?? teachingLiveState.subjective.pain),
                anxiety: Number(activeStep.subjective.anxiety ?? teachingLiveState.subjective.anxiety),
                comfort: Number(activeStep.subjective.comfort ?? teachingLiveState.subjective.comfort)
            };
            teachingLiveState.subjective = subjective;
            teachingLiveState.cues = {
                pain: mapNumericToCue(subjective.pain, 'pain'),
                anxiety: mapNumericToCue(subjective.anxiety, 'anxiety'),
                comfort: mapNumericToCue(subjective.comfort, 'comfort')
            };
            teachingLiveState.useBaseAvatar = activeStep.useBase === true;
        } else {
            teachingLiveState.useBaseAvatar = false;
        }
    }

    function tickVitals() {
        tickTeachingTimeline();
        if (vitalsFrozen) {
            teachingLiveState.vitals = applyBounds({ ...teachingLiveState.targetVitals });
        } else {
            teachingLiveState.vitals = computeJitteredVitals(teachingLiveState.targetVitals);
        }
        renderTeachingMetrics();
    }

    // 10Hz update for smooth animation
    const updateInterval = setInterval(() => {
        tickVitals();
    }, 100);

    function cleanup() {
        if (updateInterval) {
            clearInterval(updateInterval);
        }
    }

    function getTeachingLiveState() {
        return {
            ...teachingLiveState,
            vitals: { ...teachingLiveState.vitals },
            targetVitals: { ...teachingLiveState.targetVitals },
            cues: { ...teachingLiveState.cues },
            subjective: { ...teachingLiveState.subjective }
        };
    }

    function getTeachingTimeline() {
        return JSON.parse(JSON.stringify(teachingTimeline));
    }

    function setManualMode(enabled) {
        teachingLiveState.manualMode = !!enabled;
        if (teachingLiveState.manualMode) {
            teachingLiveState.manualOffset = { hr: 0, sbp: 0, dbp: 0, rr: 0, spo2: 0 };
        }
    }

    function setVitalsFreeze(enabled) {
        vitalsFrozen = !!enabled;
        if (vitalsFrozen) {
            teachingLiveState.vitals = applyBounds({ ...teachingLiveState.targetVitals });
            renderTeachingMetrics();
        }
    }

    return {
        applyTeachingPreset,
        renderTeachingMetrics,
        adjustTeachingVitals,
        setInstructorMetrics,
        getTeachingLiveState,
        getTeachingTimeline,
        setTeachingConfig,
        setManualMode,
        setVitalsFreeze,
        startTeachingTimeline,
        pauseTeachingTimeline,
        resumeTeachingTimeline,
        stopTeachingTimeline,
        cleanup // Export cleanup
    };
}

export const NursingVitalsMonitor = {
    createVitalsMonitor
};

function mapCueToNumeric(value, type) {
    const normalized = String(value || '').toUpperCase();
    if (type === 'pain') {
        if (normalized === 'LOW') return 0;
        if (normalized === 'MILD') return 2;
        if (normalized === 'MODERATE') return 3;
        if (normalized === 'HIGH') return 4;
        if (normalized === 'SEVERE') return 5;
    }
    if (type === 'anxiety') {
        if (normalized === 'CALM') return 0;
        if (normalized === 'UNEASY') return 2;
        if (normalized === 'TENSE') return 3;
        if (normalized === 'ANXIOUS') return 4;
        if (normalized === 'PANIC') return 5;
    }
    if (type === 'comfort') {
        if (normalized === 'UNCOMFORTABLE') return 0;
        if (normalized === 'SLIGHTLY_UNCOMFORTABLE') return 2;
        if (normalized === 'NEUTRAL') return 3;
        if (normalized === 'COMFORTABLE') return 4;
        if (normalized === 'VERY_COMFORTABLE') return 5;
    }
    return 2;
}

function mapNumericToCue(value, type) {
    const raw = Number(value);
    const scaled = raw > 5 ? Math.round(raw / 2) : raw;
    const v = Math.max(0, Math.min(5, scaled));
    if (type === 'pain') {
        if (v <= 0) return 'LOW';
        if (v <= 2) return 'MILD';
        if (v <= 3) return 'MODERATE';
        if (v <= 4) return 'HIGH';
        return 'SEVERE';
    }
    if (type === 'anxiety') {
        if (v <= 0) return 'CALM';
        if (v <= 2) return 'UNEASY';
        if (v <= 3) return 'TENSE';
        if (v <= 4) return 'ANXIOUS';
        return 'PANIC';
    }
    if (type === 'comfort') {
        if (scaled <= 0) return 'UNCOMFORTABLE';
        if (scaled <= 2) return 'SLIGHTLY_UNCOMFORTABLE';
        if (scaled <= 3) return 'NEUTRAL';
        if (scaled <= 4) return 'COMFORTABLE';
        return 'VERY_COMFORTABLE';
    }
    return 'LOW';
}
