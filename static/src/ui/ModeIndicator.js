// 🔧 FIX: Flag to suppress toast on initial page load
let isInitialModeLoad = true;

/*
 * Module: ModeIndicator
 * Purpose: Mode indicator UI helpers for massage-only flows.
 * Exports: showModeToast, applyModeUI, initChatModeToggle, initModeIndicator, ModeIndicator
 * Module bridge globals: window.ModeIndicator, window.showModeToast, window.applyModeUI, window.initChatModeToggle (via module-bridge)
 */

export function showModeToast(text) {
    let toast = document.getElementById('modeToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'modeToast';
        toast.className = 'mode-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1400);
}

export function applyModeUI(mode) {
    const SystemMode = window.SystemMode;
    const indicator = document.getElementById('modeIndicator');
    const icon = document.getElementById('modeIcon');
    const text = document.getElementById('modeText');
    const subtext = document.getElementById('modeSubtext');
    const userInput = document.getElementById('userInput');
    const guideText = document.getElementById('headerMassageGuideText');
    const defaultGuideText = (typeof window.t === 'function')
        ? window.t('headerMassageGuide')
        : '已進入按摩模式。如果你想調整按摩設定，請講：『按摩設定／按摩設置』';

    // Update header indicator when present, but still continue if layout omits it
    if (indicator) indicator.className = 'mode-indicator bump';
    switch (mode) {
        case SystemMode.MASSAGE_SETUP:
            indicator && indicator.classList.add('setup');
            if (icon) icon.textContent = '⚙️';
            if (text) text.textContent = '設定模式';
            subtext && (subtext.textContent = '跟住指示回答「模式、力度、時間」。例如：揉捏、中、3分鐘。');
            if (userInput) userInput.placeholder = '講/輸入模式 + 力度 + 時間，例如「揉捏 中 3分鐘」';
            if (!isInitialModeLoad) showModeToast('正在設定按摩任務');
            guideText && (guideText.textContent = defaultGuideText);
            break;
        case SystemMode.MASSAGE_RUNNING:
            indicator && indicator.classList.add('running');
            if (icon) icon.textContent = '▶️';
            if (text) text.textContent = '按摩進行中';
            subtext && (subtext.textContent = '可講「暫停按摩」「停止按摩」或問病人舒適度。');
            if (userInput) userInput.placeholder = '可說「暫停/停止按摩」或詢問病人感受';
            if (!isInitialModeLoad) showModeToast('按摩已開始');
            guideText && (guideText.textContent = defaultGuideText);
            break;
    }

    // Update sidebar mode buttons
    const chatBtn = document.getElementById('chatModeBtn');
    const setupBtn = document.getElementById('setupModeBtn');
    if (chatBtn && setupBtn) {
        chatBtn.classList.remove('active');
        setupBtn.classList.add('active');
    }

    // Show massage UI panel only
    const chatMode = document.getElementById('chatMode');
    const massageMode = document.getElementById('massageMode');
    if (chatMode && massageMode) {
        chatMode.style.display = 'none';
        massageMode.classList.add('active');
    }
}

// Kept as no-op for module compatibility.
export function initChatModeToggle() {}

export function initModeIndicator(stateMachine) {
    const sm = stateMachine || window.stateMachine;
    if (!sm) return;

    sm.onModeChange((newMode) => applyModeUI(newMode));

    // 🔧 Ensure we apply the initial mode carefully
    setTimeout(() => {
        console.log('[StateMachine] Applying initial mode UI:', sm.getMode());
        applyModeUI(sm.getMode());
        isInitialModeLoad = false;
    }, 100);
}

export const ModeIndicator = {
    initModeIndicator,
    showModeToast,
    applyModeUI,
    initChatModeToggle
};
