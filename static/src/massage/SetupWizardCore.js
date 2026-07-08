/*
 * Module: SetupWizardCore
 * Purpose: Massage setup parsing and state transitions.
 * Exports: create, utils, SetupWizardCore
 * Module bridge globals: window.SetupWizardCore (via module-bridge)
 */

// ===== SetupWizardCore - Pure state machine for massage setup wizard =====
// Extracted from app.js (Step 14a)
// This module contains ONLY pure logic: parsing, validation, state transitions.
// NO DOM, NO audio, NO robot calls, NO TTS - all side effects stay in app.js.

'use strict';

// ===== Constants =====
const INITIAL_STATE = {
    step: 0,          // 0: not started, 1: mode, 2: intensity, 3: duration, 4: confirm, 'simple', 'simpleConfirm'
    mode: null,
    intensity: null,
    bodyPart: '小腿', // Fixed to calf per spec
    duration: null
};

const SIMPLE_MODE_DEFAULTS = {
    force_level: 1,   // Light intensity (小)
    duration_min: 1   // 1 minute
};

const PROMPT_KEYS = {
    mode: 'mode',
    intensity: 'intensity',
    duration: 'duration',
    confirm: 'confirm',
    simple: 'simple',
    simpleConfirm: 'simpleConfirm'
};

const VALID_MODES = ['向上推', '波浪推', '螺旋按', '揉捏'];
const VALID_INTENSITIES = ['小', '中', '大'];
const INTENSITY_MAP = { 1: '小', 2: '中', 3: '大' };

// ===== String Utilities (pure) =====
function levenshtein(a, b) {
    const s = (a || '');
    const t = (b || '');
    const n = s.length;
    const m = t.length;
    if (n === 0) return m;
    if (m === 0) return n;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i <= n; i++) dp[i][0] = i;
    for (let j = 0; j <= m; j++) dp[0][j] = j;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const cost = s[i - 1] === t[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[n][m];
}

function closestMatch(input, candidates, maxDistance = 1) {
    let best = null;
    let bestD = Infinity;
    for (const c of candidates) {
        const d = levenshtein(input, c);
        if (d < bestD) {
            bestD = d;
            best = c;
        }
    }
    return bestD <= maxDistance ? best : null;
}

function normalizeSetupNumberToken(raw) {
    const t = String(raw || '').trim();
    if (!t) return t;
    const map = {
        '一': '一', '壹': '一', '日': '一', '逸': '一', '溢': '一', '衣': '一',
        '二': '二', '貳': '二', '易': '二', '異': '二', '義': '二', '耳': '二', '以': '二', '意': '二',
        '三': '三', '叄': '三', '參': '三', '衫': '三', '山': '三', '散': '三',
        '四': '四', '肆': '四', '死': '四', '細': '四', '勢': '四', '西': '四', '世': '四',
    };
    if (t.length === 1 && map[t]) return map[t];
    return t;
}

function normalizeAsrForSetupStep1Mode(text) {
    let t = String(text || '').trim();
    if (!t) return t;
    t = t.replace(/\s+/g, '');
    t = t.replace(/模式([1-4])/g, '模式$1').replace(/第([1-4])/g, '第$1');
    t = t.replace(/(模式|第)(.)/g, (m, p1, p2) => `${p1}${normalizeSetupNumberToken(p2)}`);
    if (t.length === 1) return normalizeSetupNumberToken(t);
    return t;
}

function normalizeAsrForSetup(input, step) {
    let t = (input || '').trim();
    if (!t) return t;

    t = t.replace(/[，,。.!！？?；;：:、】【()（）「」『』""\"']/g, ' ').replace(/\s+/g, ' ').trim();

    t = t
        .replace(/(模式|第)\s*[日逸衣]/g, '$1一')
        .replace(/(模式|第)\s*[易二貳]/g, '$1二')
        .replace(/(模式|第)\s*[山三衫參叄散]/g, '$1三')
        .replace(/(模式|第)\s*[事四肆死細]/g, '$1四');

    if (step === 1) {
        t = normalizeAsrForSetupStep1Mode(t);
    }

    return t;
}

// ===== Parsing Functions (pure) =====
function extractMode(text) {
    const t = (text || '').toLowerCase();

    // Chinese mode names
    if (t.includes('向上推') || t.includes('向上')) return '向上推';
    if (t.includes('波浪推') || t.includes('波浪')) return '波浪推';
    if (t.includes('螺旋按') || t.includes('螺旋')) return '螺旋按';
    if (t.includes('揉捏') || t.includes('揉')) return '揉捏';

    // English mode names
    if (t.includes('push up') || t.includes('push')) return '向上推';
    if (t.includes('wave')) return '波浪推';
    if (t.includes('spiral')) return '螺旋按';
    if (t.includes('knead')) return '揉捏';

    // Mode numbers with context
    if (/模式\s*[1一]|第一|mode\s*1/i.test(t)) return '向上推';
    if (/模式\s*[2二]|第二|mode\s*2/i.test(t)) return '波浪推';
    if (/模式\s*[3三]|第三|mode\s*3/i.test(t)) return '螺旋按';
    if (/模式\s*[4四]|第四|mode\s*4/i.test(t)) return '揉捏';

    return null;
}

function extractForceLevel(text) {
    const t = (text || '').toLowerCase();

    if (/輕力度|輕力道|力度小|力道小|輕|小力|light/i.test(t)) return 1;
    if (/中力度|中力道|力度中|力道中|中等|medium|normal/i.test(t)) return 2;
    if (/重力度|大力度|強力度|力度大|力道大|大力|強|重|strong|heavy/i.test(t)) return 3;

    const m = t.match(/(?:力度|力道|強度)\s*([123一二三])/);
    if (m) return { '1': 1, '2': 2, '3': 3, '一': 1, '二': 2, '三': 3 }[m[1]];

    return null;
}

function extractDurationMin(text) {
    const t = (text || '').toLowerCase();

    const num = t.match(/(\d+)\s*(?:分鐘|min|minute)/i);
    if (num) {
        const n = parseInt(num[1], 10);
        return [1, 3, 5].includes(n) ? n : null;
    }

    const cn = t.match(/(一|三|五)\s*分鐘/);
    if (cn) return { '一': 1, '三': 3, '五': 5 }[cn[1]];

    return null;
}

function parseSimpleSetupUtterance(input) {
    const text = (input || '').toLowerCase();
    return {
        mode: extractMode(text),
        force_level: extractForceLevel(text),
        duration_min: extractDurationMin(text)
    };
}

// ===== Mode Parsing for Advanced Step 1 =====
function parseModeFromInput(lowerInput) {
    // Chinese mode names
    if (lowerInput.includes('向上推') || lowerInput.includes('向上')) return '向上推';
    if (lowerInput.includes('波浪推') || lowerInput.includes('波浪')) return '波浪推';
    if (lowerInput.includes('螺旋按') || lowerInput.includes('螺旋')) return '螺旋按';
    if (lowerInput.includes('揉捏') || lowerInput.includes('揉')) return '揉捏';

    // English mode names
    if (lowerInput.includes('push up') || lowerInput.includes('push')) return '向上推';
    if (lowerInput.includes('wave')) return '波浪推';
    if (lowerInput.includes('spiral')) return '螺旋按';
    if (lowerInput.includes('knead')) return '揉捏';

    // Bare numbers
    if (lowerInput === '1' || lowerInput === '一' || lowerInput === 'one' || lowerInput === 'first') return '向上推';
    if (lowerInput === '2' || lowerInput === '二' || lowerInput === 'two' || lowerInput === 'second') return '波浪推';
    if (lowerInput === '3' || lowerInput === '三' || lowerInput === 'three' || lowerInput === 'third') return '螺旋按';
    if (lowerInput === '4' || lowerInput === '四' || lowerInput === 'four' || lowerInput === 'fourth') return '揉捏';

    // Mode numbers with context
    if (lowerInput.includes('模式1') || lowerInput.includes('模式一') || lowerInput.includes('第一') ||
        lowerInput.includes('mode 1') || lowerInput.includes('mode one')) return '向上推';
    if (lowerInput.includes('模式2') || lowerInput.includes('模式二') || lowerInput.includes('第二') ||
        lowerInput.includes('mode 2') || lowerInput.includes('mode two')) return '波浪推';
    if (lowerInput.includes('模式3') || lowerInput.includes('模式三') || lowerInput.includes('第三') ||
        lowerInput.includes('mode 3') || lowerInput.includes('mode three')) return '螺旋按';
    if (lowerInput.includes('模式4') || lowerInput.includes('模式四') || lowerInput.includes('第四') ||
        lowerInput.includes('mode 4') || lowerInput.includes('mode four')) return '揉捏';

    return null;
}

// ===== Intensity Parsing for Advanced Step 2 =====
function parseIntensityFromInput(lowerInput) {
    // Light
    if (lowerInput.includes('小') || lowerInput.includes('輕') || lowerInput.includes('細') ||
        lowerInput.includes('弱') || lowerInput.includes('低') ||
        lowerInput.includes('light') || lowerInput.includes('soft') || lowerInput.includes('gentle') ||
        lowerInput.includes('mild') ||
        lowerInput === '1' || lowerInput === 'one' || lowerInput === 'first') {
        return '小';
    }

    // Medium
    if (lowerInput.includes('中') || lowerInput.includes('適中') || lowerInput.includes('普通') ||
        lowerInput.includes('一般') || lowerInput.includes('正常') ||
        lowerInput.includes('medium') || lowerInput.includes('normal') || lowerInput.includes('moderate') ||
        lowerInput.includes('regular') ||
        lowerInput === '2' || lowerInput === 'two' || lowerInput === 'second') {
        return '中';
    }

    // Strong
    if (lowerInput.includes('大') || lowerInput.includes('強') || lowerInput.includes('重') ||
        lowerInput.includes('高') || lowerInput.includes('猛') || lowerInput.includes('大力') ||
        lowerInput.includes('strong') || lowerInput.includes('hard') || lowerInput.includes('heavy') ||
        lowerInput.includes('deep') || lowerInput.includes('firm') ||
        lowerInput === '3' || lowerInput === 'three' || lowerInput === 'third') {
        return '大';
    }

    return null;
}

// ===== Duration Parsing for Advanced Step 3 =====
function parseDurationFromInput(lowerInput) {
    // English words and Chinese characters first
    if (lowerInput.includes('one') || lowerInput.includes('一')) return 1;
    if (lowerInput.includes('three') || lowerInput.includes('三')) return 3;
    if (lowerInput.includes('five') || lowerInput.includes('五')) return 5;
    if (lowerInput.includes('ten') || (lowerInput.includes('十') &&
        !lowerInput.includes('十五') && !lowerInput.includes('二十') && !lowerInput.includes('三十'))) return 10;
    if (lowerInput.includes('fifteen') || lowerInput.includes('十五')) return 15;
    if (lowerInput.includes('twenty') || lowerInput.includes('二十') || lowerInput.includes('廿')) return 20;
    if (lowerInput.includes('thirty') || lowerInput.includes('三十') ||
        lowerInput.includes('半個鐘') || lowerInput.includes('half hour') || lowerInput.includes('half an hour')) return 30;

    // Try to extract any number
    const numMatch = lowerInput.match(/(\d+)/);
    if (numMatch) {
        let duration = parseInt(numMatch[1]);
        if (duration > 60) duration = 60;  // Cap at 60 minutes
        if (duration < 1) duration = 1;    // Minimum 1 minute
        return duration;
    }

    return null;
}

// ===== Confirm/Cancel Detection =====
function isConfirmInput(lowerInput) {
    return lowerInput.includes('確認') || lowerInput.includes('好') || lowerInput.includes('開始') ||
           lowerInput.includes('係') ||
           lowerInput.includes('yes') || lowerInput.includes('okay') || lowerInput.includes('ok') ||
           lowerInput.includes('start') ||
           lowerInput.includes('confirm') || lowerInput.includes('sure') || lowerInput.includes('begin') ||
           lowerInput.includes('go');
}

function isCancelInput(lowerInput) {
    return lowerInput.includes('取消') || lowerInput.includes('唔好') || lowerInput.includes('唔係') ||
           lowerInput.includes('no') || lowerInput.includes('cancel') || lowerInput.includes('stop') ||
           lowerInput.includes('nevermind');
}

// ===== Jog Direction Detection =====
function detectJogDirection(lowerInput) {
    if (lowerInput.includes('上') || lowerInput.includes('up') || lowerInput.includes('higher')) {
        if (!lowerInput.includes('向上推')) return 'up';
    }
    if (lowerInput.includes('下') || lowerInput.includes('down') || lowerInput.includes('lower')) {
        return 'down';
    }
    return null;
}

// ===== Core State Machine =====
export function create(initialState) {
    let state = { ...INITIAL_STATE, ...(initialState || {}) };
    let isSimpleMode = false;

    function reset(useSimpleMode = false) {
        isSimpleMode = useSimpleMode;
        state = {
            ...INITIAL_STATE,
            step: useSimpleMode ? 'simple' : 1
        };
        return { ...state };
    }

    function getState() {
        return { ...state };
    }

    function isActive() {
        return state.step !== 0;
    }

    function setSimpleMode(enabled) {
        isSimpleMode = enabled;
    }

    function handleInput(rawInput) {
        const corrected = normalizeAsrForSetup(rawInput, state.step);
        const lowerInput = (corrected || rawInput || '').toLowerCase();

        // Check for jog command (valid in any step)
        const jogDir = detectJogDirection(lowerInput);
        if (jogDir) {
            return {
                action: 'JOG',
                direction: jogDir,
                nextState: { ...state },
                debug: { rawInput, corrected, jogDir }
            };
        }

        switch (state.step) {
            case 'simple':
                return handleSimpleStep(lowerInput, rawInput, corrected);

            case 'simpleConfirm':
                return handleSimpleConfirmStep(lowerInput, rawInput, corrected);

            case 1:
                return handleModeStep(lowerInput, rawInput, corrected);

            case 2:
                return handleIntensityStep(lowerInput, rawInput, corrected);

            case 3:
                return handleDurationStep(lowerInput, rawInput, corrected);

            case 4:
                return handleConfirmStep(lowerInput, rawInput, corrected);

            default:
                return {
                    action: 'NOOP',
                    nextState: { ...state },
                    debug: { rawInput, step: state.step }
                };
        }
    }

    function handleSimpleStep(lowerInput, rawInput, corrected) {
        const parsed = parseSimpleSetupUtterance(lowerInput);

        if (!parsed.mode) {
            return {
                action: 'RETRY',
                promptKey: PROMPT_KEYS.simple,
                reason: 'no_mode_detected',
                nextState: { ...state },
                debug: { rawInput, corrected, parsed }
            };
        }

        // Apply parsed values or defaults
        const forceLevel = parsed.force_level ?? SIMPLE_MODE_DEFAULTS.force_level;
        const durationMin = parsed.duration_min ?? SIMPLE_MODE_DEFAULTS.duration_min;

        state.mode = parsed.mode;
        state.intensity = INTENSITY_MAP[forceLevel];
        state.duration = durationMin;
        state.step = 'simpleConfirm';

        return {
            action: 'PROMPT',
            promptKey: PROMPT_KEYS.simpleConfirm,
            nextState: { ...state },
            uiUpdates: {
                mode: parsed.mode,
                intensity: forceLevel,
                duration: durationMin
            },
            defaultsApplied: {
                force: parsed.force_level === null,
                duration: parsed.duration_min === null
            },
            debug: { rawInput, corrected, parsed }
        };
    }

    function handleSimpleConfirmStep(lowerInput, rawInput, corrected) {
        if (isConfirmInput(lowerInput)) {
            const summary = { ...state };
            state = { ...INITIAL_STATE };
            return {
                action: 'COMPLETE',
                summary,
                nextState: { ...state },
                debug: { rawInput, corrected }
            };
        }

        if (isCancelInput(lowerInput)) {
            state = { ...INITIAL_STATE };
            return {
                action: 'CANCEL',
                reason: 'simple_cancel',
                nextState: { ...state },
                debug: { rawInput, corrected }
            };
        }

        // Unrecognized - replay confirm
        return {
            action: 'RETRY',
            promptKey: PROMPT_KEYS.simpleConfirm,
            reason: 'unrecognized_confirm',
            nextState: { ...state },
            debug: { rawInput, corrected }
        };
    }

    function handleModeStep(lowerInput, rawInput, corrected) {
        const mode = parseModeFromInput(lowerInput);

        if (!mode) {
            return {
                action: 'RETRY',
                promptKey: PROMPT_KEYS.mode,
                reason: 'no_mode_detected',
                nextState: { ...state },
                debug: { rawInput, corrected }
            };
        }

        state.mode = mode;
        state.step = 2;

        return {
            action: 'PROMPT',
            promptKey: PROMPT_KEYS.intensity,
            nextState: { ...state },
            uiUpdates: { mode },
            debug: { rawInput, corrected, mode }
        };
    }

    function handleIntensityStep(lowerInput, rawInput, corrected) {
        const intensity = parseIntensityFromInput(lowerInput);

        if (!intensity) {
            return {
                action: 'RETRY',
                promptKey: PROMPT_KEYS.intensity,
                reason: 'no_intensity_detected',
                nextState: { ...state },
                debug: { rawInput, corrected }
            };
        }

        state.intensity = intensity;
        state.step = 3;

        const intensityLevel = { '小': 1, '中': 2, '大': 3 }[intensity];

        return {
            action: 'PROMPT',
            promptKey: PROMPT_KEYS.duration,
            nextState: { ...state },
            uiUpdates: { intensity: intensityLevel },
            debug: { rawInput, corrected, intensity }
        };
    }

    function handleDurationStep(lowerInput, rawInput, corrected) {
        const duration = parseDurationFromInput(lowerInput);

        if (!duration) {
            return {
                action: 'RETRY',
                promptKey: PROMPT_KEYS.duration,
                reason: 'no_duration_detected',
                nextState: { ...state },
                debug: { rawInput, corrected }
            };
        }

        state.duration = duration;
        state.step = 4;

        return {
            action: 'PROMPT',
            promptKey: PROMPT_KEYS.confirm,
            nextState: { ...state },
            uiUpdates: { duration },
            debug: { rawInput, corrected, duration }
        };
    }

    function handleConfirmStep(lowerInput, rawInput, corrected) {
        if (isConfirmInput(lowerInput)) {
            const summary = { ...state };
            state = { ...INITIAL_STATE };
            return {
                action: 'COMPLETE',
                summary,
                nextState: { ...state },
                debug: { rawInput, corrected }
            };
        }

        if (isCancelInput(lowerInput)) {
            state = { ...INITIAL_STATE };
            return {
                action: 'CANCEL',
                reason: 'step4_cancel',
                nextState: { ...state },
                debug: { rawInput, corrected }
            };
        }

        // Unrecognized - replay confirm
        return {
            action: 'RETRY',
            promptKey: PROMPT_KEYS.confirm,
            reason: 'unrecognized_confirm',
            nextState: { ...state },
            debug: { rawInput, corrected }
        };
    }

    return {
        reset,
        getState,
        isActive,
        setSimpleMode,
        handleInput
    };
}

// ===== Export utilities for app.js to use =====
export const utils = {
    normalizeAsrForSetup,
    parseSimpleSetupUtterance,
    extractMode,
    extractForceLevel,
    extractDurationMin,
    parseModeFromInput,
    parseIntensityFromInput,
    parseDurationFromInput,
    isConfirmInput,
    isCancelInput,
    detectJogDirection,
    INITIAL_STATE: { ...INITIAL_STATE },
    SIMPLE_MODE_DEFAULTS: { ...SIMPLE_MODE_DEFAULTS },
    PROMPT_KEYS: { ...PROMPT_KEYS },
    INTENSITY_MAP: { ...INTENSITY_MAP }
};

// Non-destructive export

export const SetupWizardCore = {
create,
utils
};
