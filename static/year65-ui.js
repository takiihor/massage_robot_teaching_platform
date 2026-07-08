/**
 * Year65 UI Module - Optimized Stateless Rendering Functions
 */

// ============================================================================
// CONSTANTS & PERFORMANCE CACHE
// ============================================================================

const MODE_LABELS = {
  1: { text: "向上推", icon: "↑", modeNum: "Mode 1" },
  2: { text: "波浪推", icon: "～", modeNum: "Mode 2" },
  3: { text: "螺旋按", icon: "◎", modeNum: "Mode 3" },
  4: { text: "揉捏", icon: "🤲", modeNum: "Mode 4" }
};

const MODE_LABELS_EN = { 1: "Push Up", 2: "Wave Push", 3: "Spiral Press", 4: "Knead" };
const INTENSITY_LABELS_EN = { low: "Low", mid: "Medium", high: "High" };
const INTENSITY_LABELS = { low: "小", mid: "中", high: "大" };

const AVATAR_ASSET_BASE = "/static/assets/avatar/";
export const AVATAR_FILES = {
  base: "baseline.png",
  pain0: "face_pain_0_neutral.png",
  pain1: "face_pain_1_moderate.png",
  pain2: "face_pain_2_high.png",
  anxLow: "face_anxiety_low.png",
  anxHigh: "face_anxiety_high.png",
  sweatLight: "overlay_sweat_light.png",
  sweatHeavy: "overlay_sweat_heavy.png"
};

export const EXPRESSION_PRESET_FILES = {
  baseline: "baseline.png",
  mild_anxiety: "mild_anxiety.png",
  neutral_pain: "neutral_pain.png",
  mild_pain: "mild_pain.png",
  moderate_pain: "moderate_pain.png",
  severe_pain: "severe_pain.png",
  high_anxiety: "high_anxiety.png",
  panic: "Panic.png"
};

let _expressionFadeState = null;
let _lastExpressionSnapshot = { pain: 0, anxiety: 0, presetId: null, forceBase: false };
let _expressionLockActive = false;
let _expressionLockPresetId = null;
const sparklineCache = {};

function normalizeVitalSnapshot(vitals = {}) {
  return {
    hr: Number(vitals.hr ?? 89),
    sbp: Number(vitals.sbp ?? vitals.bpSys ?? 115),
    dbp: Number(vitals.dbp ?? vitals.bpDia ?? 73),
    rr: Number(vitals.rr ?? 18),
    spo2: Number(vitals.spo2 ?? 97)
  };
}

export function resetVitalsAndExpressionBaseline(vitals = {}) {
  const baseline = normalizeVitalSnapshot(vitals);
  _vitalSmoothingState = { ...baseline, initialized: true };
  _lastRenderedHr = null;
  _lastRenderedRr = null;
  _expressionFadeState = null;
  _expressionLockActive = false;
  _expressionLockPresetId = null;
  _lastExpressionSnapshot = { pain: 0, anxiety: 0, presetId: 'baseline', forceBase: true };

  const values = {
    vitalHR: baseline.hr,
    vitalSBP: baseline.sbp,
    vitalDBP: baseline.dbp,
    vitalRR: baseline.rr,
    vitalSPO2: baseline.spo2
  };
  Object.entries(values).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.textContent = String(Math.round(value));
  });
}

const domCache = {};
const _lastAppliedStyles = {};

function $(id) {
  if (domCache[id] !== undefined) return domCache[id];
  const el = document.getElementById(id);
  domCache[id] = el;
  return el;
}

// ============================================================================
// UTILITIES & PROMPTS
// ============================================================================

export function formatRemainTime(sec) {
  if (typeof sec !== "number" || sec < 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

export function getUIModeLabel(uiMode) {
  if (uiMode === "SETUP") return "待開始";
  if (uiMode === "RUNNING") return "進行中";
  if (uiMode === "PAUSED") return "已暫停";
  if (uiMode === "STOPPED") return "已停止";
  return uiMode;
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function setStyleIfChanged(element, property, value) {
  if (!element) return;
  const key = `${element.id}_${property}`;
  if (_lastAppliedStyles[key] !== value) {
    element.style.setProperty(property, value);
    _lastAppliedStyles[key] = value;
  }
}

export function playStudentActionPrompt() {
    const audio = $("actionPromptAudio");
    if (audio) audio.play().catch(e => console.log("Audio play blocked by browser:", e));
    
    const timerCard = $("y65VirtualTimeContainer");
    if(timerCard) {
        timerCard.style.boxShadow = "0 0 20px rgba(255, 50, 50, 0.8)";
        setTimeout(() => timerCard.style.boxShadow = "", 3000);
    }

    let promptEl = $("studentActionPromptModal");
    if (!promptEl) {
        promptEl = document.createElement("div");
        promptEl.id = "studentActionPromptModal";
        promptEl.innerHTML = `
            <div style="position: fixed; top: 12%; left: 50%; transform: translate(-50%, 0); 
                        background: rgba(220, 38, 38, 0.95); color: white; padding: 20px 30px; 
                        border-radius: 12px; font-size: 1.2rem; font-weight: bold; z-index: 10000; 
                        box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center;
                        border: 2px solid #f87171; min-width: 300px;
                        animation: slideDownFade 0.4s ease-out forwards;">
                <div style="font-size: 2rem; margin-bottom: 8px;">⚠️</div>
                <div style="font-size: 1.3rem;">Patient Condition Changed</div>
                <div style="font-size: 1rem; font-weight: normal; margin-top: 6px; opacity: 0.95;">
                    Action required: Do you need to adjust or stop the massage?
                </div>
            </div>
            <style>
                @keyframes slideDownFade { from { top: 0; opacity: 0; } to { top: 12%; opacity: 1; } }
                @keyframes fadeOutUp { from { top: 12%; opacity: 1; } to { top: 0; opacity: 0; } }
            </style>
        `;
        document.body.appendChild(promptEl);
    } else {
        promptEl.style.display = "block";
        promptEl.firstElementChild.style.animation = "slideDownFade 0.4s ease-out forwards";
    }

    setTimeout(() => {
        if (promptEl) {
            promptEl.firstElementChild.style.animation = "fadeOutUp 0.4s ease-in forwards";
            setTimeout(() => { promptEl.style.display = "none"; }, 400);
        }
    }, 6000);
}
window.playStudentActionPrompt = playStudentActionPrompt; 

function deriveCuesFromVitals(vitals = {}) {
  const hr = Number(vitals.hr ?? 0);
  const rr = Number(vitals.rr ?? 0);
  const spo2 = Number(vitals.spo2 ?? 0);

  let pain = 'low'; let anxiety = 'calm'; let comfort = 'comfortable';

  if (hr >= 110 || rr >= 24) pain = 'high';
  else if (hr >= 95 || rr >= 20) pain = 'moderate';

  if (hr >= 115 || rr >= 26) anxiety = 'panic';
  else if (hr >= 100 || rr >= 20) anxiety = 'uneasy';

  const painScore = pain === 'high' ? 9 : (pain === 'moderate' ? 6 : 2);
  const anxietyScore = anxiety === 'panic' ? 9 : (anxiety === 'uneasy' ? 6 : 2);
  const comfortScore = Math.max(1, Math.min(5, 5 - Math.round(Math.max(painScore, anxietyScore) / 2)));

  if (comfortScore >= 4) comfort = 'comfortable';
  else if (comfortScore === 3) comfort = 'neutral';
  else comfort = 'uncomfortable';

  if ((spo2 > 0 && spo2 <= 92) || hr >= 110 || rr >= 24) comfort = 'uncomfortable';
  return { pain, anxiety, comfort };
}

// ============================================================================
// AVATAR SYSTEM
// ============================================================================

export function pickAvatarFile(presetId) {
  if (!presetId) return AVATAR_FILES.base;
  return EXPRESSION_PRESET_FILES[presetId] || AVATAR_FILES.base;
}

export function updateAvatarVisuals(pain, anxiety, vitals = {}, isPaused = false, options = {}) {
  const stage = $("y65AvatarStage");
  const fig = $("y65AvatarFigure");
  const base = $("y65AvatarBase");
  const face = $("y65AvatarFace");
  const sweat = $("y65AvatarSweat");
  const chestGlow = $("y65ChestGlow");
  const chestRing = $("y65ChestRing");
  const fallback = $("y65AvatarFallback");
  const placeholder = $("y65AvatarPlaceholder");

  if (!stage || !fig || !base) return;

  const painValue = Number(pain ?? 0);
  const anxietyValue = Number(anxiety ?? 0);
  const uiMode = options?.uiMode ?? "";
  const showExpression = uiMode !== "STOPPED";
  const forceBase = options?.forceBase === true;
  const presetId = options?.presetId || null;

  stage.classList.toggle("y65-fade-baseline", uiMode === "STOPPED");

  const stressScore = Math.max(painValue, anxietyValue);
  const isCalm = uiMode === "STOPPED" || stressScore <= 3;
  const isCritical = stressScore >= 7;
  stage.classList.toggle("y65-stage-calm", isCalm);
  stage.classList.toggle("y65-stage-stress", !isCalm && !isCritical);
  stage.classList.toggle("y65-stage-critical", !isCalm && isCritical);

  // Patient State UI removed from main view.

  const avatarFile = forceBase ? AVATAR_FILES.base : (showExpression ? pickAvatarFile(presetId) : AVATAR_FILES.base);
  const avatarSrc = AVATAR_ASSET_BASE + avatarFile;

  if (!base.dataset.avatarFile || base.dataset.avatarFile !== avatarFile) {
    base.src = avatarSrc;
    base.dataset.avatarFile = avatarFile;
    fig.classList.add("swap");
    if (fig._swapTimer) clearTimeout(fig._swapTimer);
    fig._swapTimer = setTimeout(() => fig.classList.remove("swap"), 260);
  }

  if (options?.baseOpacity != null) base.style.opacity = String(options.baseOpacity);
  else base.style.opacity = "";

  if (face) { face.style.display = "none"; face.removeAttribute("src"); }
  if (sweat) { sweat.style.display = "none"; sweat.style.opacity = "0"; }

  const rr = Number(vitals?.rr ?? 18);
  const hr = Number(vitals?.hr ?? 80);
  const rrNorm = clamp01((rr - 12) / (28 - 12));
  const hrNorm = clamp01((hr - 60) / (130 - 60));
  const anxNorm = clamp01(anxietyValue / 10);
  const painNorm = clamp01(painValue / 10);
  const stressNorm = clamp01(0.55 * anxNorm + 0.45 * painNorm);
  
  const breathDur = lerp(4.6, 2.1, clamp01(0.6 * rrNorm + 0.4 * stressNorm));
  const breathShift = lerp(1.2, 2.0, clamp01(rrNorm + stressNorm * 0.35));
  const breathScale = lerp(1.006, 1.014, clamp01(rrNorm + stressNorm * 0.4));
  
  setStyleIfChanged(fig, "--y65-breath-dur", breathDur.toFixed(2) + "s");
  setStyleIfChanged(fig, "--y65-breath-shift", breathShift.toFixed(2) + "px");
  setStyleIfChanged(fig, "--y65-breath-scale", breathScale.toFixed(3));

  const heartDur = lerp(1.35, 0.55, clamp01((hr - 55) / (140 - 55)));
  const glowOpacity = lerp(0.7, 1, clamp01(stressNorm + hrNorm * 0.35));
  
  if (chestGlow) {
    setStyleIfChanged(chestGlow, "--y65-heart-dur", heartDur.toFixed(2) + "s");
    setStyleIfChanged(chestGlow, "--y65-glow-opacity", glowOpacity.toFixed(2));
    chestGlow.style.animationPlayState = isPaused ? "paused" : "running";
  }
  if (chestRing) {
    setStyleIfChanged(chestRing, "--y65-heart-dur", heartDur.toFixed(2) + "s");
    chestRing.style.animationPlayState = isPaused ? "paused" : "running";
  }

  const tremorOn = anxietyValue >= 10 || painValue >= 9;
  fig.classList.toggle("tremor", tremorOn);
  if (tremorOn) {
    const tremorDur = lerp(1100, 700, clamp01((anxietyValue + painValue) / 20));
    setStyleIfChanged(fig, "--y65-tremor-dur", Math.round(tremorDur) + "ms");
  }

  const play = !isPaused;
  fig.style.animationPlayState = play ? "running" : "paused";

  if (sweat) {
    const sweatOn = anxietyValue >= 6 || painValue >= 7;
    const hasSweatAsset = !!sweat.getAttribute("src");
    if (sweatOn && hasSweatAsset) {
      const sweatDur = lerp(7.2, 4.2, clamp01(stressNorm + hrNorm * 0.35));
      const sweatOpacity = lerp(0.25, 0.8, clamp01(stressNorm + hrNorm * 0.35));
      sweat.style.display = "block";
      sweat.style.opacity = sweatOpacity.toFixed(2);
      setStyleIfChanged(sweat, "--y65-sweat-dur", sweatDur.toFixed(2) + "s");
      setStyleIfChanged(sweat, "--y65-sweat-op", sweatOpacity.toFixed(2));
    }
  }

  const missing = stage.classList.contains("missing-assets");
  if (fallback) fallback.style.display = missing ? "block" : "none";
  if (placeholder) placeholder.style.display = missing ? "grid" : "none";
}

export function bindAvatarAssetGuardsOnce() {
  const stage = $("y65AvatarStage");
  const base = $("y65AvatarBase");
  if (!stage || !base) return;
  if (!base.dataset._guard) {
    base.addEventListener("error", () => stage.classList.add("missing-assets"));
    base.addEventListener("load", () => stage.classList.remove("missing-assets"));
    base.dataset._guard = "1";
  }
}

// ============================================================================
// RENDERING FUNCTIONS
// ============================================================================

let _vitalSmoothingState = { hr: 0, sbp: 0, dbp: 0, rr: 0, spo2: 0, initialized: false };
let _lastRenderedHr = null;
let _lastRenderedRr = null;
let _lastClinicalReflectionAt = 0;

function renderBeats(group, beatId, count, beatWidth) {
  if (!group) return;
  let html = "";
  for (let i = 0; i < count; i++) {
    html += `<use href="#${beatId}" x="${i * beatWidth}"/>`;
  }
  group.innerHTML = html;
}

export function renderVitalsOnly(state) {
  if (!state) return;

  const DEFAULT_METRICS = { pain: 1, anxiety: 1 };
  const scenarioActive = Boolean(state.instructor?.scenario?.activeScenarioId);
  const vitals = (state.uiMode === "STOPPED" && !scenarioActive)
    ? { hr: 75, bpSys: 120, bpDia: 75, rr: 14, spo2: 98 }
    : (state.vitals || {});
  const cues = state.cues || deriveCuesFromVitals(vitals);
  
  const normalizedVitals = normalizeVitalSnapshot(vitals);
  if (!_vitalSmoothingState.initialized) {
    _vitalSmoothingState = { ...normalizedVitals, initialized: true };
  }

  const sf = 0.1;
  _vitalSmoothingState.hr = lerp(_vitalSmoothingState.hr, normalizedVitals.hr, sf);
  _vitalSmoothingState.sbp = lerp(_vitalSmoothingState.sbp, normalizedVitals.sbp, sf);
  _vitalSmoothingState.dbp = lerp(_vitalSmoothingState.dbp, normalizedVitals.dbp, sf);
  _vitalSmoothingState.rr = lerp(_vitalSmoothingState.rr, normalizedVitals.rr, sf);
  _vitalSmoothingState.spo2 = lerp(_vitalSmoothingState.spo2, normalizedVitals.spo2, sf);

  requestAnimationFrame(() => {
    if ($("vitalHR")) $("vitalHR").textContent = Math.round(_vitalSmoothingState.hr);
    if ($("vitalSBP")) $("vitalSBP").textContent = Math.round(_vitalSmoothingState.sbp);
    if ($("vitalDBP")) $("vitalDBP").textContent = Math.round(_vitalSmoothingState.dbp);
    if ($("vitalRR")) $("vitalRR").textContent = Math.round(_vitalSmoothingState.rr);
    if ($("vitalSPO2")) $("vitalSPO2").textContent = Math.round(_vitalSmoothingState.spo2);
  });

  const currentHrInt = Math.round(_vitalSmoothingState.hr);
  const currentRrInt = Math.round(_vitalSmoothingState.rr);

  if (currentHrInt !== _lastRenderedHr || currentRrInt !== _lastRenderedRr) {
    const SWEEP_TIME = 3.75;
    const BEAT_WIDTH = 100;

    const cardiacBeats = Math.max(2, Math.ceil((currentHrInt / 60) * SWEEP_TIME));
    const respBeats = Math.max(1, Math.ceil((currentRrInt / 60) * SWEEP_TIME));
    const cardiacWidth = cardiacBeats * BEAT_WIDTH;
    const respWidth = respBeats * BEAT_WIDTH;

    $("svg-hr")?.setAttribute("viewBox", `0 0 ${cardiacWidth} 100`);
    $("svg-bp")?.setAttribute("viewBox", `0 0 ${cardiacWidth} 100`);
    $("svg-spo2")?.setAttribute("viewBox", `0 0 ${cardiacWidth} 100`);
    $("svg-rr")?.setAttribute("viewBox", `0 0 ${respWidth} 100`);

    $("anim-hr")?.setAttribute("to", cardiacWidth);
    $("anim-bp")?.setAttribute("to", cardiacWidth);
    $("anim-spo2")?.setAttribute("to", cardiacWidth);
    $("anim-rr")?.setAttribute("to", respWidth);

    renderBeats($("group-hr"), "ecg-beat", cardiacBeats, BEAT_WIDTH);
    renderBeats($("group-bp"), "bp-beat", cardiacBeats, BEAT_WIDTH);
    renderBeats($("group-spo2"), "spo2-beat", cardiacBeats, BEAT_WIDTH);
    renderBeats($("group-rr"), "rr-beat", respBeats, BEAT_WIDTH);

    _lastRenderedHr = currentHrInt;
    _lastRenderedRr = currentRrInt;
  }

  // Update Cues
  const cueMap = {
    pain: { none: { label: "— / —", level: 0 }, low: { label: "Low / 輕微", level: 0 }, mild: { label: "Mild / 較輕", level: 2 }, moderate: { label: "Moderate / 中等", level: 3 }, high: { label: "High / 嚴重", level: 4 }, severe: { label: "Severe / 極痛", level: 5 }},
    anxiety: { none: { label: "— / —", level: 0 }, calm: { label: "Calm / 冷靜", level: 0 }, uneasy: { label: "Uneasy / 緊張", level: 2 }, tense: { label: "Tense / 焦躁", level: 3 }, anxious: { label: "Anxious / 焦慮", level: 4 }, panic: { label: "Panic / 驚恐", level: 5 }},
    comfort: { none: { label: "— / —", level: 0 }, very_comfortable: { label: "Very Comfortable / 很舒適", level: 5 }, slightly_uncomfortable: { label: "Slightly Uncomfortable / 略不適", level: 2 }, uncomfortable: { label: "Uncomfortable / 不適", level: 0 }, neutral: { label: "Neutral / 一般", level: 3 }, comfortable: { label: "Comfortable / 舒適", level: 4 }}
  };

  const parseCueLevel = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, Math.min(5, Math.round(numeric)));
  };

  const applyCue = (key, value, elementId, explicitLevel = null) => {
    const cueValue = String(value || "").toLowerCase().trim();
    const normalizedValue = cueValue.replace(/\s+/g, "_");
    const cueConfig = cueMap[key] || {};
    const match = Object.keys(cueConfig).find(name => normalizedValue.includes(name));
    const fallbackLevel = parseCueLevel(cueValue);
    const level = explicitLevel ?? (match ? cueConfig[match].level : (fallbackLevel ?? 0));
    
    const displayLevel = level * 2;

    requestAnimationFrame(() => {
      const valueEl = $(elementId);
      const cueCard = valueEl?.closest?.(".y65-cue");
      if (cueCard) {
        const bars = cueCard.querySelectorAll(".y65-cue-bar");
        bars.forEach((bar, idx) => bar.classList.toggle("active", idx < displayLevel));
      }
    });
  };

  applyCue("pain", cues.pain, "cuePain", parseCueLevel(state.instructor?.scenario?.pain));
  applyCue("anxiety", cues.anxiety, "cueAnxiety", parseCueLevel(state.instructor?.scenario?.anxiety));
  applyCue("comfort", cues.comfort, "cueComfort", parseCueLevel(state.instructor?.scenario?.comfort));

  // Avatar Expression Logic
  bindAvatarAssetGuardsOnce();
  
  const autoExpression = state.instructor?.autoExpressionFromVitals === true; 
  let pain = 0, anxiety = 0, forceBase = false, presetId = null, baseOpacity = null;

  if (autoExpression) {
    presetId = state.instructor?.scenario?.presetActive || state.instructor?.presetActive || null;
    const cueToScore = (value, type) => {
      const raw = String(value ?? "").toLowerCase();
      if (!raw) return 1;
      if (type === "pain") {
        if (raw.includes("severe")) return 9;
        if (raw.includes("high")) return 7;
        if (raw.includes("moderate")) return 5;
        if (raw.includes("mild")) return 3;
        if (raw.includes("low") || raw.includes("none")) return 1;
      }
      if (type === "anxiety") {
        if (raw.includes("panic")) return 9;
        if (raw.includes("anxious")) return 7;
        if (raw.includes("tense")) return 6;
        if (raw.includes("uneasy")) return 4;
        if (raw.includes("calm") || raw.includes("none")) return 1;
      }
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) return Math.max(0, Math.min(9, Math.round(numeric)));
      return 1;
    };
    if (state.uiMode === "STOPPED" && !scenarioActive) {
      const now = Date.now();
      if (!_expressionFadeState) {
        _expressionFadeState = { startAt: now, durationMs: 5000, from: { ..._lastExpressionSnapshot } };
        _expressionLockActive = true;
        _expressionLockPresetId = _lastExpressionSnapshot.presetId || null;
      }
      const progress = clamp01((now - _expressionFadeState.startAt) / _expressionFadeState.durationMs);
      const eased = 1 - Math.pow(1 - progress, 2);
      const from = _expressionFadeState.from || _lastExpressionSnapshot;
      pain = lerp(from.pain ?? 0, DEFAULT_METRICS.pain, eased);
      anxiety = lerp(from.anxiety ?? 0, DEFAULT_METRICS.anxiety, eased);
      forceBase = true;
      baseOpacity = eased.toFixed(3);
      if (progress >= 1) _expressionFadeState = null;
    } else {
      pain = cueToScore(cues.pain, "pain");
      anxiety = cueToScore(cues.anxiety, "anxiety");
      _expressionFadeState = null;
    }
  } else {
    pain = state.instructor?.scenario?.pain ?? 0;
    anxiety = state.instructor?.scenario?.anxiety ?? 0;
    presetId = state.instructor?.scenario?.presetActive || state.instructor?.presetActive || state.vitals?.preset || null;
    _expressionFadeState = null;
  }

  if (state.uiMode !== "STOPPED" && _expressionLockActive) {
    if (presetId && presetId !== _expressionLockPresetId) {
      _expressionLockActive = false;
      _expressionLockPresetId = null;
    } else {
      pain = DEFAULT_METRICS.pain; anxiety = DEFAULT_METRICS.anxiety; presetId = null; forceBase = true; baseOpacity = 1;
    }
  }

  if (state.uiMode !== "STOPPED" && !_expressionLockActive) {
    _lastExpressionSnapshot = { pain, anxiety, presetId, forceBase };
  }

  const avatarVitals = autoExpression ? vitals : { rr: 16 };
  updateAvatarVisuals(pain, anxiety, avatarVitals, state.uiMode === "PAUSED", { uiMode: state.uiMode, forceBase, presetId, baseOpacity });
}

export function renderStudentMassagePanel(massageConfig = {}, uiMode = "SETUP") {
  const root = $("y65MassagePanelRoot");
  if (!root) return;

  const toggle = $("quickStartModeToggle");
  const isQuickMode = toggle ? toggle.checked : false;

  const mode = isQuickMode ? 4 : (massageConfig.mode || 1);
  const intensity = isQuickMode ? "mid" : (massageConfig.intensity || "mid");
  const durationMin = isQuickMode ? 5 : (massageConfig.durationMin || 5);
  const autoRead = massageConfig.autoRead ?? true;

  const startLabel = (uiMode === "SETUP") ? "▶ Start Massage / 開始按摩" : (uiMode === "STOPPED") ? "Stopping..." : "Running...";
  const disabledAttr = (uiMode === "RUNNING" || uiMode === "PAUSED" || uiMode === "STOPPED") ? "disabled" : "";

  if (isQuickMode) {
      root.innerHTML = `
        <div class="y65-quick-mode-card">
            <h3>⚡ Quick Mode / 快速模式</h3>
            <div class="y65-quick-mode-details">
                <span class="y65-quick-tag">Massage Mode / 按摩模式</span>
                <span class="y65-quick-tag">Intensity: Mid / 力度：中</span>
                <span class="y65-quick-tag">Duration: 5 min / 時長：5分</span>
            </div>
            <p style="font-size:0.8rem; opacity:0.7; margin-bottom:15px;">Settings are locked in Quick Mode.</p>
            <button class="y65-start-btn" data-action="startMassage" type="button" ${disabledAttr} style="width:100%; padding: 16px;">
                ${startLabel}
            </button>
        </div>
      `;
      root.dataset.initialized = "false";
      return;
  }

  if (!root.dataset.initialized || root.dataset.initialized === "false") {
    const modeItems = [1, 2, 3, 4].map(m => `
      <button class="y65-mode-btn" data-action="setMode" data-mode="${m}" type="button">
        <div class="y65-mode-icon">${MODE_LABELS[m].icon}</div>
        <div class="y65-mode-text y65-label-stack">
          <span class="y65-label-primary">${MODE_LABELS_EN[m] || ""}</span>
          <span class="y65-label-secondary">${MODE_LABELS[m].text}</span>
        </div>
        <div class="y65-mode-num">${MODE_LABELS[m].modeNum || ""}</div>
      </button>
    `).join("");

    const intenButtons = [
      { key: "low", label: "Low / 小" }, { key: "mid", label: "Medium / 中" }, { key: "high", label: "High / 大" }
    ].map(x => `<button type="button" data-action="setIntensity" data-intensity="${x.key}">${x.label}</button>`).join("");

    const durButtons = [1, 3, 5].map(d => `<button type="button" class="y65-chip" data-action="setDuration" data-duration="${d}">${d} min / ${d}分鐘</button>`).join("");

    root.innerHTML = `
      <div class="y65-panel"><div class="y65-panel-title y65-label-stack"><span class="y65-label-primary">Massage Mode</span><span class="y65-label-secondary">按摩模式</span></div><div class="y65-mode-grid">${modeItems}</div></div>
      <div class="y65-panel"><div class="y65-panel-title y65-label-stack"><span class="y65-label-primary">Intensity</span><span class="y65-label-secondary">力度</span></div><div class="y65-seg" role="tablist">${intenButtons}</div></div>
      <div class="y65-panel"><div class="y65-panel-title y65-label-stack"><span class="y65-label-primary">Duration</span><span class="y65-label-secondary">時長</span></div><div class="y65-duration-row">${durButtons}</div></div>
      <button class="y65-start-btn" data-action="startMassage" type="button"></button>
      <div class="y65-panel"><div class="y65-panel-title y65-label-stack"><span class="y65-label-primary">Options</span><span class="y65-label-secondary">選項</span></div><div class="y65-check" data-action="toggleAutoRead" role="checkbox"><span class="y65-box"></span><span>Auto Read / 自動朗讀</span></div></div>
    `;
    root.dataset.initialized = "true";
  }

  requestAnimationFrame(() => {
    root.querySelectorAll('.y65-mode-btn').forEach(btn => btn.classList.toggle('active', parseInt(btn.dataset.mode) === mode));
    root.querySelectorAll('[data-action="setIntensity"]').forEach(btn => btn.classList.toggle('active', btn.dataset.intensity === intensity));
    root.querySelectorAll('[data-action="setDuration"]').forEach(btn => btn.classList.toggle('active', parseInt(btn.dataset.duration) === durationMin));

    const autoReadBtn = root.querySelector('[data-action="toggleAutoRead"]');
    if (autoReadBtn) {
      autoReadBtn.classList.toggle('checked', autoRead);
      autoReadBtn.setAttribute('aria-checked', autoRead);
      autoReadBtn.querySelector('.y65-box').textContent = autoRead ? "✓" : "";
    }

    const startBtn = root.querySelector('.y65-start-btn');
    if (startBtn) {
      const disabled = (uiMode === "RUNNING" || uiMode === "PAUSED" || uiMode === "STOPPED");
      startBtn.disabled = disabled;
      startBtn.textContent = (uiMode === "SETUP") ? "▶ Start Massage / 開始按摩" : (uiMode === "STOPPED") ? "Stopping... / 停止中…" : "Running... / 進行中…";
    }
  });
}

export function updateMiniBar() {
  // The mini control bar was removed from the teaching build to keep one clear stop path.
}

export function updateQuickModeVisibility(isQuickMode, uiMode) {
  requestAnimationFrame(() => {
    const normalUI = $("y65NormalUI");
    const quickUI = $("y65QuickUI");
    if (normalUI) normalUI.style.display = isQuickMode ? "none" : "block";
    const normalStopBtn = $("btnStudentStop");
    if (normalStopBtn) {
      const showNormalStop = !isQuickMode && uiMode !== "SETUP";
      normalStopBtn.hidden = !showNormalStop;
      normalStopBtn.disabled = uiMode === "STOPPED";
      normalStopBtn.textContent = (uiMode === "STOPPED") ? "Stopping... / 停止中…" : "End Session / 結束";
    }

    if (quickUI) quickUI.style.display = isQuickMode ? "block" : "none";
    
    if (isQuickMode) {
      const startBtn = $("y65FrontStartBtn");
      const stopBtn = $("y65FrontStopBtn");
      if (startBtn) startBtn.style.display = (uiMode === "SETUP") ? "block" : "none";
      if (stopBtn) {
         stopBtn.style.display = (uiMode === "SETUP") ? "none" : "block";
         stopBtn.textContent = (uiMode === "STOPPED") ? "Stopping..." : "End Session / 結束";
      }
    }
  });
}

export function updateTimers(uiMode, remainingSec) {
  requestAnimationFrame(() => {
    const topCountdown = $("y65TopCountdown");
    if (topCountdown) topCountdown.style.display = "none";
  });
}

export function updateStatusPill(uiMode, remainingSec, connected) {
  requestAnimationFrame(() => {
    const modeTextEl = $("y65UiModeText");
    if (modeTextEl) modeTextEl.textContent = getUIModeLabel(uiMode);
    const statusPill = $("y65StatusPill");
    const statusByMode = {
      SETUP: {
        color: "var(--monitor-color-info)",
        glow: "color-mix(in srgb, var(--monitor-color-info) 42%, transparent)"
      },
      RUNNING: {
        color: "var(--monitor-color-success)",
        glow: "color-mix(in srgb, var(--monitor-color-success) 48%, transparent)"
      },
      PAUSED: {
        color: "var(--monitor-color-warning)",
        glow: "color-mix(in srgb, var(--monitor-color-warning) 48%, transparent)"
      },
      STOPPED: {
        color: "#ef4444",
        glow: "rgba(239, 68, 68, 0.48)"
      }
    };
    const statusColor = statusByMode[uiMode] || statusByMode.SETUP;
    if (statusPill) {
      statusPill.dataset.uiMode = String(uiMode || "SETUP").toLowerCase();
      statusPill.style.borderColor = statusColor.glow;
    }
    const connDot = $("y65ConnDot");
    if (connDot) {
      connDot.style.background = statusColor.color;
      connDot.style.boxShadow = `0 0 10px ${statusColor.glow}`;
      connDot.setAttribute("aria-label", `Session status: ${uiMode || "SETUP"}`);
    }
  });
}

export function renderAll(state) {
  if (!state) return;
  const { uiMode, massage, session, connection } = state;
  updateStatusPill(uiMode, session?.remainingSec, connection?.connected);
  
  const toggle = $("quickStartModeToggle");
  const isQuickMode = toggle ? toggle.checked : false;
  
  updateQuickModeVisibility(isQuickMode, uiMode);
  renderVitalsOnly(state);
  updateTimers(uiMode, session?.remainingSec);
  updateMiniBar(uiMode, massage?.intensity, session?.remainingSec);
  renderStudentMassagePanel(massage, uiMode);
}

export function triggerClinicalReflection() {
  const popup = document.getElementById("nurseReminderPopup");
  if (!popup) return;
  
  const now = Date.now();
  if (now - _lastClinicalReflectionAt < 5000) return;
  _lastClinicalReflectionAt = now;
  
  // Show popup
  popup.classList.add("show");
  popup.setAttribute("aria-hidden", "false");

  const nursePromptAudio = document.getElementById("nursePromptAudio");
  if (nursePromptAudio) {
    nursePromptAudio.currentTime = 0;
    nursePromptAudio.play().catch(e => console.log("Audio play blocked by browser:", e));
  }
  
  // Auto-hide after 10 seconds
  setTimeout(() => {
    hideClinicalReflection();
  }, 10000);
}

function hideClinicalReflection() {
  const popup = document.getElementById("nurseReminderPopup");
  if (popup) {
    popup.classList.remove("show");
    popup.setAttribute("aria-hidden", "true");
  }
  const nursePromptAudio = document.getElementById("nursePromptAudio");
  if (nursePromptAudio) {
    nursePromptAudio.pause();
    nursePromptAudio.currentTime = 0;
  }
}

export const Year65UI = {
  MODE_LABELS, INTENSITY_LABELS, AVATAR_ASSET_BASE, AVATAR_FILES, EXPRESSION_PRESET_FILES,
  formatRemainTime, getUIModeLabel, pickAvatarFile, updateAvatarVisuals, bindAvatarAssetGuardsOnce,
  renderAll, renderVitalsOnly, resetVitalsAndExpressionBaseline, renderStudentMassagePanel, updateQuickModeVisibility, updateTimers, updateMiniBar, updateStatusPill, playStudentActionPrompt,
  triggerClinicalReflection, hideClinicalReflection
};

if (typeof window !== "undefined") {
  window.Year65UI = Year65UI;
  window.dispatchEvent(new CustomEvent("year65-ui-ready"));
  
  document.addEventListener("DOMContentLoaded", () => {
    // UPDATED STYLE INJECTION
    const style = document.createElement("style");
    style.innerHTML = `
      /* Shrink the graphs to make room for the 3rd cue */
      .y65-vital-trend { height: 90px !important; } 
      
      /* Make sure the vital cards don't have excessive bottom margin */
      .y65-vital { margin-bottom: 8px !important; }
      
      /* Let the cues box grow naturally without overlapping */
      .y65-cues { 
          margin-top: auto; 
          padding-top: 6px; 
          padding-bottom: 8px; 
          flex-shrink: 0; 
          overflow: visible !important; 
          max-height: none !important; /* Removes the clipping boundary */
      }
    `;
    document.head.appendChild(style);

    const toggle = document.getElementById("quickStartModeToggle");
    if (toggle) {
      toggle.addEventListener("change", () => renderAll(window.APP_STATE || { uiMode: "SETUP" }));
      renderAll(window.APP_STATE || { uiMode: "SETUP" });
    }

    const frontStart = document.getElementById("y65FrontStartBtn");
    const frontStop = document.getElementById("y65FrontStopBtn");

    if(frontStart) {
       frontStart.addEventListener("click", () => {
           if(window.app && typeof window.app.setMassageConfig === 'function') window.app.setMassageConfig(4, "mid", 5);
           const realStart = document.querySelector('.y65-start-btn:not(#y65FrontStartBtn)');
           if(realStart) realStart.click();
           else if(window.executeManualBtn) window.executeManualBtn.click();
       });
    }
    if(frontStop && !frontStop.dataset.stopBound) {
       frontStop.dataset.stopBound = "true";
       frontStop.addEventListener("click", () => {
           if(window.app && typeof window.app.stopSession === 'function') {
              void window.app.stopSession('manual');
           } else if(window.stopButton) {
              window.stopButton.click();
           }
       });
    }

    // Nurse Reminder Popup Event Listeners
    const nursePopup = document.getElementById("nurseReminderPopup");
    const nurseCloseBtn = document.getElementById("nurseReminderCloseBtn");

    function closeNursePopup() {
      if (nursePopup) {
        nursePopup.classList.remove("show");
        nursePopup.setAttribute("aria-hidden", "true");
      }
      const nursePromptAudio = document.getElementById("nursePromptAudio");
      if (nursePromptAudio) {
        nursePromptAudio.pause();
        nursePromptAudio.currentTime = 0;
      }
    }

    if (nurseCloseBtn) {
      nurseCloseBtn.addEventListener("click", closeNursePopup);
    }
  });
}

export default Year65UI;
