/*
 * Module: PatientExpressionController
 * Purpose: Dynamic patient avatar expression controller based on vital signs
 * Exports: createPatientExpressionController, PatientExpressionController
 *
 * Features:
 * - Breathing animation synced to RR (Respiratory Rate)
 * - Pulse border animation synced to HR (Heart Rate)
 * - Emotional state filters based on Pain and Anxiety
 * - Blood pressure warnings (hypertension)
 * - SpO2 warnings (hypoxia)
 * - Micro-movements for life-like behavior
 */

export function createPatientExpressionController(options = {}) {
    const {
        avatarElement = document.getElementById('mainAvatar'),
        avatarContainer = document.querySelector('.avatar-container'),
        vitalsMonitor = null
    } = options;

    // State
    let currentState = {
        hr: 78,
        sbp: 120,
        dbp: 75,
        rr: 14,
        spo2: 98,
        pain: 'LOW',
        anxiety: 'CALM',
        comfort: 'COMFORTABLE'
    };

    let activeClasses = new Set();

    // Thresholds
    const THRESHOLDS = {
        hr: {
            low: 60,
            normal_low: 70,
            normal_high: 90,
            high: 100,
            critical: 120
        },
        sbp: {
            normal: 120,
            elevated: 130,
            hypertension: 140,
            crisis: 180
        },
        rr: {
            low: 12,
            normal: 16,
            high: 20,
            critical: 24
        },
        spo2: {
            critical: 88,
            low: 92,
            normal: 95
        }
    };

    // ===== HELPER FUNCTIONS =====

    function addClass(className) {
        if (!avatarElement) return;
        if (!activeClasses.has(className)) {
            avatarElement.classList.add(className);
            activeClasses.add(className);
        }
    }

    function removeClass(className) {
        if (!avatarElement) return;
        if (activeClasses.has(className)) {
            avatarElement.classList.remove(className);
            activeClasses.delete(className);
        }
    }

    function clearStateClasses() {
        const stateClasses = [
            'state-calm', 'state-uneasy', 'state-distress', 'state-severe',
            'breathing', 'rapid-breathing', 'micro-active',
            'hypertension', 'hypoxia', 'transitioning'
        ];

        stateClasses.forEach(cls => removeClass(cls));

        if (avatarContainer) {
            avatarContainer.classList.remove(
                'pulse-sync', 'high-hr', 'low-hr',
                'hypertension', 'hypoxia'
            );
        }
    }

    function setBreathingAnimation(rr) {
        if (!avatarElement) return;

        // Calculate breathing duration: 60 / RR seconds
        const breathingDuration = Math.max(1.5, Math.min(8, 60 / rr));
        avatarElement.style.setProperty('--breathing-duration', `${breathingDuration}s`);

        addClass('breathing');

        // If RR is high, add rapid breathing
        if (rr > THRESHOLDS.rr.high) {
            addClass('rapid-breathing');
        } else {
            removeClass('rapid-breathing');
        }

        console.log(`[PatientExpression] Breathing animation: ${breathingDuration.toFixed(1)}s (RR: ${rr})`);
    }

    function setPulseAnimation(hr) {
        if (!avatarContainer) return;

        // Calculate pulse duration: 60 / HR seconds
        const pulseDuration = Math.max(0.4, Math.min(2, 60 / hr));
        avatarContainer.style.setProperty('--pulse-duration', `${pulseDuration}s`);

        avatarContainer.classList.add('pulse-sync');

        // High HR indicator
        if (hr > THRESHOLDS.hr.high) {
            avatarContainer.classList.add('high-hr');
            avatarContainer.classList.remove('low-hr');
        }
        // Low HR indicator
        else if (hr < THRESHOLDS.hr.low) {
            avatarContainer.classList.add('low-hr');
            avatarContainer.classList.remove('high-hr');
        }
        // Normal HR
        else {
            avatarContainer.classList.remove('high-hr', 'low-hr');
        }

        console.log(`[PatientExpression] Pulse animation: ${pulseDuration.toFixed(2)}s (HR: ${hr})`);
    }

    function setEmotionalState(pain, anxiety) {
        // Clear previous emotional states
        removeClass('state-calm');
        removeClass('state-uneasy');
        removeClass('state-distress');
        removeClass('state-severe');

        // Normalize pain and anxiety to numeric scale (0-10)
        const painLevel = normalizeCueToNumeric(pain, 'pain');
        const anxietyLevel = normalizeCueToNumeric(anxiety, 'anxiety');

        // Calculate combined distress level
        const distressLevel = Math.max(painLevel, anxietyLevel);

        // Apply emotional state class
        if (distressLevel <= 2) {
            addClass('state-calm');
        } else if (distressLevel <= 5) {
            addClass('state-uneasy');
        } else if (distressLevel <= 8) {
            addClass('state-distress');
        } else {
            addClass('state-severe');
        }

        console.log(`[PatientExpression] Emotional state: Pain=${pain} (${painLevel}), Anxiety=${anxiety} (${anxietyLevel}), Distress=${distressLevel}`);
    }

    function normalizeCueToNumeric(value, type) {
        if (typeof value === 'number') return value;

        const normalized = String(value || '').toUpperCase();

        if (type === 'pain') {
            if (normalized === 'LOW') return 2;
            if (normalized === 'MODERATE') return 5;
            if (normalized === 'HIGH') return 8;
            if (normalized === 'SEVERE') return 10;
        }

        if (type === 'anxiety') {
            if (normalized === 'CALM') return 2;
            if (normalized === 'UNEASY') return 5;
            if (normalized === 'PANIC') return 9;
        }

        return 5; // Default moderate level
    }

    function setBloodPressureWarning(sbp) {
        if (!avatarElement || !avatarContainer) return;

        // Hypertension warning
        if (sbp >= THRESHOLDS.sbp.hypertension) {
            addClass('hypertension');
            avatarContainer.classList.add('hypertension');
            console.log(`[PatientExpression] Hypertension warning: SBP=${sbp}`);
        } else {
            removeClass('hypertension');
            avatarContainer.classList.remove('hypertension');
        }
    }

    function setOxygenWarning(spo2) {
        if (!avatarElement || !avatarContainer) return;

        // Hypoxia warning
        if (spo2 < THRESHOLDS.spo2.low) {
            addClass('hypoxia');
            avatarContainer.classList.add('hypoxia');
            console.log(`[PatientExpression] Hypoxia warning: SpO2=${spo2}%`);
        } else {
            removeClass('hypoxia');
            avatarContainer.classList.remove('hypoxia');
        }
    }

    function enableMicroMovements() {
        addClass('micro-active');
    }

    // ===== UPDATE FUNCTION =====
    function updateExpression(vitals = {}, cues = {}) {
        if (!avatarElement) {
            console.warn('[PatientExpression] Avatar element not found');
            return;
        }

        // Add transitioning class for smooth changes
        addClass('transitioning');

        // Update state
        currentState = {
            hr: vitals.hr ?? currentState.hr,
            sbp: vitals.sbp ?? currentState.sbp,
            dbp: vitals.dbp ?? currentState.dbp,
            rr: vitals.rr ?? currentState.rr,
            spo2: vitals.spo2 ?? currentState.spo2,
            pain: cues.pain ?? currentState.pain,
            anxiety: cues.anxiety ?? currentState.anxiety,
            comfort: cues.comfort ?? currentState.comfort
        };

        // Apply animations and effects

        // 1. Breathing animation (based on RR)
        if (currentState.rr != null) {
            setBreathingAnimation(currentState.rr);
        }

        // 2. Pulse animation (based on HR)
        if (currentState.hr != null) {
            setPulseAnimation(currentState.hr);
        }

        // 3. Emotional state (based on Pain & Anxiety)
        if (currentState.pain != null && currentState.anxiety != null) {
            setEmotionalState(currentState.pain, currentState.anxiety);
        }

        // 4. Blood pressure warning
        if (currentState.sbp != null) {
            setBloodPressureWarning(currentState.sbp);
        }

        // 5. Oxygen saturation warning
        if (currentState.spo2 != null) {
            setOxygenWarning(currentState.spo2);
        }

        // Remove transitioning class after animation completes
        setTimeout(() => {
            removeClass('transitioning');
        }, 1500);
    }

    // ===== INITIALIZATION =====
    function initialize() {
        console.log('[PatientExpression] Initializing...');

        if (!avatarElement) {
            console.error('[PatientExpression] Avatar element (#mainAvatar) not found');
            return;
        }

        if (!avatarContainer) {
            console.warn('[PatientExpression] Avatar container not found');
        }

        // Enable micro-movements
        enableMicroMovements();

        // Initial state
        updateExpression(
            {
                hr: currentState.hr,
                sbp: currentState.sbp,
                dbp: currentState.dbp,
                rr: currentState.rr,
                spo2: currentState.spo2
            },
            {
                pain: currentState.pain,
                anxiety: currentState.anxiety,
                comfort: currentState.comfort
            }
        );

        console.log('[PatientExpression] Initialized successfully');
    }

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // ===== PUBLIC API =====
    return {
        updateExpression,
        clearStateClasses,
        getCurrentState: () => ({ ...currentState }),
        setBreathingAnimation,
        setPulseAnimation,
        setEmotionalState,
        setBloodPressureWarning,
        setOxygenWarning,
        enableMicroMovements
    };
}

// Export for module compatibility
export const PatientExpressionController = {
    createPatientExpressionController
};
