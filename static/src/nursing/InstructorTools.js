/*
 * Module: InstructorTools
 * Purpose: Nursing instructor tools and teaching state accessors.
 * Exports: initInstructorTools, getTeachingScenarioState, getTeachingTimeline,
 *          getTeachingLiveState, NursingInstructorTools
 * Module bridge globals: window.NursingInstructorTools, window.getTeachingScenarioState,
 *                 window.getTeachingTimeline, window.getTeachingLiveState (via module-bridge)
 */

const TEACHING_SCHEMA_VERSION = 'v2';
const TEACHING_STORAGE_KEY = 'teachingScenarioState';

function computeComfortScore(pain = 1, anxiety = 1) {
    const maxScore = Math.max(Number(pain) || 0, Number(anxiety) || 0);
    return Math.max(1, Math.min(5, 5 - Math.round(maxScore / 2)));
}

const DEFAULT_MANUAL_PRESETS = [
    {
        id: 'baseline',
        label: 'Baseline',
        targets: { hr: 75, sbp: 120, dbp: 75, rr: 14, spo2: 98 },
        subjective: { pain: 2, anxiety: 2, comfort: 5 },
        useBase: false
    },
    {
        id: 'mild_anxiety',
        label: 'Mild Anxiety',
        targets: { hr: 90, sbp: 124, dbp: 78, rr: 16, spo2: 98 },
        subjective: { pain: 3, anxiety: 4, comfort: 3 }
    },
    {
        id: 'neutral_pain',
        label: 'Neutral Pain',
        targets: { hr: 88, sbp: 122, dbp: 76, rr: 15, spo2: 98 },
        subjective: { pain: 4, anxiety: 3, comfort: 3 }
    },
    {
        id: 'mild_pain',
        label: 'Mild Pain',
        targets: { hr: 92, sbp: 126, dbp: 80, rr: 17, spo2: 97 },
        subjective: { pain: 5, anxiety: 3, comfort: 2 }
    },
    {
        id: 'moderate_pain',
        label: 'Moderate Pain',
        targets: { hr: 100, sbp: 130, dbp: 84, rr: 19, spo2: 97 },
        subjective: { pain: 6, anxiety: 4, comfort: 2 }
    },
    {
        id: 'severe_pain',
        label: 'Severe Pain',
        targets: { hr: 110, sbp: 138, dbp: 88, rr: 22, spo2: 96 },
        subjective: { pain: 7, anxiety: 5, comfort: 1 }
    },
    {
        id: 'high_anxiety',
        label: 'High Anxiety',
        targets: { hr: 115, sbp: 136, dbp: 88, rr: 24, spo2: 96 },
        subjective: { pain: 5, anxiety: 6, comfort: 2 }
    },
    {
        id: 'panic',
        label: 'Panic',
        targets: { hr: 125, sbp: 145, dbp: 94, rr: 28, spo2: 95 },
        subjective: { pain: 6, anxiety: 8, comfort: 1 }
    }
];

const DEFAULT_TEACHING_STATE = {
    schemaVersion: TEACHING_SCHEMA_VERSION,
    autoExpressionFromVitals: true,
    manualPresets: DEFAULT_MANUAL_PRESETS,
    selectedManualPresetId: DEFAULT_MANUAL_PRESETS[0]?.id,
    timeline: {
        steps: [
            {
                t_start_sec: 0,
                duration_sec: 20,
                mode: 'hold',
                presetId: 'baseline'
            },
            {
                t_start_sec: 20,
                duration_sec: 20,
                mode: 'hold',
                presetId: 'mild_pain'
            },
            {
                t_start_sec: 40,
                duration_sec: 20,
                mode: 'hold',
                presetId: 'panic'
            }
        ]
    }
};

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function normalizeSteps(rawSteps) {
    const steps = Array.isArray(rawSteps) ? rawSteps : [];
    let cursor = 0;
    return steps.map((step) => {
        const duration = Math.max(5, Number(step.duration_sec) || 20);
        const presetId = step.presetId || DEFAULT_MANUAL_PRESETS[0]?.id;
        const normalized = {
            t_start_sec: cursor,
            duration_sec: duration,
            mode: step.mode === 'fade_back' ? 'fade_back' : 'hold',
            presetId
        };
        cursor += duration;
        return normalized;
    });
}

function buildTimelineConfigSteps(steps, presets) {
    const presetMap = new Map((presets || []).map((preset) => [preset.id, preset]));
    let cursor = 0;
    return (steps || []).map((step) => {
        const duration = Math.max(5, Number(step.duration_sec) || 20);
        const preset = presetMap.get(step.presetId) || DEFAULT_MANUAL_PRESETS[0];
        const targets = preset?.targets || DEFAULT_MANUAL_PRESETS[0].targets;
        const subjective = preset?.subjective || DEFAULT_MANUAL_PRESETS[0].subjective;
        const normalized = {
            t_start_sec: cursor,
            duration_sec: duration,
            mode: step.mode === 'fade_back' ? 'fade_back' : 'hold',
            targets: { ...targets },
            subjective: { ...subjective },
            useBase: preset?.useBase === true
        };
        cursor += duration;
        return normalized;
    });
}

function normalizeManualPresets(rawPresets) {
    const storedPresets = Array.isArray(rawPresets) ? rawPresets : [];
    const presetMap = new Map(storedPresets.map((preset) => [preset.id, preset]));
    return DEFAULT_MANUAL_PRESETS.map((preset) => {
        const stored = presetMap.get(preset.id) || {};
        return {
            ...preset,
            useBase: stored.useBase ?? preset.useBase ?? false,
            targets: { ...preset.targets, ...(stored.targets || {}) },
            subjective: { ...preset.subjective, ...(stored.subjective || {}) }
        };
    });
}

function loadTeachingState() {
    const raw = localStorage.getItem(TEACHING_STORAGE_KEY);
    if (!raw) {
        localStorage.setItem(TEACHING_STORAGE_KEY, JSON.stringify(DEFAULT_TEACHING_STATE));
        return clone(DEFAULT_TEACHING_STATE);
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.schemaVersion !== TEACHING_SCHEMA_VERSION) {
            localStorage.setItem(`${TEACHING_STORAGE_KEY}_backup`, raw);
            localStorage.setItem(TEACHING_STORAGE_KEY, JSON.stringify(DEFAULT_TEACHING_STATE));
            return clone(DEFAULT_TEACHING_STATE);
        }
        parsed.timeline = parsed.timeline || { steps: [] };
        parsed.timeline.steps = normalizeSteps(parsed.timeline.steps);
        if (typeof parsed.autoExpressionFromVitals !== 'boolean') {
            parsed.autoExpressionFromVitals = true;
        }
        parsed.manualPresets = normalizeManualPresets(parsed.manualPresets);
        parsed.selectedManualPresetId = parsed.selectedManualPresetId || DEFAULT_MANUAL_PRESETS[0]?.id;
        return parsed;
    } catch (e) {
        localStorage.setItem(TEACHING_STORAGE_KEY, JSON.stringify(DEFAULT_TEACHING_STATE));
        return clone(DEFAULT_TEACHING_STATE);
    }
}

let cachedTeachingState = null;
let cachedVitalsMonitor = null;

export function initInstructorTools(options) {
    const {
        showToast,
        teachingOverlay,
        teachingOverlayMask,
        teachingOverlayClose,
        teachingEventGrid,
        teachingFineTuneGrid,
        teachingPainInput,
        teachingAnxietyInput,
        teachingComfortInput,
        teachingPainValue,
        teachingAnxietyValue,
        teachingComfortValue,
        teachingTimelineList,
        teachingAddStepBtn,
        teachingAutoExpressionToggle,
        teachingVitalsPanel,
        teachingCuesPanel,
        manualHrSlider,
        manualSbpSlider,
        manualDbpSlider,
        manualRrSlider,
        manualSpo2Slider,
        manualHrValue,
        manualSbpValue,
        manualDbpValue,
        manualRrValue,
        manualSpo2Value,
        manualVitalsResetBtn,
        manualVitalsApplyBtn,
        timelineResetBtn,
        timelineApplyBtn,
        manualPresetGrid,
        teachingMetricsResetBtn,
        teachingMetricsApplyBtn,
        timelineStatus
    } = options;

    let teachingState = loadTeachingState();
    cachedTeachingState = teachingState;

    const DEFAULT_EVENT_CARDS = [
        { id: 'event_discomfort', label: 'Discomfort', phrase: '有啲唔舒服', key: '1' },
        { id: 'event_anxiety', label: 'Anxiety', phrase: '我有啲緊張', key: '2' },
        { id: 'event_pressure', label: 'Pressure Too High', phrase: '可以輕啲嗎？', key: '3' },
        { id: 'event_pain', label: 'Pain', phrase: '呢個位有啲痛', key: '4' }
    ];

    const expressionModeText = document.getElementById('y65ExpressionModeText');
    const expressionPresetText = document.getElementById('y65ExpressionPresetText');
    const expressionStatusDot = document.getElementById('expressionStatusDot');

    const vitalsMonitor = window.nursingVitalsMonitorInstance || window.NursingVitalsMonitor.createVitalsMonitor({
        teachingVitalsPanel,
        teachingCuesPanel
    });
    window.nursingVitalsMonitorInstance = vitalsMonitor;
    cachedVitalsMonitor = vitalsMonitor;

    if (window.NursingScenarioController && !window.nursingScenarioControllerInstance) {
        window.nursingScenarioControllerInstance = window.NursingScenarioController.createScenarioController({
            vitalsMonitor,
            timelineManager: window.nursingTimelineManagerInstance,
            scenarioSelectEl: document.getElementById('teachingScenarioSelect')
        });
    }

    function persistTeachingState() {
        teachingState.timeline.steps = normalizeSteps(teachingState.timeline.steps);
        localStorage.setItem(TEACHING_STORAGE_KEY, JSON.stringify(teachingState));
        const timelineSteps = buildTimelineConfigSteps(teachingState.timeline.steps, teachingState.manualPresets);
        const teachingConfig = {
            ...clone(teachingState),
            timeline: { steps: timelineSteps }
        };
        vitalsMonitor.setTeachingConfig?.(teachingConfig);
        cachedTeachingState = teachingState;
    }

    function renderTimelineSteps() {
        if (!teachingTimelineList) return;
        teachingTimelineList.innerHTML = '';
        const steps = normalizeSteps(teachingState.timeline.steps);
        const presets = teachingState.manualPresets || [];

        steps.forEach((step, index) => {
            const stepEl = document.createElement('div');
            stepEl.className = 'teaching-timeline-step';
            stepEl.dataset.stepIndex = String(index);

            const presetOptions = presets.map((preset) => {
                const selected = preset.id === step.presetId ? 'selected' : '';
                return `<option value="${preset.id}" ${selected}>${preset.label}</option>`;
            }).join('');

            stepEl.innerHTML = `
            <div class="timeline-step-header">
                <span>Step ${index + 1} · ${step.t_start_sec}s</span>
                <button class="fine-btn" data-action="remove-step" type="button">Remove</button>
            </div>
            <div class="timeline-step-grid">
                <div class="overlay-field">
                    <label>Duration (sec)</label>
                    <input type="number" min="5" step="5" data-field="duration_sec" value="${step.duration_sec}">
                </div>
                <div class="overlay-field">
                    <label>Preset</label>
                    <select data-field="presetId">
                        ${presetOptions}
                    </select>
                </div>
            </div>
            `;
            teachingTimelineList.appendChild(stepEl);
        });
    }

    function bindTimelineEvents() {
        if (!teachingTimelineList) return;
        if (teachingTimelineList.dataset.bound === 'true') return;
        teachingTimelineList.dataset.bound = 'true';

        teachingTimelineList.addEventListener('input', (event) => {
            const field = event.target.dataset?.field;
            const stepEl = event.target.closest('.teaching-timeline-step');
            if (!field || !stepEl) return;
            const idx = Number(stepEl.dataset.stepIndex);
            const step = teachingState.timeline.steps[idx];
            if (!step) return;

            if (field === 'duration_sec') {
                step.duration_sec = Number(event.target.value) || step.duration_sec;
            }
            if (field === 'presetId') {
                step.presetId = event.target.value || step.presetId;
            }
            persistTeachingState();
            renderTimelineSteps();
        });

        teachingTimelineList.addEventListener('click', (event) => {
            const removeBtn = event.target.closest('[data-action="remove-step"]');
            if (!removeBtn) return;
            const stepEl = removeBtn.closest('.teaching-timeline-step');
            if (!stepEl) return;
            const idx = Number(stepEl.dataset.stepIndex);
            teachingState.timeline.steps.splice(idx, 1);
            if (teachingState.timeline.steps.length === 0) {
                teachingState.timeline.steps.push(clone(DEFAULT_TEACHING_STATE.timeline.steps[0]));
            }
            persistTeachingState();
            renderTimelineSteps();
        });
    }

    function addTimelineStep() {
        const steps = teachingState.timeline.steps;
        const lastStep = steps[steps.length - 1] || DEFAULT_TEACHING_STATE.timeline.steps[0];
        steps.push({
            t_start_sec: 0,
            duration_sec: lastStep.duration_sec || 20,
            mode: 'hold',
            presetId: lastStep.presetId || DEFAULT_MANUAL_PRESETS[0]?.id
        });
        persistTeachingState();
        renderTimelineSteps();
        vitalsMonitor.renderTeachingMetrics?.();
        bindTimelineEvents();
        bindTabs();
        bindModeToggle();
        bindManualSliders();
        bindInstructorMetricsButtons();
        bindTimelineButtons();
        bindEventCardFallback();
        setTimelineApplyState(vitalsMonitor.getTeachingLiveState?.().timelineActive === true);
        if (teachingAutoExpressionToggle) {
            teachingAutoExpressionToggle.checked = teachingState.autoExpressionFromVitals !== false;
        }
    }

    function renderInstructorMetrics() {
        const liveState = vitalsMonitor.getTeachingLiveState();
        if (!liveState?.subjective) return;
        if (teachingPainInput) teachingPainInput.value = String(liveState.subjective.pain ?? 0);
        if (teachingAnxietyInput) teachingAnxietyInput.value = String(liveState.subjective.anxiety ?? 0);
        if (teachingComfortInput) teachingComfortInput.value = String(liveState.subjective.comfort ?? 0);
        if (teachingPainValue) teachingPainValue.textContent = String(liveState.subjective.pain ?? 0);
        if (teachingAnxietyValue) teachingAnxietyValue.textContent = String(liveState.subjective.anxiety ?? 0);
        if (teachingComfortValue) teachingComfortValue.textContent = String(liveState.subjective.comfort ?? 0);
    }

    function renderFineTuneControls() {
        if (!teachingFineTuneGrid) return;
        if (teachingFineTuneGrid.dataset.bound === 'true') return;
        teachingFineTuneGrid.dataset.bound = 'true';
        teachingFineTuneGrid.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-tune]');
            if (!btn) return;
            const tune = btn.dataset.tune;
            const deltaMap = {
                hr_up: { hr: 5 },
                hr_down: { hr: -5 },
                sbp_up: { sbp: 5 },
                sbp_down: { sbp: -5 },
                dbp_up: { dbp: 5 },
                dbp_down: { dbp: -5 },
                rr_up: { rr: 2 },
                rr_down: { rr: -2 },
                spo2_up: { spo2: 1 },
                spo2_down: { spo2: -1 }
            };
            const delta = deltaMap[tune];
            if (delta) {
                vitalsMonitor.adjustTeachingVitals(delta);
            }
        });
    }

    function renderEventCards() {
        if (!teachingEventGrid) return;
        teachingEventGrid.innerHTML = '';
        DEFAULT_EVENT_CARDS.forEach((card) => {
            const btn = document.createElement('button');
            btn.className = 'overlay-event-btn';
            btn.dataset.eventId = card.id;
            btn.dataset.key = card.key;
            btn.innerHTML = `<div class="event-title">${card.label}</div><div class="event-meta">Key ${card.key}</div>`;
            btn.addEventListener('click', () => {
                triggerEventCard(card);
            });
            teachingEventGrid.appendChild(btn);
        });
    }

    function bindEventCardFallback() {
        if (!teachingEventGrid) return;
        if (teachingEventGrid.dataset.bound === 'true') return;
        teachingEventGrid.dataset.bound = 'true';
        teachingEventGrid.addEventListener('click', (event) => {
            const btn = event.target.closest('.overlay-event-btn');
            if (!btn) return;
            const card = DEFAULT_EVENT_CARDS.find((item) => item.id === btn.dataset.eventId);
            if (!card) return;
            triggerEventCard(card);
        });
    }

    function triggerEventCard(card) {
        if (!card) return;
        if (window.nursingTimelineManagerInstance?.addEvent) {
            window.nursingTimelineManagerInstance.addEvent('EVENT_CARD', {
                event_id: card.id,
                label: card.label,
                phrase: card.phrase
            });
        }
        if (typeof showToast === 'function') {
            showToast('Event Card', `${card.label} · ${card.phrase}`);
        }
    }

    let currentVitalsMode = localStorage.getItem('teachingVitalsMode') || 'keyboard';

    function updateExpressionIndicator(mode, presetId = null) {
        if (expressionModeText) {
            const labelMap = {
                manual: 'Manual',
                timeline: 'Timeline',
                keyboard: 'Keyboard'
            };
            expressionModeText.textContent = labelMap[mode] || 'Manual';
        }
        if (expressionStatusDot) {
            expressionStatusDot.classList.toggle('inactive', mode === 'timeline');
        }
        if (!expressionPresetText) return;
        if (!presetId || mode === 'timeline') {
            expressionPresetText.textContent = '';
            return;
        }
        const preset = (teachingState?.manualPresets || DEFAULT_MANUAL_PRESETS)
            .find((item) => item.id === presetId);
        expressionPresetText.textContent = preset ? `· ${preset.label}` : '';
    }

    updateExpressionIndicator(currentVitalsMode, teachingState?.selectedManualPresetId);

    function setVitalsMode(mode) {
        const normalized = ['manual', 'timeline', 'keyboard'].includes(mode) ? mode : 'manual';
        currentVitalsMode = normalized;
        const modeBtns = teachingOverlay?.querySelectorAll('.teaching-mode-btn') || [];
        const manualSections = teachingOverlay?.querySelectorAll('.manual-mode-section') || [];
        const timelineSections = teachingOverlay?.querySelectorAll('.timeline-mode-section') || [];
        const setupPanel = document.getElementById('teachingSetupPanel');
        const setupGrid = document.getElementById('teachingSetupGrid');

        modeBtns.forEach((btn) => {
            const isActive = btn.dataset.mode === normalized;
            btn.classList.toggle('active', isActive);
        });

        if (normalized === 'manual') {
            manualSections.forEach(el => el.style.display = 'block');
            timelineSections.forEach(el => el.style.display = 'none');
            if (setupPanel) setupPanel.classList.add('manual-mode');
            if (setupGrid) setupGrid.classList.remove('timeline-only');
            vitalsMonitor.stopTeachingTimeline?.();
            vitalsMonitor.setManualMode?.(true);
            setTimelineApplyState(false);
            updateExpressionIndicator(normalized, teachingState?.selectedManualPresetId);
        } else if (normalized === 'keyboard') {
            manualSections.forEach(el => el.style.display = 'none');
            timelineSections.forEach(el => el.style.display = 'none');
            if (setupPanel) setupPanel.classList.remove('manual-mode');
            if (setupGrid) setupGrid.classList.remove('timeline-only');
            vitalsMonitor.stopTeachingTimeline?.();
            vitalsMonitor.setManualMode?.(true);
            setTimelineApplyState(false);
            updateExpressionIndicator(normalized, teachingState?.selectedManualPresetId);
        } else {
            manualSections.forEach(el => el.style.display = 'none');
            timelineSections.forEach(el => el.style.display = 'block');
            if (setupPanel) setupPanel.classList.remove('manual-mode');
            if (setupGrid) setupGrid.classList.add('timeline-only');
            vitalsMonitor.setManualMode?.(false);
            updateExpressionIndicator(normalized, null);
        }

        renderEventCards();
        localStorage.setItem('teachingVitalsMode', normalized);
    }

    const MANUAL_DEFAULTS = { hr: 78, sbp: 120, dbp: 75, rr: 14, spo2: 98 };

    function renderManualSliders() {
        const liveState = vitalsMonitor.getTeachingLiveState();
        const targets = liveState?.targetVitals || MANUAL_DEFAULTS;

        if (manualHrSlider) {
            manualHrSlider.value = targets.hr;
            if (manualHrValue) manualHrValue.textContent = Math.round(targets.hr);
        }
        if (manualSbpSlider) {
            manualSbpSlider.value = targets.sbp;
            if (manualSbpValue) manualSbpValue.textContent = Math.round(targets.sbp);
        }
        if (manualDbpSlider) {
            manualDbpSlider.value = targets.dbp;
            if (manualDbpValue) manualDbpValue.textContent = Math.round(targets.dbp);
        }
        if (manualRrSlider) {
            manualRrSlider.value = targets.rr;
            if (manualRrValue) manualRrValue.textContent = Math.round(targets.rr);
        }
        if (manualSpo2Slider) {
            manualSpo2Slider.value = targets.spo2;
            if (manualSpo2Value) manualSpo2Value.textContent = Math.round(targets.spo2);
        }
    }

    const INSTRUCTOR_DEFAULTS = { pain: 2, anxiety: 2, comfort: 4 };

    function updateInstructorSliderDisplay() {
        if (teachingPainValue && teachingPainInput) teachingPainValue.textContent = teachingPainInput.value;
        if (teachingAnxietyValue && teachingAnxietyInput) teachingAnxietyValue.textContent = teachingAnxietyInput.value;
        if (teachingComfortValue && teachingComfortInput) {
            const comfortScore = computeComfortScore(teachingPainInput?.value, teachingAnxietyInput?.value);
            teachingComfortValue.textContent = String(comfortScore);
            teachingComfortInput.value = String(comfortScore);
        }
    }

    function applyInstructorMetricsFromInputs() {
        const payload = {
            pain: Number(teachingPainInput?.value ?? INSTRUCTOR_DEFAULTS.pain),
            anxiety: Number(teachingAnxietyInput?.value ?? INSTRUCTOR_DEFAULTS.anxiety),
            comfort: Number(teachingComfortInput?.value ?? computeComfortScore(teachingPainInput?.value, teachingAnxietyInput?.value))
        };
        vitalsMonitor.setInstructorMetrics(payload);
        updateInstructorSliderDisplay();
    }

    function resetInstructorMetrics() {
        if (teachingPainInput) teachingPainInput.value = INSTRUCTOR_DEFAULTS.pain;
        if (teachingAnxietyInput) teachingAnxietyInput.value = INSTRUCTOR_DEFAULTS.anxiety;
        updateInstructorSliderDisplay();
        vitalsMonitor.applyTeachingPreset({
            id: 'baseline',
            subjective: {
                pain: INSTRUCTOR_DEFAULTS.pain,
                anxiety: INSTRUCTOR_DEFAULTS.anxiety,
                comfort: computeComfortScore(INSTRUCTOR_DEFAULTS.pain, INSTRUCTOR_DEFAULTS.anxiety)
            },
            useBase: true
        });
        if (typeof showToast === 'function') {
            showToast('Instructor', 'Pain/anxiety reset');
        }
    }

    function getManualPresetById(presetId) {
        return teachingState.manualPresets?.find((preset) => preset.id === presetId);
    }

    function renderManualPresetGrid() {
        if (!manualPresetGrid) return;
        manualPresetGrid.innerHTML = '';
        const presets = teachingState.manualPresets || [];
        presets.forEach((preset) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'overlay-preset-btn';
            if (preset.id === teachingState.selectedManualPresetId) {
                btn.classList.add('active');
            }
            btn.dataset.presetId = preset.id;
            const comfortValue = preset.subjective?.comfort ?? computeComfortScore(preset.subjective?.pain, preset.subjective?.anxiety);
            btn.innerHTML = `
                <div>${preset.label}</div>
                <div class="event-meta">Pain ${preset.subjective?.pain ?? '-'} · Anxiety ${preset.subjective?.anxiety ?? '-'} · Comfort ${comfortValue}</div>
            `;
            btn.addEventListener('click', () => applyManualPreset(preset.id));
            manualPresetGrid.appendChild(btn);
        });
    }

    function applyManualPreset(presetId) {
        const preset = getManualPresetById(presetId);
        if (!preset) return;
        teachingState.selectedManualPresetId = presetId;

        if (manualHrSlider) manualHrSlider.value = preset.targets.hr;
        if (manualSbpSlider) manualSbpSlider.value = preset.targets.sbp;
        if (manualDbpSlider) manualDbpSlider.value = preset.targets.dbp;
        if (manualRrSlider) manualRrSlider.value = preset.targets.rr;
        if (manualSpo2Slider) manualSpo2Slider.value = preset.targets.spo2;
        updateManualSliderDisplay();

        if (teachingPainInput) teachingPainInput.value = preset.subjective?.pain ?? INSTRUCTOR_DEFAULTS.pain;
        if (teachingAnxietyInput) teachingAnxietyInput.value = preset.subjective?.anxiety ?? INSTRUCTOR_DEFAULTS.anxiety;
        if (teachingComfortInput) {
            const pain = Number(preset.subjective?.pain ?? INSTRUCTOR_DEFAULTS.pain);
            const anxiety = Number(preset.subjective?.anxiety ?? INSTRUCTOR_DEFAULTS.anxiety);
            const comfortScore = computeComfortScore(pain, anxiety);
            teachingComfortInput.value = comfortScore;
        }

        updateInstructorSliderDisplay();

        vitalsMonitor.applyTeachingPreset({
            id: preset.id,
            targets: { ...preset.targets },
            subjective: { ...preset.subjective },
            useBase: preset.useBase === true
        });
        vitalsMonitor.setManualMode?.(true);
        persistTeachingState();
        renderManualPresetGrid();
        updateExpressionIndicator(currentVitalsMode, preset.id);
        // Trigger immediate UI sync for the main Year65 display
        if (typeof window.syncYear65UI === 'function') {
            window.syncYear65UI({ previewTeachingPreset: true });
        }
        if (typeof showToast === 'function') {
            showToast('Preset', `${preset.label} applied`);
        }
    }

    function saveActiveManualPreset() {
        const presetId = teachingState.selectedManualPresetId;
        if (!presetId) return;
        const presets = teachingState.manualPresets || [];
        const idx = presets.findIndex((preset) => preset.id === presetId);
        if (idx < 0) return;
        const current = presets[idx];
        const updated = {
            ...current,
            useBase: current.useBase === true,
            targets: {
                hr: Number(manualHrSlider?.value ?? current.targets.hr),
                sbp: Number(manualSbpSlider?.value ?? current.targets.sbp),
                dbp: Number(manualDbpSlider?.value ?? current.targets.dbp),
                rr: Number(manualRrSlider?.value ?? current.targets.rr),
                spo2: Number(manualSpo2Slider?.value ?? current.targets.spo2)
            },
            subjective: {
                pain: Number(teachingPainInput?.value ?? current.subjective?.pain ?? INSTRUCTOR_DEFAULTS.pain),
                anxiety: Number(teachingAnxietyInput?.value ?? current.subjective?.anxiety ?? INSTRUCTOR_DEFAULTS.anxiety),
                comfort: Number(teachingComfortInput?.value ?? current.subjective?.comfort ?? INSTRUCTOR_DEFAULTS.comfort)
            }
        };
        presets[idx] = updated;
        teachingState.manualPresets = presets;
        persistTeachingState();
        renderManualPresetGrid();
    }

    function applyManualVitals() {
        const manualTargets = {
            hr: Number(manualHrSlider?.value) || MANUAL_DEFAULTS.hr,
            sbp: Number(manualSbpSlider?.value) || MANUAL_DEFAULTS.sbp,
            dbp: Number(manualDbpSlider?.value) || MANUAL_DEFAULTS.dbp,
            rr: Number(manualRrSlider?.value) || MANUAL_DEFAULTS.rr,
            spo2: Number(manualSpo2Slider?.value) || MANUAL_DEFAULTS.spo2
        };
        const subjective = {
            pain: Number(teachingPainInput?.value ?? INSTRUCTOR_DEFAULTS.pain),
            anxiety: Number(teachingAnxietyInput?.value ?? INSTRUCTOR_DEFAULTS.anxiety),
            comfort: Number(teachingComfortInput?.value ?? computeComfortScore(teachingPainInput?.value, teachingAnxietyInput?.value))
        };
        vitalsMonitor.applyTeachingPreset({
            id: 'manual',
            targets: manualTargets,
            subjective,
            useBase: false
        });
        vitalsMonitor.setInstructorMetrics(subjective);
        vitalsMonitor.setManualMode?.(true);
        saveActiveManualPreset();
        if (typeof showToast === 'function') {
            showToast('Vitals', 'Settings applied');
        }
    }

    function resetManualVitals() {
        if (manualHrSlider) manualHrSlider.value = MANUAL_DEFAULTS.hr;
        if (manualSbpSlider) manualSbpSlider.value = MANUAL_DEFAULTS.sbp;
        if (manualDbpSlider) manualDbpSlider.value = MANUAL_DEFAULTS.dbp;
        if (manualRrSlider) manualRrSlider.value = MANUAL_DEFAULTS.rr;
        if (manualSpo2Slider) manualSpo2Slider.value = MANUAL_DEFAULTS.spo2;
        updateManualSliderDisplay();
        teachingState.selectedManualPresetId = 'baseline';
        vitalsMonitor.applyTeachingPreset({
            id: 'manual',
            targets: {
                hr: MANUAL_DEFAULTS.hr,
                sbp: MANUAL_DEFAULTS.sbp,
                dbp: MANUAL_DEFAULTS.dbp,
                rr: MANUAL_DEFAULTS.rr,
                spo2: MANUAL_DEFAULTS.spo2
            },
            subjective: {
                pain: INSTRUCTOR_DEFAULTS.pain,
                anxiety: INSTRUCTOR_DEFAULTS.anxiety,
                comfort: INSTRUCTOR_DEFAULTS.comfort
            },
            useBase: true
        });
        if (typeof showToast === 'function') {
            showToast('Vitals', 'Reset to defaults');
        }
    }

    function resetTimelineToDefaults() {
        teachingState.timeline.steps = clone(DEFAULT_TEACHING_STATE.timeline.steps);
        persistTeachingState();
        renderTimelineSteps();
        setTimelineApplyState(false);
        if (typeof showToast === 'function') {
            showToast('Timeline', 'Reset to defaults');
        }
    }

    function setTimelineApplyState(isRunning) {
        if (!timelineApplyBtn) return;
        timelineApplyBtn.classList.toggle('active', isRunning);
        timelineApplyBtn.textContent = isRunning ? 'Timeline Running' : 'Apply Timeline';
        if (timelineStatus) {
            timelineStatus.textContent = isRunning ? 'Timeline active' : '';
        }
    }

    function applyTimelineConfig() {
        persistTeachingState();
        vitalsMonitor.startTeachingTimeline?.();
        setTimelineApplyState(true);
        if (typeof showToast === 'function') {
            showToast('Timeline', 'Timeline running');
        }
    }

    function updateManualSliderDisplay() {
        if (manualHrValue && manualHrSlider) manualHrValue.textContent = manualHrSlider.value;
        if (manualSbpValue && manualSbpSlider) manualSbpValue.textContent = manualSbpSlider.value;
        if (manualDbpValue && manualDbpSlider) manualDbpValue.textContent = manualDbpSlider.value;
        if (manualRrValue && manualRrSlider) manualRrValue.textContent = manualRrSlider.value;
        if (manualSpo2Value && manualSpo2Slider) manualSpo2Value.textContent = manualSpo2Slider.value;
    }

    function bindManualSliders() {
        [manualHrSlider, manualSbpSlider, manualDbpSlider, manualRrSlider, manualSpo2Slider].forEach(slider => {
            if (slider) {
                slider.addEventListener('input', () => {
                    updateManualSliderDisplay();
                });
            }
        });

        if (manualVitalsApplyBtn) {
            manualVitalsApplyBtn.addEventListener('click', applyManualVitals);
        }

        if (manualVitalsResetBtn) {
            manualVitalsResetBtn.addEventListener('click', resetManualVitals);
        }
    }

    function bindInstructorMetricsButtons() {
        if (teachingMetricsApplyBtn) {
            teachingMetricsApplyBtn.addEventListener('click', applyInstructorMetricsFromInputs);
        }
        if (teachingMetricsResetBtn) {
            teachingMetricsResetBtn.addEventListener('click', resetInstructorMetrics);
        }
    }

    function bindTimelineButtons() {
        if (timelineResetBtn) {
            timelineResetBtn.addEventListener('click', resetTimelineToDefaults);
        }
        if (timelineApplyBtn) {
            timelineApplyBtn.addEventListener('click', applyTimelineConfig);
        }
    }

    function bindModeToggle() {
        if (!teachingOverlay) return;
        if (teachingOverlay.dataset.modeToggleBound === 'true') return;
        teachingOverlay.dataset.modeToggleBound = 'true';

        const savedMode = localStorage.getItem('teachingVitalsMode') || 'keyboard';
        setVitalsMode(savedMode);

        teachingOverlay.addEventListener('click', (event) => {
            const btn = event.target.closest('.teaching-mode-btn');
            if (!btn) return;
            setVitalsMode(btn.dataset.mode);
        });
    }

    function setActiveTab(tabName) {
        const buttons = teachingOverlay?.querySelectorAll('.teaching-tab-btn') || [];
        const panels = teachingOverlay?.querySelectorAll('.teaching-tab-panel') || [];
        buttons.forEach((btn) => {
            const isActive = btn.dataset.tab === tabName;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        panels.forEach((panel) => {
            panel.classList.toggle('active', panel.dataset.tabPanel === tabName);
        });
    }

    function bindTabs() {
        if (!teachingOverlay) return;
        if (teachingOverlay.dataset.tabsBound === 'true') return;
        teachingOverlay.dataset.tabsBound = 'true';
        teachingOverlay.addEventListener('click', (event) => {
            const btn = event.target.closest('.teaching-tab-btn');
            if (!btn) return;
            setActiveTab(btn.dataset.tab);
        });
    }

    function renderTeachingOverlay() {
        teachingState = loadTeachingState();
        cachedTeachingState = teachingState;
        persistTeachingState();
        renderTimelineSteps();
        renderEventCards();
        renderInstructorMetrics();
        renderFineTuneControls();
        renderManualSliders();
        renderManualPresetGrid();
        vitalsMonitor.renderTeachingMetrics?.();
        bindTimelineEvents();
        bindTabs();
        bindModeToggle();
        bindManualSliders();
        bindInstructorMetricsButtons();
        bindTimelineButtons();
        if (teachingAutoExpressionToggle) {
            teachingAutoExpressionToggle.checked = teachingState.autoExpressionFromVitals !== false;
        }
    }

    if (teachingPainInput) {
        teachingPainInput.addEventListener('input', () => {
            updateInstructorSliderDisplay();
        });
    }
    if (teachingAnxietyInput) {
        teachingAnxietyInput.addEventListener('input', () => {
            updateInstructorSliderDisplay();
        });
    }
    if (teachingComfortInput) {
        teachingComfortInput.addEventListener('input', () => {
            if (teachingComfortValue) teachingComfortValue.textContent = teachingComfortInput.value;
        });
        teachingComfortInput.setAttribute('disabled', 'true');
    }


    if (teachingAddStepBtn) {
        teachingAddStepBtn.addEventListener('click', addTimelineStep);
    }

    if (teachingAutoExpressionToggle) {
        teachingAutoExpressionToggle.addEventListener('change', (event) => {
            teachingState.autoExpressionFromVitals = event.target.checked;
            persistTeachingState();
        });
    }

    function openTeachingOverlay() {
        renderTeachingOverlay();
        teachingOverlay?.classList.add('open');
        teachingOverlay?.setAttribute('aria-hidden', 'false');
        teachingOverlayMask?.classList.add('open');
        teachingOverlayMask?.setAttribute('aria-hidden', 'false');
        setActiveTab('setup');
    }

    function closeTeachingOverlay() {
        teachingOverlay?.classList.remove('open');
        teachingOverlay?.setAttribute('aria-hidden', 'true');
        teachingOverlayMask?.classList.remove('open');
        teachingOverlayMask?.setAttribute('aria-hidden', 'true');
    }

    if (teachingOverlayClose) {
        teachingOverlayClose.addEventListener('click', closeTeachingOverlay);
    }

    if (teachingOverlayMask) {
        teachingOverlayMask.addEventListener('click', closeTeachingOverlay);
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (teachingOverlay?.classList.contains('open')) {
                closeTeachingOverlay();
                return;
            }
        }
        const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '');
        if (isInput || document.activeElement?.isContentEditable) return;
        if (currentVitalsMode === 'keyboard') {
            const key = event.key;
            if (/^[1-8]$/.test(key)) {
                const index = Number(key) - 1;
                const presets = teachingState.manualPresets || DEFAULT_MANUAL_PRESETS;
                const preset = presets[index];
                if (preset) {
                    event.preventDefault();
                    applyManualPreset(preset.id);
                    return;
                }
            }
        }
        if (event.ctrlKey && event.key.toLowerCase() === 'i') {
            event.preventDefault();
            // Trigger the main entry button to ensure PIN flow is respected
            const entryBtn = document.getElementById('y65InstructorEntry');
            if (entryBtn) entryBtn.click();
            return;
        }
    });

    vitalsMonitor.setTeachingConfig?.(clone(teachingState));

    return {
        openTeachingOverlay,
        closeTeachingOverlay,
        renderTeachingOverlay,
        setVitalsMode,
        applyManualPreset,
        getVitalsMode: () => currentVitalsMode
    };
}

export function getTeachingScenarioState() {
    return clone(cachedTeachingState || loadTeachingState());
}

export function getTeachingTimeline() {
    return cachedVitalsMonitor?.getTeachingTimeline?.() || [];
}

export function getTeachingLiveState() {
    return cachedVitalsMonitor?.getTeachingLiveState?.() || {};
}

export const NursingInstructorTools = {
    initInstructorTools
};
