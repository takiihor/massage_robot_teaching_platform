/*
 * module-bridge.js
 * The ONLY place where ESM modules are exposed as window.* globals.
 * app.js must never import from src/** directly.
 */

// Legacy global mappings (single source of truth):
// - Core: SystemMode, MassageStateMachine
// - UI: ModeIndicator, showModeToast, applyModeUI, initChatModeToggle
// - Voice: AudioAssetLibrary, AudioManager, AudioPriority, audioDebugLog,
//          setTtsIndicator, stopAllTTS, isTTSActive, speakWithVoice,
//          speakAsMassageRobot, speakAsPatient
// - Recognition: initBrowserSpeechRecognition, initSetupSpeechRecognition,
//                startSetupSpeechRecognition, stopSetupSpeechRecognition,
//                normalizeAsrForWakeWord, getASRLanguage, WakeWordDetector, getWakeWord, updateWakeWord,
//                browserRecognition, _asrIsReady, lastRecognitionActivity, wakeWordDetector
// - VoiceTriggers: VoiceTriggers, detectVoiceTrigger, getEngineeringKeyForTrigger,
//                  isPatientQuestion, isMassageControl
// - Massage: RobotController, SessionCore
// - Listening: createMassageListening, createFollowUpListening, createAlwaysListening
// - Setup Wizard: SetupWizardCore, SetupWizardUI
// - Nursing: NursingVitalsMonitor, NursingInstructorTools,
//            getTeachingScenarioState, getTeachingTimeline, getTeachingLiveState

import { MassageStateMachine, SystemMode } from './src/core/StateMachine.js';
import {
    ModeIndicator,
    applyModeUI,
    initChatModeToggle,
    initModeIndicator,
    showModeToast
} from './src/ui/ModeIndicator.js';
import { AudioAssetLibrary } from './src/voice/AudioAssets.js';
import { AudioManager, AudioPriority, audioDebugLog } from './src/voice/AudioManager.js';
import {
    isTTSActive,
    setTtsIndicator,
    speakAsMassageRobot,
    speakAsPatient,
    speakWithVoice,
    stopAllTTS
} from './src/voice/TTSPlayer.js';
import {
    WakeWordDetector,
    getASRLanguage,
    getAsrReady,
    getBrowserRecognition,
    getLastRecognitionActivity,
    getWakeWord,
    getWakeWordDetector,
    initBrowserSpeechRecognition,
    initSetupSpeechRecognition,
    normalizeAsrForWakeWord,
    startSetupSpeechRecognition,
    stopSetupSpeechRecognition,
    updateWakeWord
} from './src/voice/Recognition.js';
import {
    VOICE_TRIGGERS,
    detectVoiceTrigger,
    getEngineeringKeyForTrigger,
    isMassageControl,
    isPatientQuestion
} from './src/voice/VoiceTriggers.js';
import { RobotController } from './src/massage/RobotController.js';
import { SessionCore } from './src/massage/SessionManager.js';
import { createMassageListening } from './src/voice/MassageListening.js';
import { createFollowUpListening } from './src/voice/FollowUpListening.js';
import { createAlwaysListening } from './src/voice/AlwaysListening.js';
import { SetupWizardCore } from './src/massage/SetupWizardCore.js';
import { SetupWizardUI } from './src/ui/SetupWizardUI.js';
import { NursingVitalsMonitor } from './src/nursing/VitalsMonitor.js';
import { NursingDashboard } from './src/nursing/NursingDashboard.js';
import { DebriefPanel } from './src/nursing/DebriefPanel.js';
import {
    NursingInstructorTools,
    getTeachingLiveState,
    getTeachingScenarioState,
    getTeachingTimeline
} from './src/nursing/InstructorTools.js';
import { NursingScenarioController } from './src/nursing/ScenarioController.js?v=5';

export const MODULE_BRIDGE_VERSION = '1.0';

export function attachModuleGlobals() {
    window.MODULE_BRIDGE_VERSION = MODULE_BRIDGE_VERSION;
    window.MassageStateMachine = MassageStateMachine;
    window.SystemMode = SystemMode;

    window.showModeToast = showModeToast;
    window.applyModeUI = applyModeUI;
    window.initChatModeToggle = initChatModeToggle;
    window.ModeIndicator = ModeIndicator;
    window.ModeIndicator.initModeIndicator = initModeIndicator;
    window.ModeIndicator.showModeToast = showModeToast;
    window.ModeIndicator.applyModeUI = applyModeUI;
    window.ModeIndicator.initChatModeToggle = initChatModeToggle;

    window.AudioAssetLibrary = AudioAssetLibrary;

    window.AudioPriority ||= AudioPriority;
    window.AudioManager ||= AudioManager;
    window.audioDebugLog ||= audioDebugLog;

    window.setTtsIndicator = setTtsIndicator;
    window.stopAllTTS = stopAllTTS;
    window.isTTSActive = isTTSActive;
    window.speakWithVoice = speakWithVoice;
    window.speakAsMassageRobot = speakAsMassageRobot;
    window.speakAsPatient = speakAsPatient;

    window.initBrowserSpeechRecognition = initBrowserSpeechRecognition;
    window.initSetupSpeechRecognition = initSetupSpeechRecognition;
    window.startSetupSpeechRecognition = startSetupSpeechRecognition;
    window.stopSetupSpeechRecognition = stopSetupSpeechRecognition;
    window.normalizeAsrForWakeWord = normalizeAsrForWakeWord;
    window.getASRLanguage = getASRLanguage;
    window.WakeWordDetector = WakeWordDetector;
    window.getWakeWord = getWakeWord;
    window.updateWakeWord = updateWakeWord;

    window.VoiceTriggers = {
        detect: detectVoiceTrigger,
        detectVoiceTrigger,
        isPatientQuestion,
        isMassageControl,
        getEngineeringKey: getEngineeringKeyForTrigger,
        getEngineeringKeyForTrigger,
        VOICE_TRIGGERS
    };

    window.detectVoiceTrigger ||= detectVoiceTrigger;
    window.getEngineeringKeyForTrigger ||= getEngineeringKeyForTrigger;
    window.isPatientQuestion ||= isPatientQuestion;
    window.isMassageControl ||= isMassageControl;

    window.browserRecognition ||= getBrowserRecognition();
    window._asrIsReady ||= getAsrReady();
    window.lastRecognitionActivity ||= getLastRecognitionActivity();
    window.wakeWordDetector ||= getWakeWordDetector();

    window.RobotController = RobotController;
    window.SessionCore ||= SessionCore;

    window.createMassageListening = createMassageListening;
    window.createFollowUpListening = createFollowUpListening;
    window.createAlwaysListening = createAlwaysListening;

    window.SetupWizardCore ||= SetupWizardCore;
    window.SetupWizardUI ||= SetupWizardUI;

    window.NursingVitalsMonitor ||= NursingVitalsMonitor;
    window.NursingDashboard ||= NursingDashboard;
    window.NursingDebriefPanel ||= DebriefPanel;
    window.NursingInstructorTools ||= NursingInstructorTools;
    window.NursingScenarioController ||= NursingScenarioController;
    window.getTeachingScenarioState = getTeachingScenarioState;
    window.getTeachingTimeline = getTeachingTimeline;
    window.getTeachingLiveState = getTeachingLiveState;

    const host = window?.location?.hostname || '';
    const isDevHost = host === 'localhost' || host === '127.0.0.1';
    if (isDevHost) {
        const missing = [];
        if (!window.SystemMode) missing.push('SystemMode');
        if (!window.AudioManager) missing.push('AudioManager');
        if (!window.SetupWizardCore) missing.push('SetupWizardCore');
        if (!window.SetupWizardUI) missing.push('SetupWizardUI');
        if (!window.NursingVitalsMonitor) missing.push('NursingVitalsMonitor');
        if (missing.length) {
            console.warn('[module-bridge] Missing globals:', missing.join(', '));
        }
    }

    // Virtual time chip display
    document.addEventListener('scenarioVirtualTimeUpdate', (e) => {
        const {
            virtualElapsedSec = 0,
            active = true,
            label = 'Massage Timer / 按摩時間',
            status = 'RUNNING',
            stageId = ''
        } = e.detail || {};
        const container = document.getElementById('y65VirtualTimeContainer');
        const chip = document.getElementById('y65VirtualTimeChip');
        const text = document.getElementById('y65VirtualTimeText');
        const labelEl = document.getElementById('y65VirtualTimeLabel');
        const statusEl = document.getElementById('y65VirtualTimeStatus');
        if (!container) return;
        if (!active) { container.style.display = 'none'; return; }
        container.style.display = '';
        chip.dataset.timerStatus = status;
        if (labelEl) labelEl.textContent = label;
        if (text) {
            let displaySec = virtualElapsedSec;
            if (String(stageId).endsWith('_1_2')) {
                if (!Number.isFinite(displaySec) || displaySec < 300 || displaySec >= 1200) {
                    displaySec = 300;
                }
            }
            const m = Math.floor(displaySec / 60);
            const s = Math.floor(displaySec % 60);
            text.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        }
        if (statusEl) {
            statusEl.textContent = status;
        }
    });

    // Fallback: hide timer container when session ends (ensures cleanup even if scenario controller misses the event)
    document.addEventListener('massageSessionEnded', () => {
        const container = document.getElementById('y65VirtualTimeContainer');
        if (container) container.style.display = 'none';
    });

    // Voice selector persistence
    document.addEventListener('change', (e) => {
        if (e.target?.id === 'nursingScenarioVoiceSelect') {
            window.nursingScenarioVoice = e.target.value;
        }
    });
}
