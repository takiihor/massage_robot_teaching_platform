// ===== SetupWizardUI - DOM/UI functions for massage setup wizard =====
// Extracted from app.js (Step 14b)
// This module contains ONLY DOM manipulation and UI rendering.
// NO business logic, NO parsing, NO state machine, NO audio, NO TTS.

'use strict';

const MODE_LABELS = {
    '向上推': '模式1',
    '波浪推': '模式2',
    '螺旋按': '模式3',
    '揉捏': '模式4'
};

const INTENSITY_LABELS = {
    '小': '小',
    '中': '中',
    '大': '大',
    '力度小': '力度小',
    '力度中': '力度中',
    '力度大': '力度大'
};

function _inferSetupStep(text) {
    const raw = (text || '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/\s+/g, '');
    const lower = normalized.toLowerCase();

    if (/模式/.test(normalized) || /(向上推|波浪推|螺旋按|揉捏)/.test(normalized)) return 1;
    if (/(力度|力道|力到|拎|小|中|大)/.test(normalized)) return 2;
    if (/(分鐘|min|minute|一分鐘|三分鐘|五分鐘|十分鐘|十五分鐘|二十分鐘|三十分鐘)/.test(normalized) || /\d+/.test(normalized)) return 3;
    if (/(確認|開始|好|係|confirm|start|ok|okay|yes)/.test(lower)) return 4;
    return null;
}

function _normalizeSetupDisplayText(text, step) {
    const raw = (text || '').trim();
    if (!raw) return '';
    const normalized = raw.replace(/\s+/g, '');
    const lower = normalized.toLowerCase();

    if (step === 1 || step === 'simple') {
        if (MODE_LABELS[normalized]) return MODE_LABELS[normalized];
        if (/模式[1-4一二三四]/.test(normalized)) {
            const num = normalized.replace(/[^1-4一二三四]/g, '');
            const map = { '一': '1', '二': '2', '三': '3', '四': '4' };
            const digit = map[num] || num;
            return `模式${digit}`;
        }
        return '';
    }

    if (step === 2) {
        const normalizedIntensity = normalized
            .replace(/^力到/, '力度')
            .replace(/^力道/, '力度')
            .replace(/^拎到/, '力度')
            .replace(/^拎道/, '力度')
            .replace(/^拎度/, '力度');
        if (INTENSITY_LABELS[normalizedIntensity]) return INTENSITY_LABELS[normalizedIntensity];
        if (/力度[小中大]/.test(normalizedIntensity)) return `力度${normalizedIntensity.slice(-1)}`;
        if (/^[小中大]$/.test(normalizedIntensity)) return normalizedIntensity;
        return '';
    }

    if (step === 3) {
        const lang = localStorage.getItem('voiceLanguage') || localStorage.getItem('language') || 'zh';
        const useEnglish = lang === 'en';
        const match = normalized.match(/(\d+)\s*(分鐘|min|minute)/i);
        if (match) return useEnglish ? `${match[1]} min` : `${match[1]}分鐘`;
        if (/^(一|三|五|十|十五|二十|三十)分鐘$/.test(normalized)) {
            const map = { '一分鐘': '1', '三分鐘': '3', '五分鐘': '5', '十分鐘': '10', '十五分鐘': '15', '二十分鐘': '20', '三十分鐘': '30' };
            const value = map[normalized] || normalized.replace('分鐘', '');
            return useEnglish ? `${value} min` : `${value}分鐘`;
        }
        return '';
    }

    if (step === 4 || step === 'simpleConfirm') {
        if (/^(確認|開始|好|係)$/.test(normalized)) {
            return normalized;
        }
        if (/^(confirm|start|ok|okay|yes)$/.test(lower)) {
            return '確認';
        }
        return '';
    }

    return '';
}

// ===== Prompt Key Mapping =====
/*
 * Module: SetupWizardUI
 * Purpose: Setup wizard UI helpers (DOM interactions only).
 * Exports: PROMPT_KEYS, showVoiceSetupBanner, hideVoiceSetupBanner,
 *          updateAsrDebugDisplay, setAsrUiState, highlightVoiceSelection,
 *          highlightMode, highlightIntensity, highlightDuration, resetUI,
 *          updateButtonsFromState, SetupWizardUI
 * Module bridge globals: window.SetupWizardUI (via module-bridge)
 */

export const PROMPT_KEYS = {
        1: 'voiceSetupMode',
        2: 'voiceSetupIntensity',
        3: 'voiceSetupDuration',
        4: 'voiceSetupConfirm',
        'simple': 'voiceSetupSimple',
        'simpleConfirm': 'voiceSetupSimpleConfirm'
};

    // ===== Voice Setup Banner =====
export function showVoiceSetupBanner(step) {
        const banner = document.getElementById('voiceSetupBanner');
        const prompt = document.getElementById('voiceSetupPrompt');
        const title = document.getElementById('voiceSetupTitle');
        const display = document.getElementById('voiceSetupDisplay');
        if (!banner || !prompt) return;

        // Use i18n function if available, otherwise use key directly
        const t = typeof window.t === 'function' ? window.t : (k) => k;

        if (title) title.textContent = t('voiceSetupListening');
        prompt.textContent = t(PROMPT_KEYS[step]) || '';
        if (display) display.textContent = '';
        banner.classList.remove('hidden');
        if (window.DEBUG_LOGS) {
            console.log(`[VoiceSetupBanner] Showing step ${step}`);
        }
    }

export function hideVoiceSetupBanner() {
        const banner = document.getElementById('voiceSetupBanner');
        const selection = document.getElementById('voiceSetupDisplay');
        if (banner) {
            banner.classList.add('hidden');
            if (window.DEBUG_LOGS) {
                console.log('[VoiceSetupBanner] Hidden');
            }
        }
        if (selection) selection.textContent = '';
        // Clear all voice highlights when setup is done
        document.querySelectorAll('.voice-highlight').forEach(el => {
            el.classList.remove('voice-highlight');
        });
    }

    // ===== ASR Debug Display =====
export function updateAsrDebugDisplay(text, isActive) {
        const display = document.getElementById('asrDebugText');
        const selection = document.getElementById('voiceSetupDisplay');
        // Check isActive parameter if provided, otherwise check global
        const active = isActive !== undefined ? isActive : !!window.isMassageSetupMode?.();
        if (selection && active) {
            const step = window.massageSetupState?.step ?? _inferSetupStep(text);
            const normalized = _normalizeSetupDisplayText(text, step);
            if (normalized) selection.textContent = normalized;
        }
        if (display && active) {
            const step = window.massageSetupState?.step ?? _inferSetupStep(text);
            const normalized = _normalizeSetupDisplayText(text, step);
            display.textContent = normalized || (text ? `"${text}"` : '-');
        }
    }

    // ===== ASR UI State =====
export function setAsrUiState(state, text) {
        try {
            const dot = document.getElementById('asrStatusDot');
            if (dot) {
                dot.classList.remove('inactive', 'error', 'speaking');
                if (state === 'inactive') dot.classList.add('inactive');
                if (state === 'error') dot.classList.add('error');
                if (state === 'listening') dot.classList.add('speaking');
            }

            const banner = document.getElementById('voiceSetupBanner');
            const title = document.getElementById('voiceSetupTitle');
            const debugText = document.getElementById('asrDebugText');

            if (debugText && text) debugText.textContent = text;
            if (banner && !banner.classList.contains('hidden') && title) {
                if (state === 'listening') {
                    const acceptAfter = window.__setupAsrAcceptAfter || 0;
                    if (Date.now() < acceptAfter) {
                        title.textContent = '準備中...（等提示音完）';
                    } else {
                        title.textContent = '✅ 可以講喇';
                    }
                } else if (state === 'inactive') {
                    title.textContent = '正在啟動語音識別...';
                } else if (state === 'error') {
                    title.textContent = '⚠️ 語音識別有問題';
                }
            }
        } catch (e) { /* ignore */ }
    }

    // ===== Button Highlight =====
function mapYear65Selector(selector) {
        const modeMatch = selector.match(/\.mode-btn\[data-mode="([^"]+)"\]/);
        if (modeMatch) {
            const value = modeMatch[1];
            const modeMap = {
                '向上推': '1',
                '波浪推': '2',
                '螺旋按': '3',
                '揉捏': '4'
            };
            const normalized = modeMap[value] || value;
            return `.y65-mode-btn[data-mode="${normalized}"]`;
        }

        const intensityMatch = selector.match(/\.intensity-btn\[data-level="([^"]+)"\]/);
        if (intensityMatch) {
            const level = intensityMatch[1];
            const intensityMap = { '1': 'low', '2': 'mid', '3': 'high' };
            const normalized = intensityMap[level] || level;
            return `.y65-seg [data-intensity="${normalized}"]`;
        }

        const durationMatch = selector.match(/\.duration-btn\[data-duration="([^"]+)"\]/);
        if (durationMatch) {
            return `.y65-duration-row [data-duration="${durationMatch[1]}"]`;
        }

        return selector;
    }

export function highlightVoiceSelection(selector) {
        // Remove previous highlights
        document.querySelectorAll('.voice-highlight').forEach(el => {
            el.classList.remove('voice-highlight');
        });

        // Add highlight to selected button
        let btn = document.querySelector(selector);
        if (!btn) {
            const mapped = mapYear65Selector(selector);
            if (mapped !== selector) {
                btn = document.querySelector(mapped);
                if (btn) {
                    selector = mapped;
                }
            }
        }
        if (btn) {
            // Prefer triggering the same click handlers as manual UI so index.html internal state stays in sync.
            try { btn.click(); } catch (e) { /* ignore */ }

            btn.classList.add('voice-highlight');

            // Also set as active for final state (in case click handler is absent/async)
            if (btn.classList.contains('mode-btn') || btn.classList.contains('y65-mode-btn')) {
                document.querySelectorAll('.mode-btn, .y65-mode-btn').forEach(b => b.classList.remove('active'));
            } else if (btn.classList.contains('intensity-btn') || btn.closest('.y65-seg')) {
                document.querySelectorAll('.intensity-btn, .y65-seg button').forEach(b => b.classList.remove('active'));
            } else if (btn.classList.contains('duration-btn') || btn.classList.contains('y65-chip')) {
                document.querySelectorAll('.duration-btn, .y65-duration-row .y65-chip').forEach(b => b.classList.remove('active'));
            } else if (btn.classList.contains('feeling-btn')) {
                document.querySelectorAll('.feeling-btn').forEach(b => b.classList.remove('active'));
            } else if (btn.parentElement) {
                const siblings = btn.parentElement.querySelectorAll('button');
                siblings.forEach(b => b.classList.remove('active'));
            }
            btn.classList.add('active');
            console.log(`[VoiceHighlight] Highlighted: ${selector}`);
        } else {
            console.warn(`[VoiceHighlight] Button not found: ${selector}`);
        }
    }

    // ===== Convenience: Highlight by Mode/Intensity/Duration =====
export function highlightMode(mode) {
        if (mode) {
            highlightVoiceSelection(`.mode-btn[data-mode="${mode}"]`);
        }
    }

export function highlightIntensity(level) {
        if (level) {
            highlightVoiceSelection(`.intensity-btn[data-level="${level}"]`);
        }
    }

export function highlightDuration(duration) {
        if (duration && [1, 3, 5].includes(duration)) {
            highlightVoiceSelection(`.duration-btn[data-duration="${duration}"]`);
        }
    }

    // ===== Reset UI =====
export function resetUI() {
        hideVoiceSetupBanner();
        // Clear all button highlights
        document.querySelectorAll('.voice-highlight').forEach(el => {
            el.classList.remove('voice-highlight');
        });
        // Reset ASR status dot
        const dot = document.getElementById('asrStatusDot');
        if (dot) {
            dot.classList.remove('inactive', 'error', 'speaking');
            dot.classList.add('inactive');
        }
    }

    // ===== Update Setup Buttons to Match State =====
export function updateButtonsFromState(state) {
        if (!state) return;

        // Mode buttons
        if (state.mode) {
            document.querySelectorAll('.mode-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === state.mode);
            });
        }

        // Intensity buttons
        if (state.intensity) {
            const intensityMap = { '小': '1', '中': '2', '大': '3' };
            document.querySelectorAll('.intensity-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.level === intensityMap[state.intensity]);
            });
        }

        // Duration buttons
        if (state.duration && [1, 3, 5].includes(state.duration)) {
            document.querySelectorAll('.duration-btn').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.duration) === state.duration);
            });
        }
    }

    // Non-destructive export
export const SetupWizardUI = {
        // Banner
        showVoiceSetupBanner,
        hideVoiceSetupBanner,

        // ASR display
        updateAsrDebugDisplay,
        setAsrUiState,

        // Button highlights
        highlightVoiceSelection,
        highlightMode,
        highlightIntensity,
        highlightDuration,

        // Reset/sync
        resetUI,
        updateButtonsFromState,

        // Constants for reference
        PROMPT_KEYS
};
