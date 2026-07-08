/*
 * Module: StateMachine
 * Purpose: System mode constants and massage state machine.
 * Exports: SystemMode, MassageStateMachine
 * Module bridge globals: window.SystemMode, window.MassageStateMachine (via module-bridge)
 */

export const SystemMode = {
    CHAT: 'CHAT',
    MASSAGE_SETUP: 'MASSAGE_SETUP',
    MASSAGE_RUNNING: 'MASSAGE_RUNNING'
};

export class MassageStateMachine {
    constructor() {
        // Massage-only product starts in setup mode.
        this.currentMode = SystemMode.MASSAGE_SETUP;
        console.log(`[StateMachine] Initialized in mode: ${this.currentMode}`);

        this.setupConfig = {
            pattern: null,      // 向上推/波浪推/螺旋按/揉捏
            intensity: null,    // 輕/中/大
            bodyPart: '小腿',   // Default to calf per spec
            duration: null      // minutes
        };
        this.massageIntensity = '中';  // Current intensity for patient comfort
        this.listeners = [];
    }

    getMode() { return this.currentMode; }
    getMassageIntensity() { return this.massageIntensity; }

    isInChat() { return false; }
    isInSetup() { return this.currentMode === SystemMode.MASSAGE_SETUP; }
    isRunning() { return this.currentMode === SystemMode.MASSAGE_RUNNING; }

    transitionTo(newMode, reason = '') {
        const oldMode = this.currentMode;
        if (oldMode === newMode) return false;

        // Validate transition
        if (!this._isValidTransition(oldMode, newMode)) {
            console.warn(`[StateMachine] Invalid transition: ${oldMode} -> ${newMode}`);
            return false;
        }

        // 🔧 Persistence removed to ensure cold load always defaults to Massage Setup
        this.currentMode = newMode;
        // localStorage.setItem('systemMode', newMode);
        console.log(`[StateMachine] ${oldMode} -> ${newMode} (${reason})`);

        // Notify listeners
        this.listeners.forEach(fn => fn(newMode, oldMode, reason));
        return true;
    }

    _isValidTransition(from, to) {
        const validTransitions = {
            [SystemMode.CHAT]: [SystemMode.MASSAGE_SETUP],
            [SystemMode.MASSAGE_SETUP]: [SystemMode.MASSAGE_RUNNING],
            // 🔧 FIX: Allow RUNNING -> SETUP for starting new massage after completion
            [SystemMode.MASSAGE_RUNNING]: [SystemMode.MASSAGE_SETUP],
        };
        return validTransitions[from]?.includes(to) ?? false;
    }

    onModeChange(callback) {
        this.listeners.push(callback);
    }

    resetSetupConfig() {
        this.setupConfig = { pattern: null, intensity: null, bodyPart: '小腿', duration: null };
    }

    setMassageIntensity(intensity) {
        this.massageIntensity = intensity;
    }
}
