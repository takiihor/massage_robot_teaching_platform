import { normalizeAsrForWakeWord } from './Recognition.js';

// ===== Voice Trigger Detection =====
/*
 * Module: VoiceTriggers
 * Purpose: Voice trigger detection and classification helpers.
 * Exports: VOICE_TRIGGERS, detectVoiceTrigger,
 *          isPatientQuestion, isMassageControl
 * Module bridge globals: window.VoiceTriggers, window.detectVoiceTrigger,
 *                 window.isPatientQuestion, window.isMassageControl
 *                 (via module-bridge)
 */

export const VOICE_TRIGGERS = {
    // Chinese + English patterns for massage setup
    ENTER_SETUP: ['按摩設定', '按摩設置', '按摩设置', '設定按摩', '設置按摩', '设置按摩', '開始設定', '開始設置', '開始设置', '設定模式', '開始按摩設定', '開始按摩設置', '開始按摩设置', '設定模式開始', '開始按摩', '轉換成按摩模式', '進入按摩', '按摩模式',
        'massage setting', 'massage settings', 'massage setup', 'start massage', 'massage mode', 'enter massage', 'begin massage', 'start setup', 'open setup'],
    CONFIRM_START: ['開始', '可以開始', '確認開始', '確認', 'confirm', 'start', 'yes'],
    SOFTSTOP_MASSAGE: ['停止按摩', '停止', '停', 'stop', 'pause', 'hold', 'wait', 'stop massage'],
    ENDSESSION_MASSAGE: ['結束', '結束按摩', 'end', 'end session', 'endsession', 'and session', 'finish massage', 'quit'],
    RESUME_MASSAGE: ['繼續按摩', '繼續', 'resume', 'continue', 'go on', 'keep going'],
    CANCEL_SETUP: ['取消', '唔要', '算啦', 'cancel', 'exit', 'never mind'],
    // Mode selection by number
    SELECT_MODE_1: ['模式1', '模式一', '第一個模式', '第1個模式', 'mode 1', 'mode one', 'first mode'],
    SELECT_MODE_2: ['模式2', '模式二', '第二個模式', '第2個模式', 'mode 2', 'mode two', 'second mode'],
    SELECT_MODE_3: ['模式3', '模式三', '第三個模式', '第3個模式', 'mode 3', 'mode three', 'third mode'],
    SELECT_MODE_4: ['模式4', '模式四', '第四個模式', '第4個模式', 'mode 4', 'mode four', 'fourth mode']
}

const ENGINEERING_TRIGGER_KEY_MAP = {
    ENTER_SETUP: 'ENTER_SETUP',
    CONFIRM_START: 'CONFIRM_START',
    SOFTSTOP_MASSAGE: 'SOFTSTOP_MASSAGE',
    ENDSESSION_MASSAGE: 'ENDSESSION_MASSAGE',
    RESUME_MASSAGE: 'RESUME_MASSAGE',
    CANCEL_SETUP: 'CANCEL_SETUP',
    SELECT_MODE_1: 'SELECT_MODE_1',
    SELECT_MODE_2: 'SELECT_MODE_2',
    SELECT_MODE_3: 'SELECT_MODE_3',
    SELECT_MODE_4: 'SELECT_MODE_4'
};

export function getEngineeringKeyForTrigger(trigger) {
    if (!trigger) return null;
    const key = String(trigger).trim();
    return ENGINEERING_TRIGGER_KEY_MAP[key] || null;
}

export function detectVoiceTrigger(transcript) {
    // Fallback if normalizeAsrForWakeWord is not available (e.g. Recognition.js not loaded)
    // This ensures the module is safe even if load order is wrong or dependencies are missing
    const normalize = (typeof normalizeAsrForWakeWord === 'function')
        ? normalizeAsrForWakeWord
        : (typeof window.normalizeAsrForWakeWord === 'function' ? window.normalizeAsrForWakeWord : (t) => t);

    const normalizeForMatch = (input) => {
        if (!input) return '';
        let out = normalize(input);
        out = out.toLowerCase();
        out = out.replace(/[，,。.!！？?；;：:、【】()（）「」『』"']/g, ' ');

        // English fillers
        out = out.replace(/\b(please|can\s+you|could\s+you|would\s+you|um|uh|ok|okay|hey)\b/g, ' ');

        // English numbers/ordinals
        out = out.replace(/\b(first|one)\b/g, '1');
        out = out.replace(/\b(second|two)\b/g, '2');
        out = out.replace(/\b(third|three)\b/g, '3');
        out = out.replace(/\b(fourth|four)\b/g, '4');

        // Cantonese fillers
        out = out.replace(/(唔該|麻煩|可以|幫我|請問|請)/g, '');

        // Cantonese numbers
        out = out.replace(/十五/g, '15');
        out = out.replace(/二十/g, '20');
        out = out.replace(/三十/g, '30');
        out = out.replace(/十/g, '10');
        out = out.replace(/一/g, '1');
        out = out.replace(/二/g, '2');
        out = out.replace(/三/g, '3');
        out = out.replace(/四/g, '4');
        out = out.replace(/五/g, '5');

        out = out.replace(/\s+/g, ' ').trim();
        return out;
    };

    const corrected = normalize(transcript);
    const text = normalizeForMatch(corrected);
    const rawText = normalizeForMatch(transcript);
    const compactText = text.replace(/\s+/g, '');
    const compactRaw = rawText.replace(/\s+/g, '');

    // 🔧 DEBUG: Log trigger detection
    if (transcript !== corrected) {
        console.log(`[detectVoiceTrigger] ASR corrected: "${transcript}" -> "${corrected}"`);
    }

    for (const [trigger, phrases] of Object.entries(VOICE_TRIGGERS)) {
        if (phrases.some((phrase) => {
            const normalizedPhrase = normalizeForMatch(phrase);
            if (!normalizedPhrase) return false;
            const compactPhrase = normalizedPhrase.replace(/\s+/g, '');
            return text.includes(normalizedPhrase)
                || rawText.includes(normalizedPhrase)
                || compactText.includes(compactPhrase)
                || compactRaw.includes(compactPhrase);
        })) {
            console.log(`[detectVoiceTrigger] Matched trigger: ${trigger} for text: "${text}"`);
            return trigger;
        }
    }
    return null;
}

// ===== Patient Question Detection =====
export function isPatientQuestion(text) {
    const patientPatterns = [
        /舒服/, /痛唔痛/, /痛嗎/, /有冇痛/,
        /邊度痛/, /邊一邊/, /邊個位/,
        /感覺/, /覺得/, /好啲/, /好咗/,
        /緊/, /鬆/, /想.*按/, /想.*多/
    ];
    return patientPatterns.some(p => p.test(text));
}

export function isMassageControl(text) {
    const controlPatterns = [
        /暫停/, /暂停/, /繼續/, /继续/, /恢復/, /恢复/, /停止/, /取消/, /停/,
        /大力/, /加大/, /加強/,
        /輕啲/, /減力/, /細力/,
        /慢啲/, /快啲/,
        /pause/, /resume/, /continue/, /stop/, /cancel/, /hold/, /wait/, /restart/
    ];
    return controlPatterns.some(p => p.test(text));
}
