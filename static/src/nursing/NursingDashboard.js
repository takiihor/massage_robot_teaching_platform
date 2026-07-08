/*
 * Module: NursingDashboard
 * Purpose: Main controller for Nursing Simulation Dashboard
 * Exports: createNursingDashboard, NursingDashboard
 *
 * Architecture:
 * - Base Layer: Student view (vitals cards, patient cues, actions)
 * - Overlay Layer: Instructor controls (presets, fine-tune, metrics)
 *
 * CRITICAL: Student layer must NEVER display 0-10 numeric values for Pain/Anxiety/Comfort
 */

import { VitalsSparkline } from './VitalsSparkline.js';
import { TimelineManager } from './TimelineManager.js';
import { createPatientExpressionController } from './PatientExpressionController.js';

export function createNursingDashboard(options = {}) {
    const {
        vitalsMonitor = null,
        onAskPatient = null,
        onTagObservation = null,
        onStudentStop = null
    } = options;

    // DOM Elements
    const elements = {
        // Dashboard root
        dashboardRoot: document.getElementById('nursingDashboardRoot'),

        // Vitals
        hrValue: document.getElementById('nursingHRValue'),
        hrTrend: document.getElementById('nursingHRTrend'),
        bpValue: document.getElementById('nursingBPValue'),
        bpTrend: document.getElementById('nursingBPTrend'),
        rrValue: document.getElementById('nursingRRValue'),
        rrTrend: document.getElementById('nursingRRTrend'),
        spo2Value: document.getElementById('nursingSpo2Value'),
        spo2Trend: document.getElementById('nursingSpo2Trend'),
        hrSparkline: document.getElementById('nursingHRSparkline'),
        bpSparkline: document.getElementById('nursingBPSparkline'),
        rrSparkline: document.getElementById('nursingRRSparkline'),
        spo2Sparkline: document.getElementById('nursingSpo2Sparkline'),

        // Patient State
        patientState: document.getElementById('nursingPatientState'),

        // Cues (Student view - qualitative only)
        painCue: document.getElementById('nursingPainCue'),
        anxietyCue: document.getElementById('nursingAnxietyCue'),
        comfortCue: document.getElementById('nursingComfortCue'),

        // Student Actions
        askPatient: document.getElementById('nursingAskPatient'),
        tagObservation: document.getElementById('nursingTagObservation'),
        studentStop: document.getElementById('nursingStudentStop'),

        // Instructor Overlay
        teachingOverlay: document.getElementById('teachingOverlay'),
        teachingOverlayMask: document.getElementById('teachingOverlayMask'),
        teachingOverlayClose: document.getElementById('teachingOverlayClose'),

        // Student action dialogs
        askModal: document.getElementById('nursingAskModal'),
        askModalClose: document.getElementById('nursingAskModalClose'),
        askModalSelect: document.getElementById('nursingAskModalSelect'),
        askModalInput: document.getElementById('nursingAskModalInput'),
        askModalSubmit: document.getElementById('nursingAskModalSubmit'),
        tagModal: document.getElementById('nursingTagModal'),
        tagModalClose: document.getElementById('nursingTagModalClose'),
        tagModalSelect: document.getElementById('nursingTagModalSelect'),
        tagModalInput: document.getElementById('nursingTagModalInput'),
        tagModalSubmit: document.getElementById('nursingTagModalSubmit'),
        stopModal: document.getElementById('nursingStopModal'),
        stopModalClose: document.getElementById('nursingStopModalClose'),
        stopModalCancel: document.getElementById('nursingStopModalCancel'),
        stopModalConfirm: document.getElementById('nursingStopModalConfirm'),

        // Avatar effects
        chestGlow: document.getElementById('chestGlow'),
        chestGlowRing: document.getElementById('chestGlowRing')
    };

    // State
    let isInstructorOverlayOpen = false;
    let previousVitals = {};
    let lastUpdateTimestamp = null;
    let isDataStale = false;
    let updateIntervalId = null;
    let sparklineInstances = {};
    let timelineManager = null;
    let previousCues = {};
    let expressionController = null;

    // Thresholds for trend detection (from spec)
    const TREND_THRESHOLDS = {
        hr: 1,      // ±1 bpm
        sbp: 2,     // ±2 mmHg
        dbp: 2,     // ±2 mmHg
        rr: 1,      // ±1 bpm
        spo2: 0.3   // ±0.3%
    };

    // ===== VITALS RENDERING =====
    function renderVitals(vitals) {
        if (!vitals) return;

        // HR
        if (vitals.hr != null) {
            const hrRounded = Math.round(vitals.hr);
            if (elements.hrValue) {
                elements.hrValue.textContent = hrRounded;
                animateValueChange(elements.hrValue);
            }
            if (elements.hrTrend && previousVitals.hr != null) {
                updateTrend(elements.hrTrend, vitals.hr, previousVitals.hr, 'hr');
            }
            if (sparklineInstances.hr) {
                sparklineInstances.hr.addDataPoint(vitals.hr);
            }
            // Update heartbeat pulse speed
            updateHeartbeatAnimation(vitals.hr);
        }

        // BP
        if (vitals.sbp != null && vitals.dbp != null) {
            const sbpRounded = Math.round(vitals.sbp);
            const dbpRounded = Math.round(vitals.dbp);
            if (elements.bpValue) {
                elements.bpValue.textContent = `${sbpRounded}/${dbpRounded}`;
                animateValueChange(elements.bpValue);
            }
            if (elements.bpTrend && previousVitals.sbp != null) {
                updateTrend(elements.bpTrend, vitals.sbp, previousVitals.sbp, 'sbp');
            }
            if (sparklineInstances.bp) {
                sparklineInstances.bp.addDataPoint(vitals.sbp, vitals.dbp);
            }
        }

        // RR
        if (vitals.rr != null) {
            const rrRounded = Math.round(vitals.rr);
            if (elements.rrValue) {
                elements.rrValue.textContent = rrRounded;
                animateValueChange(elements.rrValue);
            }
            if (elements.rrTrend && previousVitals.rr != null) {
                updateTrend(elements.rrTrend, vitals.rr, previousVitals.rr, 'rr');
            }
            if (sparklineInstances.rr) {
                sparklineInstances.rr.addDataPoint(vitals.rr);
            }
        }

        // SpO2
        if (vitals.spo2 != null) {
            const spo2Rounded = Math.round(vitals.spo2);
            if (elements.spo2Value) {
                elements.spo2Value.textContent = `${spo2Rounded}%`;
                animateValueChange(elements.spo2Value);
            }
            if (elements.spo2Trend && previousVitals.spo2 != null) {
                updateTrend(elements.spo2Trend, vitals.spo2, previousVitals.spo2, 'spo2');
            }
            if (sparklineInstances.spo2) {
                sparklineInstances.spo2.addDataPoint(vitals.spo2);
            }
        }

        // Store for next comparison
        previousVitals = { ...vitals };

    }

    function updateTrend(trendElement, currentValue, previousValue, vitalType = 'hr') {
        const diff = currentValue - previousValue;
        const threshold = TREND_THRESHOLDS[vitalType] || 1;

        if (Math.abs(diff) < threshold) {
            trendElement.textContent = '—';
            trendElement.style.color = '#6b7280';
            trendElement.classList.remove('trending-up', 'trending-down');
        } else if (diff > 0) {
            trendElement.textContent = '↑';
            trendElement.style.color = '#ef4444';
            trendElement.classList.add('trending-up');
            trendElement.classList.remove('trending-down');
        } else {
            trendElement.textContent = '↓';
            trendElement.style.color = '#3b82f6';
            trendElement.classList.add('trending-down');
            trendElement.classList.remove('trending-up');
        }
    }

    function animateValueChange(element) {
        element.classList.remove('updating');
        // Force reflow
        void element.offsetWidth;
        element.classList.add('updating');
        setTimeout(() => {
            element.classList.remove('updating');
        }, 400);
    }

    function updateHeartbeatAnimation(hr) {
        if (!elements.chestGlow || !elements.chestGlowRing) return;

        // Base: 1.2s for 75 bpm. Formula: 60/hr
        // Let's use a slightly faster rhythm for realism: (60 / hr)
        // Clamp between 0.3s (200 bpm) and 2.0s (30 bpm)
        const duration = Math.max(0.3, Math.min(2.0, 60 / hr));

        elements.chestGlow.style.animationDuration = `${duration}s`;
        elements.chestGlowRing.style.animationDuration = `${duration}s`;
    }


    // ===== PATIENT CUES RENDERING =====
    // CRITICAL: Must convert 0-10 numeric values to qualitative levels
    // Student layer must NEVER see numeric pain/anxiety/comfort values
    function renderCues(cues) {
        if (!cues) return;

        // Pain level (qualitative)
        if (cues.pain != null && elements.painCue) {
            const normalized = normalizeCueValue(cues.pain, 'pain');
            elements.painCue.textContent = normalized;
            if (normalized !== previousCues.pain) {
                animateCueChange(elements.painCue);
            }
            previousCues.pain = normalized;
        }

        // Anxiety level (qualitative)
        if (cues.anxiety != null && elements.anxietyCue) {
            const normalized = normalizeCueValue(cues.anxiety, 'anxiety');
            elements.anxietyCue.textContent = normalized;
            if (normalized !== previousCues.anxiety) {
                animateCueChange(elements.anxietyCue);
            }
            previousCues.anxiety = normalized;
        }

        // Comfort level (qualitative)
        if (cues.comfort != null && elements.comfortCue) {
            const normalized = normalizeCueValue(cues.comfort, 'comfort');
            elements.comfortCue.textContent = normalized;
            if (normalized !== previousCues.comfort) {
                animateCueChange(elements.comfortCue);
            }
            previousCues.comfort = normalized;
        }

    }

    function normalizeCueValue(value, type) {
        if (value == null) return 'Unknown';
        if (typeof value === 'number' || String(value).match(/^\d+(\.\d+)?$/)) {
            const numeric = typeof value === 'number' ? value : Number(value);
            return convertNumericCue(numeric, type);
        }
        const normalized = String(value).trim().toUpperCase();
        if (type === 'pain') {
            if (normalized === 'LOW') return 'Low';
            if (normalized === 'MILD') return 'Mild';
            if (normalized === 'MODERATE') return 'Moderate';
            if (normalized === 'HIGH') return 'High';
            if (normalized === 'SEVERE') return 'Severe';
        }
        if (type === 'anxiety') {
            if (normalized === 'CALM') return 'Calm';
            if (normalized === 'UNEASY') return 'Uneasy';
            if (normalized === 'TENSE') return 'Tense';
            if (normalized === 'ANXIOUS') return 'Anxious';
            if (normalized === 'PANIC') return 'Panic';
        }
        if (type === 'comfort') {
            if (normalized === 'UNCOMFORTABLE') return 'Uncomfortable';
            if (normalized === 'SLIGHTLY_UNCOMFORTABLE') return 'Slightly uncomfortable';
            if (normalized === 'NEUTRAL') return 'Neutral';
            if (normalized === 'COMFORTABLE') return 'Comfortable';
            if (normalized === 'VERY_COMFORTABLE') return 'Very comfortable';
        }
        return String(value);
    }

    function convertNumericCue(value, type) {
        const v = Math.max(0, Math.min(10, value));
        if (type === 'pain') {
            if (v <= 2) return 'Low';
            if (v <= 4) return 'Mild';
            if (v <= 6) return 'Moderate';
            if (v <= 8) return 'High';
            return 'Severe';
        }
        if (type === 'anxiety') {
            if (v <= 2) return 'Calm';
            if (v <= 4) return 'Uneasy';
            if (v <= 6) return 'Tense';
            if (v <= 8) return 'Anxious';
            return 'Panic';
        }
        if (type === 'comfort') {
            const scaled = v > 5 ? Math.round(v / 2) : v;
            if (scaled <= 1) return 'Uncomfortable';
            if (scaled <= 2) return 'Slightly uncomfortable';
            if (scaled <= 3) return 'Neutral';
            if (scaled <= 4) return 'Comfortable';
            return 'Very comfortable';
        }
        return 'Unknown';
    }

    function animateCueChange(element) {
        element.classList.remove('cue-updating');
        void element.offsetWidth;
        element.classList.add('cue-updating');
        setTimeout(() => {
            element.classList.remove('cue-updating');
        }, 400);
    }

    // ===== PATIENT STATE =====
    function updatePatientState(state = 'Stable') {
        if (elements.patientState) {
            elements.patientState.textContent = state;
        }
    }

    // ===== INSTRUCTOR OVERLAY CONTROLS =====
    function toggleInstructorOverlay() {
        const tools = window.nursingInstructorToolsInstance;
        if (tools?.openTeachingOverlay && tools?.closeTeachingOverlay) {
            const isOpen = elements.teachingOverlay?.classList.contains('open');
            if (isOpen) {
                tools.closeTeachingOverlay();
            } else {
                tools.openTeachingOverlay();
            }
            isInstructorOverlayOpen = Boolean(elements.teachingOverlay?.classList.contains('open'));
            return;
        }

        isInstructorOverlayOpen = !isInstructorOverlayOpen;

        if (isInstructorOverlayOpen) {
            openInstructorOverlay();
        } else {
            closeInstructorOverlay();
        }
    }

    function openInstructorOverlay() {
        const tools = window.nursingInstructorToolsInstance;
        if (tools?.openTeachingOverlay) {
            tools.openTeachingOverlay();
            isInstructorOverlayOpen = true;
            return;
        }
        if (!elements.teachingOverlay || !elements.teachingOverlayMask) return;

        elements.teachingOverlay.classList.add('open');
        elements.teachingOverlay.setAttribute('aria-hidden', 'false');
        elements.teachingOverlayMask.classList.add('open');

        isInstructorOverlayOpen = true;

        // Focus first interactive element in overlay
        const firstButton = elements.teachingOverlay.querySelector('button, input, select');
        if (firstButton) {
            setTimeout(() => firstButton.focus(), 100);
        }

        console.log('[NursingDashboard] Instructor overlay opened');
    }

    function closeInstructorOverlay() {
        const tools = window.nursingInstructorToolsInstance;
        if (tools?.closeTeachingOverlay) {
            tools.closeTeachingOverlay();
            isInstructorOverlayOpen = false;
            return;
        }
        if (!elements.teachingOverlay || !elements.teachingOverlayMask) return;

        elements.teachingOverlay.classList.remove('open');
        elements.teachingOverlay.setAttribute('aria-hidden', 'true');
        elements.teachingOverlayMask.classList.remove('open');

        isInstructorOverlayOpen = false;

        console.log('[NursingDashboard] Instructor overlay closed');
    }

    // ===== KEYBOARD SHORTCUTS =====
    function handleKeyboardShortcuts(event) {
        if (window.nursingInstructorToolsInstance) {
            return;
        }

        // Ctrl+I: Toggle Instructor Overlay
        if (event.ctrlKey && event.key.toLowerCase() === 'i') {
            event.preventDefault();
            toggleInstructorOverlay();
            return;
        }

        // Esc: Close Instructor Overlay (if open)
        if (event.key === 'Escape' && isInstructorOverlayOpen) {
            event.preventDefault();
            closeInstructorOverlay();
            return;
        }

        // F1-F6: Preset shortcuts (handled by instructor overlay)
        // 1-4: Event cards (handled by instructor overlay)
        // These will be implemented in Phase 3
    }

    // ===== FOCUS TRAP (for accessibility) =====
    function trapFocusInOverlay(event) {
        const overlayOpen = elements.teachingOverlay?.classList.contains('open');
        if (!overlayOpen) return;
        if (!elements.teachingOverlay) return;

        const focusableElements = elements.teachingOverlay.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.key === 'Tab') {
            if (event.shiftKey && document.activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
            } else if (!event.shiftKey && document.activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        }
    }

    // ===== STUDENT ACTIONS =====
    function handleAskPatient() {
        console.log('[NursingDashboard] Ask Patient clicked');

        if (!elements.askModal) {
            if (onAskPatient) onAskPatient();
            return;
        }
        openModal(elements.askModal);
    }

    function handleTagObservation() {
        console.log('[NursingDashboard] Tag Observation clicked');

        if (!elements.tagModal) {
            if (onTagObservation) onTagObservation();
            return;
        }
        openModal(elements.tagModal);
    }

    function handleStudentStop() {
        console.log('[NursingDashboard] Student Stop clicked');

        if (!elements.stopModal) {
            const confirmed = confirm('Student Stop: Are you sure you want to stop the simulation?');
            if (confirmed) {
                recordStudentStop();
                if (onStudentStop) onStudentStop();
            }
            return;
        }
        openModal(elements.stopModal);
    }

    function recordStudentStop() {
        if (!timelineManager) return;
        const snapshot = createSnapshot();
        timelineManager.addEvent('STUDENT_STOP', { snapshot });
    }

    function createSnapshot() {
        const liveState = vitalsMonitor?.getTeachingLiveState?.() || {};
        return {
            vitals: liveState.vitals || null,
            cues: liveState.cues || null,
            patientState: elements.patientState?.textContent || 'Unknown'
        };
    }

    function openModal(modalElement) {
        modalElement.classList.add('open');
        modalElement.setAttribute('aria-hidden', 'false');
        const focusable = modalElement.querySelector('button, input, select, textarea');
        if (focusable) {
            setTimeout(() => focusable.focus(), 60);
        }
    }

    function closeModal(modalElement) {
        modalElement.classList.remove('open');
        modalElement.setAttribute('aria-hidden', 'true');
    }

    function handleAskModalSubmit() {
        if (!timelineManager) return;
        const preset = elements.askModalSelect?.value || 'General Check-in';
        const note = (elements.askModalInput?.value || '').trim();
        timelineManager.addEvent('ASK_PATIENT', { prompt: preset, note });
        if (elements.askModalInput) elements.askModalInput.value = '';
        closeModal(elements.askModal);
        if (onAskPatient) onAskPatient({ prompt: preset, note });
    }

    function handleTagModalSubmit() {
        if (!timelineManager) return;
        const tag = elements.tagModalSelect?.value || 'Observation';
        const note = (elements.tagModalInput?.value || '').trim();
        timelineManager.addEvent('TAG_OBSERVATION', { tag, note });
        if (elements.tagModalInput) elements.tagModalInput.value = '';
        closeModal(elements.tagModal);
        if (onTagObservation) onTagObservation({ tag, note });
    }

    // ===== STALE DATA DETECTION =====
    const STALE_THRESHOLD_MS = 2000; // 2 seconds

    function checkDataStaleness() {
        if (!lastUpdateTimestamp) {
            return false; // No data yet
        }

        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateTimestamp;

        return timeSinceLastUpdate > STALE_THRESHOLD_MS;
    }

    function updateStaleIndicator() {
        const nowStale = checkDataStaleness();

        if (nowStale !== isDataStale) {
            isDataStale = nowStale;

            if (elements.dashboardRoot) {
                if (isDataStale) {
                    elements.dashboardRoot.classList.add('data-stale');
                    console.warn('[NursingDashboard] Data is stale (>2s since last update)');
                } else {
                    elements.dashboardRoot.classList.remove('data-stale');
                    console.log('[NursingDashboard] Data refreshed');
                }
            }

            // Update all vital cards to show stale state
            const vitalCards = [elements.hrValue, elements.bpValue, elements.rrValue, elements.spo2Value];
            vitalCards.forEach(card => {
                if (card) {
                    if (isDataStale) {
                        card.classList.add('stale');
                    } else {
                        card.classList.remove('stale');
                    }
                }
            });

            const cueValues = [elements.painCue, elements.anxietyCue, elements.comfortCue];
            cueValues.forEach(cue => {
                if (!cue) return;
                if (isDataStale) {
                    cue.classList.add('stale');
                } else {
                    cue.classList.remove('stale');
                }
            });

            const sparklines = [elements.hrSparkline, elements.bpSparkline, elements.rrSparkline, elements.spo2Sparkline];
            sparklines.forEach(sparkline => {
                if (!sparkline) return;
                if (isDataStale) {
                    sparkline.classList.add('stale');
                } else {
                    sparkline.classList.remove('stale');
                }
            });
        }
    }

    function showNoDataWarning() {
        // Show "No Data" in vitals if vitalsMonitor is unavailable
        const noDataText = '--';

        if (elements.hrValue) elements.hrValue.textContent = noDataText;
        if (elements.bpValue) elements.bpValue.textContent = noDataText;
        if (elements.rrValue) elements.rrValue.textContent = noDataText;
        if (elements.spo2Value) elements.spo2Value.textContent = noDataText;

        if (elements.painCue) elements.painCue.textContent = 'No Data';
        if (elements.anxietyCue) elements.anxietyCue.textContent = 'No Data';
        if (elements.comfortCue) elements.comfortCue.textContent = 'No Data';

        previousCues = {};

        Object.values(sparklineInstances).forEach((sparkline) => sparkline?.clear());

        console.warn('[NursingDashboard] No data source available');
    }

    // ===== UPDATE LOOP =====
    function update() {
        // Fail-soft: If no vitalsMonitor, show no-data state
        if (!vitalsMonitor) {
            showNoDataWarning();
            return;
        }

        try {
            // Get current state from VitalsMonitor
            const liveState = vitalsMonitor.getTeachingLiveState();

            if (liveState && liveState.vitals) {
                renderVitals(liveState.vitals);
                renderCues(liveState.cues);

                // Update patient expression with complete state
                if (expressionController && liveState.vitals && liveState.cues) {
                    const autoExpression = liveState.autoExpressionFromVitals !== false;
                    if (autoExpression) {
                        expressionController.updateExpression(liveState.vitals, liveState.cues);
                    } else {
                        expressionController.updateExpression(
                            { hr: 78, sbp: 120, dbp: 75, rr: 14, spo2: 98 },
                            { pain: 'LOW', anxiety: 'CALM', comfort: 'COMFORTABLE' }
                        );
                    }
                }

                // Update timestamp on successful data fetch
                lastUpdateTimestamp = Date.now();
            }

            // Check for stale data
            updateStaleIndicator();
        } catch (error) {
            console.error('[NursingDashboard] Error in update loop:', error);
            // Don't crash - continue with stale data
        }
    }

    // ===== INITIALIZATION =====
    function initialize() {
        console.log('[NursingDashboard] Initializing...');

        if (!timelineManager) {
            timelineManager = window.nursingTimelineManagerInstance || new TimelineManager();
            window.nursingTimelineManagerInstance = timelineManager;
        }

        sparklineInstances = {
            hr: elements.hrSparkline ? new VitalsSparkline(elements.hrSparkline, { windowSize: 120 }) : null,
            bp: elements.bpSparkline ? new VitalsSparkline(elements.bpSparkline, { windowSize: 120, hasSecondary: true }) : null,
            rr: elements.rrSparkline ? new VitalsSparkline(elements.rrSparkline, { windowSize: 120 }) : null,
            spo2: elements.spo2Sparkline ? new VitalsSparkline(elements.spo2Sparkline, { windowSize: 120 }) : null
        };

        // Initialize patient expression controller
        expressionController = createPatientExpressionController({
            avatarElement: document.getElementById('mainAvatar'),
            avatarContainer: document.querySelector('.avatar-container'),
            vitalsMonitor: vitalsMonitor
        });

        // Store globally for debugging
        window.nursingExpressionController = expressionController;

        // Bind event listeners
        if (elements.askPatient) {
            elements.askPatient.addEventListener('click', handleAskPatient);
        }

        if (elements.tagObservation) {
            elements.tagObservation.addEventListener('click', handleTagObservation);
        }

        if (elements.studentStop) {
            elements.studentStop.addEventListener('click', handleStudentStop);
        }

        if (elements.askModalClose) {
            elements.askModalClose.addEventListener('click', () => closeModal(elements.askModal));
        }
        if (elements.askModalSubmit) {
            elements.askModalSubmit.addEventListener('click', handleAskModalSubmit);
        }
        if (elements.askModal) {
            elements.askModal.addEventListener('click', (event) => {
                if (event.target === elements.askModal) closeModal(elements.askModal);
            });
        }

        if (elements.tagModalClose) {
            elements.tagModalClose.addEventListener('click', () => closeModal(elements.tagModal));
        }
        if (elements.tagModalSubmit) {
            elements.tagModalSubmit.addEventListener('click', handleTagModalSubmit);
        }
        if (elements.tagModal) {
            elements.tagModal.addEventListener('click', (event) => {
                if (event.target === elements.tagModal) closeModal(elements.tagModal);
            });
        }

        if (elements.stopModalClose) {
            elements.stopModalClose.addEventListener('click', () => closeModal(elements.stopModal));
        }
        if (elements.stopModalCancel) {
            elements.stopModalCancel.addEventListener('click', () => closeModal(elements.stopModal));
        }
        if (elements.stopModalConfirm) {
            elements.stopModalConfirm.addEventListener('click', () => {
                closeModal(elements.stopModal);
                recordStudentStop();
                if (onStudentStop) onStudentStop();
            });
        }
        if (elements.stopModal) {
            elements.stopModal.addEventListener('click', (event) => {
                if (event.target === elements.stopModal) closeModal(elements.stopModal);
            });
        }

        // Instructor overlay controls
        if (elements.teachingOverlayClose) {
            elements.teachingOverlayClose.addEventListener('click', closeInstructorOverlay);
        }

        if (elements.teachingOverlayMask) {
            elements.teachingOverlayMask.addEventListener('click', closeInstructorOverlay);
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboardShortcuts);
        document.addEventListener('keydown', trapFocusInOverlay);

        // Start update loop (500ms interval, matching VitalsMonitor)
        updateIntervalId = setInterval(update, 500);

        // Initial render
        update();
        updatePatientState('Stable');

        console.log('[NursingDashboard] Initialized successfully');
    }

    // Auto-initialize if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // ===== PUBLIC API =====
    return {
        renderVitals,
        renderCues,
        updatePatientState,
        openInstructorOverlay,
        closeInstructorOverlay,
        toggleInstructorOverlay,
        update
    };
}

// Export for module compatibility
export const NursingDashboard = {
    createNursingDashboard
};
