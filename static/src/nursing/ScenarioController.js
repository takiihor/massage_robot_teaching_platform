/*
 * Module: ScenarioController
 * Purpose: Deterministic nursing scenario playback for massage sessions.
 * Exports: createScenarioController, NursingScenarioController
 */

const STORAGE_KEY = 'teachingSelectedScenarioId';

const VOICE_TRANSCRIPTS = {
    'azure_man_8_tracks': {
        'soundtrack_01': "Hi, nurse. Wow, a robotic massage? Is that really useful for me?",
        'soundtrack_02': "Oh hi, it’s you again. I really feel like my body and blood are circulating! It’s working! That feels like a firm, gentle squeeze… it’s really relaxing.",
        'soundtrack_03': "Why are you stopping it? I'm just starting to feel it working! Is there something wrong?",
        'soundtrack_04': "Well… It's hard to tell, but there's some kind of 'pain' in my left leg… AND I don't know what's going on, but I feel like I can't catch my breath, like a little bit.",
        'soundtrack_05': "Nurse! Help me! It's getting harder to breathe. I can't catch it!!",
        'soundtrack_06': "Ah! Is it really normal for me to feel this kind of pain? My chest is feeling a little tight now. But I still can handle it… continue!",
        'soundtrack_07': "Oh! Thanks for stopping the machine! I still can't breathe good… But is there something wrong?",
        'soundtrack_08': "Ow! Wait! That's painful! My left leg hurts so bad! My chest is feeling tight! I can't breathe at all!!"
    },
    'azure_cantonese_oldman_8_tracks': {
        'soundtrack_01': "護士，你好。嘩，機械人按摩？呢個對我嚟講真係有用㗎？",
        'soundtrack_02': "哦，嗨，又係你啊。我真係覺得自己成身血氣運行得好暢順㗎！真係有用㗎！我覺得好似有一股氣喺度用力咁按住……好舒服㗎！",
        'soundtrack_03': "你做咩停咗佢啊？我先開始覺得有反應㗎咋！係咪有咩問題啊？",
        'soundtrack_04': "嗯……好難講清楚，但我左腳有啲『痛』……仲有，我唔知發生咩事，但我覺得有少少抖唔到氣咁。",
        'soundtrack_05': "護士！救我啊！我愈來愈抖唔到氣啦。我唞唔到呀！",
        'soundtrack_06': "啊！我咁樣痛法真係正常㗎？我個心口而家開始有少少翳住翳住咁。但我都頂得住嘅……繼續啦！",
        'soundtrack_07': "哦！好彩你停咗部機咋！我仲係抖得唔係幾順暢……但係咪有咩問題啊？",
        'soundtrack_08': "哎呀！等陣！好痛呀！我左腳好痛呀！我心口好翳！我完全抖唔到氣啦！"
    }
};

function showPatientSubtitle(text) {
    const el = document.getElementById('patientSubtitle');
    if (!el || !text) return;
    el.textContent = text;
    el.classList.add('show');
}

function hidePatientSubtitle() {
    const el = document.getElementById('patientSubtitle');
    if (!el) return;
    el.classList.remove('show');
}

const OFF_BASELINE = {
    id: 'off_baseline',
    targets: { hr: 89, sbp: 115, dbp: 73, rr: 18, spo2: 97 },
    subjective: { pain: 0, anxiety: 0, comfort: 2 },
    cues: { pain: 'NONE', anxiety: 'NONE', comfort: 'SLIGHTLY_UNCOMFORTABLE' }
};

const SCENARIOS = {
    off: null,
    scenario_0: {
        id: 'scenario_0',
        label: 'Scenario 0 (Keyboard expression practice)'
    },
    scenario_1: {
        id: 'scenario_1',
        label: 'Scenario 1 (No pain at 15th min)',
        baseline: {
            id: 's1_baseline',
            soundtrackId: 'soundtrack_01',
            virtualMinutesOnFire: 0,
            virtualRateSecsPerSec: 5,
            expressionPresetId: 'baseline',
            targets: { hr: 89, sbp: 115, dbp: 73, rr: 18, spo2: 97 },
            subjective: { pain: 0, anxiety: 0, comfort: 2 },
            cues: { pain: 'NONE', anxiety: 'NONE', comfort: 'SLIGHTLY_UNCOMFORTABLE' },
            dialogue: 'Hi, nurse. Wow, a robotic massage? Is that really useful for me?'
        },
        stage12: {
            id: 's1_1_2',
            soundtrackId: 'soundtrack_02',
            virtualMinutesOnFire: 5,
            virtualRateSecsPerSec: 15,
            expressionPresetId: 'baseline',
            targets: { hr: 86, sbp: 98, dbp: 65, rr: 14, spo2: 97 },
            subjective: { pain: 0, anxiety: 0, comfort: 3 },
            cues: { pain: 'NONE', anxiety: 'NONE', comfort: 'COMFORTABLE' },
            dialogue: 'Oh hi, it’s you again. I really feel like my body and blood are circulating! It’s working! That feels like a firm, gentle squeeze… it’s really relaxing.'
        },
        stopOutcome: {
            id: 's1_1_3_a',
            soundtrackId: 'soundtrack_03',
            virtualMinutesOnFire: 5,
            virtualRateSecsPerSec: 0,
            expressionPresetId: 'mild_anxiety',
            targets: { hr: 88, sbp: 103, dbp: 66, rr: 16, spo2: 97 },
            subjective: { pain: 0, anxiety: 2, comfort: 0 },
            cues: { pain: 'NONE', anxiety: 'UNEASY', comfort: 'NONE' },
            dialogue: 'Why are you stopping it? I\'m just starting to feel it working! Is there something wrong?'
        },
        // Intermediate stage: fires when student continues past stage12.
        // Opens a short progression window before the final deterioration stage.
        continueIntermediate: {
            id: 's1_intermediate',
            soundtrackId: 'soundtrack_04',
            virtualMinutesOnFire: 20,
            virtualRateSecsPerSec: 15,
            virtualClockMode: 'continue',
            expressionPresetId: 'mild_pain',
            targets: { hr: 102, sbp: 115, dbp: 72, rr: 20, spo2: 95 },
            subjective: { pain: 2, anxiety: 3, comfort: 1 },
            cues: { pain: 'MILD', anxiety: 'ANXIOUS', comfort: 'UNCOMFORTABLE' },
            dialogue: 'Well\u2026 It\'s hard to tell, but there\'s some kind of \'pain\' in my left leg\u2026 AND I don\'t know what\'s going on, but I feel like I can\'t catch my breath, like a little bit.'
        },
        // Final progression stage (1.3.b.2): reached after intermediate stage,
        // regardless of stop/continue action inside that short window.
        continueOutcome: {
            id: 's1_1_3_b',
            soundtrackId: 'soundtrack_05',
            virtualMinutesOnFire: 20,
            virtualRateSecsPerSec: 15,
            virtualClockMode: 'continue',
            expressionPresetId: 'high_anxiety',
            targets: { hr: 115, sbp: 116, dbp: 76, rr: 22, spo2: 94 },
            subjective: { pain: 2, anxiety: 4, comfort: 1 },
            cues: { pain: 'MILD', anxiety: 'ANXIOUS', comfort: 'UNCOMFORTABLE' },
            dialogue: 'Nurse! Help me! It\'s getting harder to breathe. I can\'t catch it!!'
        }
    },
    scenario_2: {
        id: 'scenario_2',
        label: 'Scenario 2 (Moderate / severe pain)',
        baseline: {
            id: 's2_baseline',
            soundtrackId: 'soundtrack_01',
            virtualMinutesOnFire: 0,
            virtualRateSecsPerSec: 5,
            expressionPresetId: 'baseline',
            targets: { hr: 89, sbp: 115, dbp: 73, rr: 18, spo2: 97 },
            subjective: { pain: 0, anxiety: 0, comfort: 2 },
            cues: { pain: 'NONE', anxiety: 'NONE', comfort: 'SLIGHTLY_UNCOMFORTABLE' },
            dialogue: 'Hi, nurse. Wow, a robotic massage? Is that really useful for me?'
        },
        stage12: {
            id: 's2_1_2',
            soundtrackId: 'soundtrack_06',
            virtualMinutesOnFire: 5,
            virtualRateSecsPerSec: 15,
            expressionPresetId: 'high_anxiety',
            targets: { hr: 103, sbp: 122, dbp: 84, rr: 24, spo2: 94 },
            subjective: { pain: 5, anxiety: 4, comfort: 0 },
            cues: { pain: 'SEVERE', anxiety: 'ANXIOUS', comfort: 'NONE' },
            dialogue: 'Ah! Is it really normal for me to feel this kind of pain? My chest is feeling a little tight now. But I can still handle it. Let\'s continue!'
        },
        stopOutcome: {
            id: 's2_1_3_a',
            soundtrackId: 'soundtrack_07',
            virtualMinutesOnFire: 5,
            virtualRateSecsPerSec: 0,
            expressionPresetId: 'moderate_pain',
            targets: { hr: 101, sbp: 121, dbp: 83, rr: 22, spo2: 94 },
            subjective: { pain: 5, anxiety: 3, comfort: 0 },
            cues: { pain: 'SEVERE', anxiety: 'UNEASY', comfort: 'NONE' },
            dialogue: 'Oh! Thanks for stopping the machine! But\u2026 I still can\'t breathe good\u2026 Is there something wrong?'
        },
        continueOutcome: {
            id: 's2_1_3_b',
            soundtrackId: 'soundtrack_08',
            virtualMinutesOnFire: 20,
            virtualRateSecsPerSec: 15,
            virtualClockMode: 'continue',
            expressionPresetId: 'severe_pain',
            targets: { hr: 119, sbp: 143, dbp: 95, rr: 26, spo2: 93 },
            subjective: { pain: 5, anxiety: 5, comfort: 0 },
            cues: { pain: 'SEVERE', anxiety: 'PANIC', comfort: 'NONE' },
            dialogue: 'Ow! Wait\u2026 ah! That\'s so painful! My left leg hurts so bad! My chest is feeling tight! I can\'t breathe at all!!'
        }
    }
};

function getStoredScenarioId() {
    const stored = localStorage.getItem(STORAGE_KEY) || 'off';
    return SCENARIOS[stored] ? stored : 'off';
}

export function createScenarioController(options = {}) {
    const {
        vitalsMonitor = null,
        timelineManager = null,
        scenarioSelectEl = document.getElementById('teachingScenarioSelect')
    } = options;
    const scenarioBadgeEl = document.getElementById('teachingScenarioBadge');
    const frontScenarioChipEl = document.getElementById('y65ScenarioChip');

    let selectedScenarioId = getStoredScenarioId();
    let runtimeGeneration = 0;
    let activeScenario = null;
    let activeStage = null;
    let decisionWindowOpen = false;
    let intermediateDecisionWindowOpen = false;
    let stage12Timer = null;
    let outcomeTimer = null;
    let stage12DueAt = null;
    let outcomeDueAt = null;
    let stage12RemainingMs = null;
    let outcomeRemainingMs = null;
    let scenarioStartedAt = null;
    let pauseStartedAt = null;
    let pausedAccumulatedMs = 0;
    let virtualElapsedSec = 0;
    let virtualRateSecsPerSec = 0;
    let virtualTimeInterval = null;
    let scenarioAudio = null;
    let completionRequested = false;
    let expressionDelayTimer = null;
    const FINAL_OUTCOME_HOLD_MS = 60000;

    function stopVirtualClock() {
        if (virtualTimeInterval) { clearInterval(virtualTimeInterval); virtualTimeInterval = null; }
    }

    function emitVirtualClockUpdate({ active = true, isRunning = false, status = 'FROZEN' } = {}) {
        // Guard against stale 20:00 leakage while still in stage 1.2.
        if (activeScenario?.stage12?.id && activeStage === activeScenario.stage12.id) {
            const expectedSec = (activeScenario.stage12.virtualMinutesOnFire ?? 5) * 60;
            const expectedRate = activeScenario.stage12.virtualRateSecsPerSec ?? 15;
            if (!Number.isFinite(virtualElapsedSec) || virtualElapsedSec >= 1200 || virtualElapsedSec < expectedSec) {
                virtualElapsedSec = expectedSec;
            }
            if (!Number.isFinite(virtualRateSecsPerSec) || virtualRateSecsPerSec <= 0) {
                virtualRateSecsPerSec = expectedRate;
            }
        }
        if (status === 'RUNNING' && !virtualTimeInterval && virtualRateSecsPerSec > 0) {
            startVirtualTicker();
        }

        document.dispatchEvent(new CustomEvent('scenarioVirtualTimeUpdate', {
            detail: {
                virtualElapsedSec,
                active,
                isRunning,
                status,
                stageId: activeStage,
                label: 'Massage Timer / 按摩時間'
            }
        }));
    }

    function startVirtualTicker() {
        stopVirtualClock();
        if (virtualRateSecsPerSec > 0) {
            virtualTimeInterval = setInterval(() => {
                virtualElapsedSec += virtualRateSecsPerSec;
                emitVirtualClockUpdate({ active: true, isRunning: true, status: 'RUNNING' });
            }, 1000);
        }
    }

    function startVirtualClock(virtualMin, rate) {
        virtualElapsedSec = virtualMin * 60;
        virtualRateSecsPerSec = rate;
        emitVirtualClockUpdate({ active: true, isRunning: rate > 0, status: rate > 0 ? 'RUNNING' : 'FROZEN' });
        startVirtualTicker();
    }

    function playScenarioDialogue(soundtrackId, options = {}) {
        if (scenarioAudio) { scenarioAudio.pause(); scenarioAudio.src = ''; scenarioAudio = null; }
        if (!soundtrackId) return;
        const suppressClinicalReflection = options?.suppressClinicalReflection === true;
        const folder = window.nursingScenarioVoice || 'azure_man_8_tracks';
        const transcript = VOICE_TRANSCRIPTS[folder]?.[soundtrackId];
        const scenarioAudioVersion = encodeURIComponent(String(window.__SCENARIO_AUDIO_VERSION || '20260317'));
        scenarioAudio = new Audio(`/static/predefined_sound_track/${folder}/${soundtrackId}.mp3?v=${scenarioAudioVersion}`);
        let scenarioAudioStarted = false;

        scenarioAudio.addEventListener('playing', () => {
            scenarioAudioStarted = true;
        }, { once: true });
        
        scenarioAudio.addEventListener('ended', () => {
            hidePatientSubtitle();
            const isStopOutcome = activeScenario?.stopOutcome?.id && activeStage === activeScenario.stopOutcome.id;
            if (!suppressClinicalReflection && scenarioAudioStarted && !isStopOutcome && (activeScenario?.id === 'scenario_1' || activeScenario?.id === 'scenario_2')) {
                window.Year65UI?.triggerClinicalReflection?.();
            }
        });
        scenarioAudio.addEventListener('pause', () => hidePatientSubtitle());
        
        if (transcript) {
            showPatientSubtitle(transcript);
        }
        
        scenarioAudio.play().catch(e => {
            console.warn('[ScenarioController] audio play failed:', e);
            hidePatientSubtitle();
        });
    }

    function clearTimers() {
        if (stage12Timer) {
            clearTimeout(stage12Timer);
            stage12Timer = null;
        }
        if (outcomeTimer) {
            clearTimeout(outcomeTimer);
            outcomeTimer = null;
        }
        stage12DueAt = null;
        outcomeDueAt = null;
        intermediateDecisionWindowOpen = false;
        stopVirtualClock();
    }

    // Applies a stopOutcome stage immediately (vitals, cues, dialogue, timeline) while
    // holding the current facial expression for delayMs, then switching to the stage's
    // own expressionPresetId. This avoids an unnatural instant expression jump on stop.
    function applyStopOutcomeWithDelayedExpression(stage, reason, holdExpressionPresetId, delayMs = 10000) {
        const stageWithHeldExpression = { ...stage, expressionPresetId: holdExpressionPresetId };
        applyStage(stageWithHeldExpression, reason);
        if (expressionDelayTimer) { clearTimeout(expressionDelayTimer); expressionDelayTimer = null; }
        expressionDelayTimer = setTimeout(() => {
            expressionDelayTimer = null;
            if (activeStage !== stage.id || !vitalsMonitor) return;
            vitalsMonitor.applyTeachingPreset({
                id: stage.expressionPresetId,
                targets: { ...stage.targets },
                subjective: { ...stage.subjective },
                cues: { ...stage.cues },
                useBase: false
            });
        }, delayMs);
    }

    function requestScenarioCompletion(completionReason, waitForAudio = false, minDelayMs = 0, postAudioDelayMs = 0) {
        if (completionRequested) return;
        completionRequested = true;

        const generation = runtimeGeneration;
        const finish = () => {
            // Completion/audio callbacks can outlive a selection or restart.
            // They must never complete a later scenario or stop its session.
            if (generation === runtimeGeneration) completeScenario(completionReason);
        };
        const minDelay = Math.max(0, Number(minDelayMs) || 0);
        const postAudioDelay = Math.max(0, Number(postAudioDelayMs) || 0);
        if (!waitForAudio || !scenarioAudio) {
            if (minDelay > 0) setTimeout(finish, minDelay);
            else finish();
            return;
        }

        let audioDone = scenarioAudio.ended;
        let minDone = minDelay === 0;
        const maybeFinish = () => {
            if (audioDone && minDone) finish();
        };

        if (!audioDone) {
            scenarioAudio.addEventListener('ended', () => {
                if (postAudioDelay > 0) {
                    setTimeout(() => { audioDone = true; maybeFinish(); }, postAudioDelay);
                } else {
                    audioDone = true;
                    maybeFinish();
                }
            }, { once: true });
        }

        if (!minDone) {
            setTimeout(() => {
                minDone = true;
                maybeFinish();
            }, minDelay);
        }

        if (audioDone && minDone) finish();
    }

    function scheduleStage12(delayMs) {
        const ms = Math.max(0, Number(delayMs) || 0);
        stage12DueAt = Date.now() + ms;
        stage12Timer = setTimeout(() => {
            stage12Timer = null;
            stage12DueAt = null;
            if (!activeScenario) return;
            applyStage(activeScenario.stage12, 't_plus_60s');
            virtualElapsedSec = (activeScenario.stage12?.virtualMinutesOnFire ?? 5) * 60;
            virtualRateSecsPerSec = activeScenario.stage12?.virtualRateSecsPerSec ?? 15;
            startVirtualTicker();
            emitVirtualClockUpdate({ active: true, isRunning: true, status: 'RUNNING' });
            decisionWindowOpen = true;
            scheduleOutcome(60000);
        }, ms);
    }

    function scheduleOutcome(delayMs) {
        const ms = Math.max(0, Number(delayMs) || 0);
        outcomeDueAt = Date.now() + ms;
        outcomeTimer = setTimeout(() => {
            outcomeTimer = null;
            outcomeDueAt = null;
            if (!activeScenario) return;
            // If scenario has a continueIntermediate and we haven't entered it yet,
            // fire it now and open a short progression window before the final outcome.
            if (activeScenario.continueIntermediate && !intermediateDecisionWindowOpen) {
                decisionWindowOpen = false;
                applyStage(activeScenario.continueIntermediate, 'continue_intermediate');
                intermediateDecisionWindowOpen = true;
                scheduleOutcome(30000);
            } else {
                decisionWindowOpen = false;
                intermediateDecisionWindowOpen = false;
                applyStage(activeScenario.continueOutcome, 'continue_timeout');
                requestScenarioCompletion('continue_worsening', true, FINAL_OUTCOME_HOLD_MS);
            }
        }, ms);
    }

    function addTimelineEvent(type, data = {}) {
        const manager = timelineManager || window.nursingTimelineManagerInstance;
        manager?.addEvent?.(type, data);
    }

    function announce(message) {
        console.log('[ScenarioController]', message);
    }

    function updateScenarioBadge() {
        if (scenarioBadgeEl) {
            scenarioBadgeEl.classList.remove('is-off', 'is-s0', 'is-s1', 'is-s2');
        }
        if (selectedScenarioId === 'scenario_0') {
            if (scenarioBadgeEl) {
                scenarioBadgeEl.textContent = 'Scenario: S0 Keyboard (F6)';
                scenarioBadgeEl.classList.add('is-s0');
            }
            if (frontScenarioChipEl) {
                frontScenarioChipEl.textContent = 'Scenario: S0 Keyboard';
            }
            return;
        }
        if (selectedScenarioId === 'scenario_1') {
            if (scenarioBadgeEl) {
                scenarioBadgeEl.textContent = 'Scenario: S1 (F7)';
                scenarioBadgeEl.classList.add('is-s1');
            }
            if (frontScenarioChipEl) {
                frontScenarioChipEl.textContent = 'Scenario: S1';
            }
            return;
        }
        if (selectedScenarioId === 'scenario_2') {
            if (scenarioBadgeEl) {
                scenarioBadgeEl.textContent = 'Scenario: S2 (F8)';
                scenarioBadgeEl.classList.add('is-s2');
            }
            if (frontScenarioChipEl) {
                frontScenarioChipEl.textContent = 'Scenario: S2';
            }
            return;
        }
        if (scenarioBadgeEl) {
            scenarioBadgeEl.textContent = 'Scenario: Off (F9)';
            scenarioBadgeEl.classList.add('is-off');
        }
        if (frontScenarioChipEl) {
            frontScenarioChipEl.textContent = 'Scenario: Off';
        }
    }

    function applyStage(stage, reason = '', options = {}) {
        if (!vitalsMonitor || !stage) return;
        const skipDialogueReplay = options?.skipDialogueReplay === true;
        activeStage = stage.id;
        vitalsMonitor.applyTeachingPreset({
            id: stage.expressionPresetId || stage.id,
            targets: { ...stage.targets },
            subjective: { ...stage.subjective },
            cues: { ...stage.cues },
            useBase: false
        });
        addTimelineEvent('SCENARIO_STAGE_CHANGED', {
            scenarioId: activeScenario?.id,
            stageId: stage.id,
            reason,
            dialogue: stage.dialogue,
            vitals: stage.targets,
            subjective: stage.subjective
        });
        if (!skipDialogueReplay && stage.soundtrackId !== undefined) playScenarioDialogue(stage.soundtrackId);
        if (stage.virtualMinutesOnFire != null) {
            if (stage.virtualClockMode === 'continue') {
                const minSec = stage.virtualMinutesOnFire * 60;
                if (!Number.isFinite(virtualElapsedSec) || virtualElapsedSec < minSec) {
                    virtualElapsedSec = minSec;
                }
                if (Number.isFinite(stage.virtualRateSecsPerSec)) {
                    virtualRateSecsPerSec = stage.virtualRateSecsPerSec;
                }
                if (!virtualTimeInterval && virtualRateSecsPerSec > 0) {
                    startVirtualTicker();
                }
                emitVirtualClockUpdate({ active: true, isRunning: !!virtualTimeInterval, status: virtualTimeInterval ? 'RUNNING' : 'FROZEN' });
            } else {
                startVirtualClock(stage.virtualMinutesOnFire, stage.virtualRateSecsPerSec ?? 0);
            }
        }
        if (!skipDialogueReplay && stage.dialogue) {
            announce(stage.dialogue);
        }
        if (typeof window.syncYear65UI === 'function') {
            window.syncYear65UI();
        }
    }

    function completeScenario(completionReason) {
        runtimeGeneration++;
        if (expressionDelayTimer) { clearTimeout(expressionDelayTimer); expressionDelayTimer = null; }
        const totalPausedMs = pauseStartedAt
            ? pausedAccumulatedMs + Math.max(0, Date.now() - pauseStartedAt)
            : pausedAccumulatedMs;
        addTimelineEvent('SCENARIO_COMPLETED', {
            scenarioId: activeScenario?.id,
            stageId: activeStage,
            completionReason,
            elapsedMs: scenarioStartedAt ? (Date.now() - scenarioStartedAt) : null,
            pausedMs: totalPausedMs
        });
        decisionWindowOpen = false;
        clearTimers();
        stopVirtualClock();
        if (scenarioAudio) { scenarioAudio.pause(); scenarioAudio.src = ''; scenarioAudio = null; }
        hidePatientSubtitle();
        // Emit final update to hide the timer chip in UI
        emitVirtualClockUpdate({ active: false, isRunning: false, status: 'OFF' });
        // Reset vitals and expression to baseline after scenario completes
        if (vitalsMonitor) {
            vitalsMonitor.stopTeachingTimeline?.();
            vitalsMonitor.setManualMode?.(true);
            vitalsMonitor.setVitalsFreeze?.(true);
            vitalsMonitor.applyTeachingPreset({
                id: OFF_BASELINE.id,
                targets: { ...OFF_BASELINE.targets },
                subjective: { ...OFF_BASELINE.subjective },
                cues: { ...OFF_BASELINE.cues },
                useBase: true
            });
        }
        activeScenario = null;
        activeStage = null;
        scenarioStartedAt = null;
        pauseStartedAt = null;
        pausedAccumulatedMs = 0;
        completionRequested = false;
        stage12RemainingMs = null;
        outcomeRemainingMs = null;
        // If the massage session is still running, stop it now.
        // activeScenario is already null so handleSessionEnded will return early,
        // preventing any re-entry or double-completion.
        if (window.currentMassageSession) {
            const reportStopFailure = error => {
                const message = error?.message || 'Robot Stop was not confirmed. Retry Stop or use the pendant Stop button.';
                if (typeof window.addSystemMessage === 'function') window.addSystemMessage(message, 'error');
                else console.error('[ScenarioController]', message);
            };
            try {
                const stopping = typeof window.app?.stopSession === 'function'
                    ? window.app.stopSession('scenario_completed')
                    : window.currentMassageSession.stop?.('scenario_completed');
                Promise.resolve(stopping).catch(reportStopFailure);
            } catch (error) {
                reportStopFailure(error);
            }
        }
    }

    function enableKeyboardExpressionMode() {
        localStorage.setItem('teachingVitalsMode', 'keyboard');
        if (window.instructorTools?.setVitalsMode) {
            window.instructorTools.setVitalsMode('keyboard');
        }
    }

    function resetScenarioRuntimeState() {
        runtimeGeneration++;
        clearTimers();
        activeScenario = null;
        activeStage = null;
        decisionWindowOpen = false;
        intermediateDecisionWindowOpen = false;
        scenarioStartedAt = null;
        pauseStartedAt = null;
        pausedAccumulatedMs = 0;
        stage12RemainingMs = null;
        outcomeRemainingMs = null;
        completionRequested = false;
        if (expressionDelayTimer) { clearTimeout(expressionDelayTimer); expressionDelayTimer = null; }
    }

    function startScenarioForSession() {
        if (!vitalsMonitor) return;
        if (selectedScenarioId === 'scenario_0') {
            resetScenarioRuntimeState();
            stopVirtualClock();
            vitalsMonitor.stopTeachingTimeline?.();
            vitalsMonitor.setManualMode?.(true);
            vitalsMonitor.setVitalsFreeze?.(true);
            vitalsMonitor.applyTeachingPreset({
                id: 'scenario_0_keyboard_baseline',
                targets: { ...OFF_BASELINE.targets },
                subjective: { ...OFF_BASELINE.subjective },
                cues: { ...OFF_BASELINE.cues },
                useBase: true
            });
            enableKeyboardExpressionMode();
            addTimelineEvent('SCENARIO_STARTED', {
                scenarioId: 'scenario_0',
                label: SCENARIOS.scenario_0.label
            });
            addTimelineEvent('SCENARIO_STAGE_CHANGED', {
                scenarioId: 'scenario_0',
                stageId: 'scenario_0_keyboard_baseline',
                reason: 'session_start_keyboard_practice',
                vitals: OFF_BASELINE.targets,
                subjective: OFF_BASELINE.subjective
            });
            emitVirtualClockUpdate({ active: false, isRunning: false, status: 'KEYBOARD' });
            if (typeof window.syncYear65UI === 'function') {
                window.syncYear65UI();
            }
            return;
        }
        if (selectedScenarioId === 'off') {
            resetScenarioRuntimeState();

            vitalsMonitor.stopTeachingTimeline?.();
            vitalsMonitor.setManualMode?.(true);
            vitalsMonitor.setVitalsFreeze?.(true);
            vitalsMonitor.applyTeachingPreset({
                id: OFF_BASELINE.id,
                targets: { ...OFF_BASELINE.targets },
                subjective: { ...OFF_BASELINE.subjective },
                cues: { ...OFF_BASELINE.cues },
                useBase: true
            });
            addTimelineEvent('SCENARIO_STAGE_CHANGED', {
                scenarioId: 'off',
                stageId: OFF_BASELINE.id,
                reason: 'session_start_off_baseline',
                vitals: OFF_BASELINE.targets,
                subjective: OFF_BASELINE.subjective
            });
            emitVirtualClockUpdate({ active: false, isRunning: false, status: 'OFF' });
            return;
        }

        const scenario = SCENARIOS[selectedScenarioId];
        if (!scenario) return;

        clearTimers();
        if (expressionDelayTimer) { clearTimeout(expressionDelayTimer); expressionDelayTimer = null; }
        stopVirtualClock();
        virtualElapsedSec = 0;
        if (scenarioAudio) { scenarioAudio.pause(); scenarioAudio.src = ''; scenarioAudio = null; }
        activeScenario = scenario;
        activeStage = null;
        decisionWindowOpen = false;
        intermediateDecisionWindowOpen = false;
        scenarioStartedAt = Date.now();
        pauseStartedAt = null;
        pausedAccumulatedMs = 0;
        completionRequested = false;
        stage12RemainingMs = null;
        outcomeRemainingMs = null;

        vitalsMonitor.stopTeachingTimeline?.();
        vitalsMonitor.setManualMode?.(true);
        vitalsMonitor.setVitalsFreeze?.(false);

        applyStage(scenario.baseline, 'session_start');
        addTimelineEvent('SCENARIO_STARTED', {
            scenarioId: scenario.id,
            label: scenario.label
        });
        scheduleStage12(60000);
    }

    function handleStopLikeReason(reason) {
        if (!activeScenario) return false;
        const isStopLike = reason === 'manual' || reason === 'emergency' || reason === 'student_stop';
        if (!isStopLike) return false;
        const playDeterministicStopSoundtrack = () => {
            const stopTrack = activeScenario?.stopOutcome?.soundtrackId;
            if (!stopTrack) return;
            playScenarioDialogue(stopTrack, { suppressClinicalReflection: true });
        };

        // Intermediate progression window:
        // - Scenario 1 stop/soft-stop stays at continueIntermediate (1.3.b.1 mild_pain).
        // - Other scenarios keep existing mapping to continueOutcome.
        if (intermediateDecisionWindowOpen) {
            intermediateDecisionWindowOpen = false;
            clearTimers();
            const stayingAtIntermediate = activeScenario.id === 'scenario_1' && !!activeScenario.continueIntermediate;
            const stageToApply = stayingAtIntermediate
                ? activeScenario.continueIntermediate
                : activeScenario.continueOutcome;
            const skipDialogue = stayingAtIntermediate && activeStage === stageToApply.id;
            applyStage(stageToApply, `stop_${reason}_intermediate`, { skipDialogueReplay: skipDialogue });
            if (!stayingAtIntermediate) {
                playDeterministicStopSoundtrack();
            }
            addTimelineEvent('SCENARIO_DECISION_STOP', {
                scenarioId: activeScenario.id,
                reason,
                phase: 'intermediate'
            });
            requestScenarioCompletion('student_stopped_intermediate', !stayingAtIntermediate, stayingAtIntermediate ? 10000 : 0);
            return true;
        }

        // First decision window: student stopped during stage12 → stopOutcome.
        if (decisionWindowOpen) {
            decisionWindowOpen = false;
            clearTimers();
            applyStage(activeScenario.stopOutcome, `stop_${reason}`, { skipDialogueReplay: true });
            playDeterministicStopSoundtrack();
            addTimelineEvent('SCENARIO_DECISION_STOP', {
                scenarioId: activeScenario.id,
                reason,
                phase: 'stage12'
            });
            // Keep stop outcome visible for 10s from entry into 1.3.a.
            requestScenarioCompletion('student_stopped', false, 10000);
            return true;
        }

        // Late stop: student stopped after reaching continueOutcome (1.3.b / 1.3.b.2).
        // Cancel the long hold timer and give a brief 15s view before completing.
        const inContinueOutcome = activeScenario.continueOutcome &&
            activeStage === activeScenario.continueOutcome.id;
        if (inContinueOutcome) {
            clearTimers();
            completionRequested = false;          // reset so the new request is accepted
            addTimelineEvent('SCENARIO_DECISION_STOP', {
                scenarioId: activeScenario.id,
                reason,
                phase: 'continue_outcome'
            });
            requestScenarioCompletion('student_stopped_late', false, 15000);
            return true;
        }

        return false;
    }

    function handleSessionEndRequested(event) {
        if (!activeScenario) return;
        const reason = event?.detail?.reason || 'unknown';
        // If a decision window is open, treat any end request as a stop regardless of reason.
        const effectiveReason = (decisionWindowOpen || intermediateDecisionWindowOpen)
            ? 'student_stop'
            : reason;
        handleStopLikeReason(effectiveReason);
    }

    function handleSessionEnded(event) {
        if (!activeScenario) return;

        const reason = event?.detail?.reason || 'unknown';
        // If a decision window is open, treat any session end as a stop regardless of reason.
        // This guards against the robot firing a non-stop-like reason (e.g. 'stop', 'completed')
        // which would bypass stopOutcome and reset to baseline immediately.
        const effectiveReason = (decisionWindowOpen || intermediateDecisionWindowOpen)
            ? 'student_stop'
            : reason;
        if (handleStopLikeReason(effectiveReason)) return;
        requestScenarioCompletion(`session_end_${reason}`, true);
    }

    function handleSessionPaused() {
        if (!activeScenario) return;
        hidePatientSubtitle();

        // Soft stop behavior: if paused during a decision window,
        // immediately apply the corresponding stop-like stage without ending scenario.
        if (intermediateDecisionWindowOpen) {
            intermediateDecisionWindowOpen = false;
            decisionWindowOpen = false;
            clearTimers();
            const stageToApply = (activeScenario.id === 'scenario_1' && activeScenario.continueIntermediate)
                ? activeScenario.continueIntermediate
                : activeScenario.continueOutcome;
            const shouldSkipDialogueReplay = activeScenario.id === 'scenario_1'
                && stageToApply?.id === activeScenario.continueIntermediate?.id
                && activeStage === stageToApply.id;
            applyStage(stageToApply, 'soft_stop_intermediate', { skipDialogueReplay: shouldSkipDialogueReplay });
            addTimelineEvent('SCENARIO_DECISION_STOP', {
                scenarioId: activeScenario.id,
                reason: 'soft_stop',
                phase: 'intermediate'
            });
            requestScenarioCompletion('soft_stop_intermediate', true);
        } else if (decisionWindowOpen) {
            decisionWindowOpen = false;
            clearTimers();
            applyStage(activeScenario.stopOutcome, 'soft_stop_stage12');
            addTimelineEvent('SCENARIO_DECISION_STOP', {
                scenarioId: activeScenario.id,
                reason: 'soft_stop',
                phase: 'stage12'
            });
            // Keep stop outcome visible for 10s from entry into 1.3.a (both S1 and S2).
            requestScenarioCompletion('student_stopped', false, 10000);
        }

        if (!pauseStartedAt) {
            pauseStartedAt = Date.now();
        }

        stopVirtualClock();
        emitVirtualClockUpdate({ active: true, isRunning: false, status: 'SOFT STOP' });

        if (stage12Timer && stage12DueAt) {
            stage12RemainingMs = Math.max(0, stage12DueAt - Date.now());
            clearTimeout(stage12Timer);
            stage12Timer = null;
            stage12DueAt = null;
        }

        if (outcomeTimer && outcomeDueAt) {
            outcomeRemainingMs = Math.max(0, outcomeDueAt - Date.now());
            clearTimeout(outcomeTimer);
            outcomeTimer = null;
            outcomeDueAt = null;
        }

        addTimelineEvent('SCENARIO_STAGE_CHANGED', {
            scenarioId: activeScenario.id,
            stageId: activeStage,
            reason: 'session_paused'
        });
    }

    function handleSessionResumed() {
        if (!activeScenario) return;

        if (pauseStartedAt) {
            pausedAccumulatedMs += Math.max(0, Date.now() - pauseStartedAt);
            pauseStartedAt = null;
        }

        if (stage12RemainingMs != null && stage12RemainingMs >= 0 && !stage12Timer && !decisionWindowOpen) {
            const resumeDelay = stage12RemainingMs;
            stage12RemainingMs = null;
            scheduleStage12(resumeDelay);
        }

        if (outcomeRemainingMs != null && outcomeRemainingMs >= 0 && !outcomeTimer && (decisionWindowOpen || intermediateDecisionWindowOpen)) {
            const resumeDelay = outcomeRemainingMs;
            outcomeRemainingMs = null;
            scheduleOutcome(resumeDelay);
        }

        if (!virtualTimeInterval && virtualRateSecsPerSec > 0) {
            startVirtualTicker();
        }
        emitVirtualClockUpdate({
            active: true,
            isRunning: !!virtualTimeInterval,
            status: virtualTimeInterval ? 'RUNNING' : 'FROZEN'
        });

        addTimelineEvent('SCENARIO_STAGE_CHANGED', {
            scenarioId: activeScenario.id,
            stageId: activeStage,
            reason: 'session_resumed'
        });
    }

    function selectScenario(scenarioId, source = 'ui') {
        const normalized = SCENARIOS[scenarioId] ? scenarioId : 'off';
        selectedScenarioId = normalized;
        localStorage.setItem(STORAGE_KEY, normalized);

        if (activeScenario && activeScenario.id !== normalized) {
            completeScenario('selection_changed');
        }

        if (normalized === 'off') {
            stopVirtualClock();
            emitVirtualClockUpdate({ active: false, isRunning: false, status: 'OFF' });
        }

        if (scenarioSelectEl) {
            scenarioSelectEl.value = normalized;
        }
        updateScenarioBadge();

        addTimelineEvent('SCENARIO_SELECTED', {
            scenarioId: normalized,
            source
        });

        const label = SCENARIOS[normalized]?.label || 'Off';
        announce(`selected ${label}`);
    }

    function handleHotkey(event) {
        if (!event) return;
        if (event.key === 'F6') {
            event.preventDefault();
            selectScenario('scenario_0', 'hotkey_f6');
            return;
        }
        if (event.key === 'F7') {
            event.preventDefault();
            selectScenario('scenario_1', 'hotkey_f7');
            return;
        }
        if (event.key === 'F8') {
            event.preventDefault();
            selectScenario('scenario_2', 'hotkey_f8');
            return;
        }
        if (event.key === 'F9') {
            event.preventDefault();
            selectScenario('off', 'hotkey_f9');
        }
    }

    function bindUI() {
        if (scenarioSelectEl) {
            scenarioSelectEl.value = selectedScenarioId;
            scenarioSelectEl.addEventListener('change', (event) => {
                selectScenario(event.target.value, 'select');
            });
        }
        updateScenarioBadge();

        window.addEventListener('massageSessionStarted', startScenarioForSession);
        window.addEventListener('massageSessionPaused', handleSessionPaused);
        window.addEventListener('massageSessionResumed', handleSessionResumed);
        window.addEventListener('massageSessionEndRequested', handleSessionEndRequested);
        window.addEventListener('massageSessionEnded', handleSessionEnded);
        document.addEventListener('keydown', handleHotkey);
    }

    bindUI();

    return {
        getSelectedScenarioId: () => selectedScenarioId,
        getActiveScenarioId: () => activeScenario?.id || null,
        selectScenario
    };
}

export const NursingScenarioController = {
    createScenarioController
};
