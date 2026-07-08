/**
 * Internationalization (i18n) Module
 * Language Support: Traditional Chinese (zh) and English (en)
 *
 * Usage:
 *   t('keyName') - Returns translated string for current language
 *   setLanguage('en') - Switch to English
 *   setLanguage('zh') - Switch to Chinese
 */

const translations = {
  zh: {
    // ========================================
    // APP TITLE & HEADERS
    // ========================================
    appTitle: '護理訓練用按摩聊天機器人',
    appSubtitle: 'AI 智能按摩機器人助手',
    headerTitle: '小腿按摩',
    headerMassageGuide: '已進入按摩模式。如果你想調整按摩設定，請講：『按摩設定』',
    settingsTitle: '設定',
    knowledgeTitle: '知識庫管理',

    // ========================================
    // LANGUAGE TOGGLE (NEW)
    // ========================================
    languageLabel: '語言',
    langChinese: '繁體中文',
    langEnglish: 'English',
    languageInfo: '選擇介面語言',

    // ========================================
    // SETTINGS PANEL - AI MODEL
    // ========================================
    aiModelLabel: 'AI 智慧模式',
    aiModelInfo: '揀選AI助手嘅智慧模型',
    modelGroupTogether: '🌍 Together AI',
    modelGroupAzure: '☁️ Azure OpenAI',
    modelTogetherDeepseek: '🧠 DeepSeek V3（推薦）',
    modelTogetherMixtral: '🎯 Mixtral 8x7B',
    modelTogetherQwen: '💫 Qwen 72B',
    modelAzureGPT: '🤖 Azure GPT (ChatGPT)',
    modelAzureGrok: '⚡ Grok-4 Fast（超低延遲）',
    apiStatusTitle: 'API 配置狀態:',

    // ========================================
    // SETTINGS PANEL - VOICE
    // ========================================
    voiceSelectLabel: '語音選擇',
    voiceSelectInfo: '揀選你鍾意嘅朗讀聲音',
    voiceGroupCantonese: '🔊 Edge TTS - 粵語 (Cantonese)',
    voiceGroupEnglish: '🔊 Edge TTS - English',
    voiceGroupAzureZh: '☁️ Azure TTS - 粵語 (雲端)',
    voiceGroupAzureEn: '☁️ Azure TTS - English',
    voiceGroupAzure: 'Azure TTS',

    voiceHiuGaai: '曉佳 (HiuGaai - 女聲)',
    voiceHiuMaan: '曉曼 (HiuMaan - 女聲)',
    voiceWanLung: '雲龍 (WanLung - 男聲)',
    voiceHiuGaaiDesc: '🎀 甜美女聲(曉佳姐姐) - 標準語速',
    voiceHiuMaanDesc: '🌸 溫柔女聲(曉曼姐姐) - 已調速',
    voiceWanLungDesc: '🎯 陽光男聲(雲龍哥哥) - 已調速',
    voiceAzureHiuGaai: '☁️ Azure 曉佳 (雲端女聲)',
    voiceAzureHiuMaan: '☁️ Azure 曉曼 (雲端女聲)',
    voiceAzureWanLung: '☁️ Azure 雲龍 (雲端男聲)',

    voiceJenny: 'Jenny (Female)',
    voiceAria: 'Aria (Female)',
    voiceGuy: 'Guy (Male)',
    voiceDavis: 'Davis (Male)',
    voiceJennyDesc: '💁 Jenny (Female) - Friendly',
    voiceAriaDesc: '🎭 Aria (Female) - Expressive',
    voiceGuyDesc: '👨 Guy (Male) - Professional',
    voiceDavisDesc: '🎙️ Davis (Male) - News',
    voiceAzureJenny: '☁️ Azure Jenny (Cloud)',
    voiceAzureAria: '☁️ Azure Aria (Cloud)',
    voiceAzureGuy: '☁️ Azure Guy (Cloud)',

    // ========================================
    // SETTINGS PANEL - SPEECH RATE
    // ========================================
    speechRateLabel: '語速調整',
    speechRateInfo: '調整語音朗讀速度 (50%-200%)',
    speechRateSlow: '慢',
    speechRateFast: '快',

    // ========================================
    // SETTINGS PANEL - RESPONSE LENGTH
    // ========================================
    responseLengthLabel: '回答長度',
    responseLengthInfo: '控制AI助手回答嘅詳細程度',
    responseBrief: '🌱 簡短明瞭',
    responseNormal: '🌿 適中詳細',
    responseDetailed: '🌳 完整詳盡',

    // ========================================
    // SETTINGS PANEL - ASR ENGINE
    // ========================================
    asrEngineLabel: '語音識別引擎',
    asrInfoBrowser: '使用瀏覽器內建語音識別',
    asrBrowser: '🌐 瀏覽器識別(免費)',
    asrXunfei: '🎯 訊飛識別(準確 - 未配置)',

    // ========================================
    // SETTINGS PANEL - SENTENCE DETECTION
    // ========================================
    sentenceDetectionLabel: '語句結束檢測',
    highConfidenceLabel: '高信心延遲 (ms)',
    silenceTimeoutLabel: '靜音超時 (ms)',

    // ========================================
    // SETTINGS PANEL - MICROPHONE
    // ========================================
    micCalibrationLabel: '麥克風靈敏度',
    calibrateMicBtn: '校準麥克風',
    calibrating: '校準中...',
    calibrationComplete: '校準完成',
    micCalibrationInfo: '點擊按鈕並在安靜環境中等待5秒',

    // ========================================
    // SETTINGS PANEL - ROBOT CONNECTION
    // ========================================
    robotConnectionLabel: 'UR10e 機械臂連接',
    robotIpPlaceholder: '輸入機械臂 IP 地址',
    connectRobotBtn: '連接機械臂',
    disconnectRobotBtn: '斷開連接',
    rtdeIoStatusLabel: 'RTDE IO',
    connecting: '連接中...',
    robotNotConnected: '⚪ 未連接',
    robotControlModeRemoteDesc: '使用 RTDEControlInterface 連線，自動載入/播放 URP',
    robotControlModeLocalDesc: 'Local 模式：只用 RTDE IO 寄存器 + ur10e_modes_local_mode.urs，需要在 URSim 本地手動 PLAY',
    robotControlModeInfo: 'Local 模式：後端自動連線，只透過寄存器控制',
    robotControlModeLabel: '控制模式',
    robotControlModeRemoteOption: 'Remote (RTDE Control)',
    robotControlModeLocalOption: 'Local (URScript Registers)',
    robotControlModeStatusIdle: '控制模式：-',
    robotControlModeStatusRemote: '控制模式：Remote',
    robotControlModeStatusLocal: '控制模式：Local',
    robotControlModeStatusMismatch: '控制模式不一致：前端 {ui} / 後端 {backend}',
    robotControlModeReconnectHint: '已切換控制模式，請先斷開再重新連接機械臂。',
    robotConnPrefix: 'Robot',
    robotMotionPrefix: 'State',
    robotStateMoving: '移動中',
    robotConnectedLabel: '已連接',
    robotDisconnectedLabel: '未連線',
    robotMotionRunning: '運行中',
    robotMotionPaused: '已暫停',
    robotMotionIdle: '空閒',
    robotMotionError: '錯誤',
    robotMotionDisconnected: '未連線',
    robotJogUpLabel: '⬆️ Z 上移',
    robotJogDownLabel: '⬇️ Z 下移',
    robotJogHint: '提示：按住移動，放開停止（必要時用右側 🛑 急停）',
    // Robot Dialog Section Titles
    robotStatusSection: '📊 狀態監控',
    robotJogSection: '🎮 Z 軸移動',
    robotCalibSection: '📍 標定設置',
    robotDialogHint: '💡 按住 Jog 按鈕移動，放開停止。標定：移動到按摩床對角後儲存 A/B 點。',
    // Calibration
    calibrationStatusLabel: '狀態:',
    calibSaveALabel: '📍 存 A',
    calibSaveBLabel: '📍 存 B',
    calibMoveALabel: '→ A',
    calibMoveBLabel: '→ B',
    calibMoveSafeLabel: '⬆️ 安全',
    calibRestoreLabel: '📂 還原',
    calibClearLabel: '🗑️ 清除',
    calibStatusNone: '未標定',
    calibStatusASet: '已存 A',
    calibStatusBSet: '已存 B',
    calibStatusValid: '✓ 有效',
    calibStatusInvalid: '✗ 無效',

    // ========================================
    // SETTINGS PANEL - TOGGLES
    // ========================================
    wakeWordLabel: '語音喚醒',
    wakeWordDesc: '啟用喚醒詞「你好」',
    wakeWordHint: '✅ 講「你好」開始對話',
    restartWakeWordBtn: '🔄 重啟語音檢測',

    // Voice Setup Banner
    voiceSetupListening: '正在聆聽...',
    voiceSetupMode: '請選擇模式 (向上推/波浪推/螺旋按/揉捏)',
    voiceSetupIntensity: '請選擇力度 (小/中/大)',
    voiceSetupDuration: '請選擇時間 (1分鐘/3分鐘/5分鐘)',
    voiceSetupConfirm: '請確認開始 (確認/取消)',
    // Simple mode voice setup
    voiceSetupSimple: '請一次講出模式、力度和時間 (例如：揉捏 中力度 3分鐘)',
    voiceSetupSimpleConfirm: '請確認開始 (確認/取消)',

    // Setup Mode Toggle (Simple/Advanced)
    setupModeSettingLabel: '按摩設定模式',
    simpleModeLabel: '簡單模式 (2步)',
    simpleModeDesc: '語音一次說明所有設定',
    advancedModeLabel: '進階模式 (4步)',
    advancedModeDesc: '逐步選擇模式、力度、時間',
    simpleVoiceHint: '語音一次說明：模式 + 力度 + 時間（未說明的項目將使用預設）',
    forceAssistLabel: '接觸柔順（Z 軸力控）',
    forceAssistLabelShort: 'Force Assist (Z-axis)',
    forceAssistDesc: 'URSim 請關閉；真機接觸小腿才開啟',

    torqueMonitorLabel: '力/扭矩監測',
    torqueMonitorDesc: '啟用實時監測',
    torqueMonitorInfo: '開啟後按摩時顯示力與扭矩數據',

    // ========================================
    // MODE SWITCHER
    // ========================================
    modeMassageTitle: '💆 按摩模式',

    // ========================================
    // MASSAGE CONTROLS - MODES
    // ========================================
    massageModeLabel: '按摩模式',
    modeUpward: '向上推',
    modeWave: '波浪推',
    modeSpiral: '螺旋按',
    modeKnead: '揉捏',

    // ========================================
    // MASSAGE CONTROLS - INTENSITY
    // ========================================
    intensityLabel: '力度',
    intensitySmall: '小',
    intensityMedium: '中',
    intensityLarge: '大',

    // ========================================
    // MASSAGE CONTROLS - DURATION
    // ========================================
    durationLabel: '時長',
    duration1min: '1分鐘',
    duration3min: '3分鐘',
    duration5min: '5分鐘',

    // ========================================
    // BUTTONS
    // ========================================
    startMassageBtn: '開始按摩',
    stopMassageBtn: '停止按摩',
    robotStopBtn: '🛑 停止機械臂',
    pauseMassageBtn: '暫停',
    resumeMassageBtn: '繼續',
    closeBtn: '關閉',
    saveBtn: '儲存',
    cancelBtn: '取消',
    confirmBtn: '確認',
    addBtn: '新增',
    editBtn: '編輯',
    deleteBtn: '刪除',

    // ========================================
    // PATIENT FEELINGS
    // ========================================
    patientFeelingLabel: '您的感受',
    feelingComfortable: '舒適',
    feelingSlightPain: '少痛',
    feelingMediumPain: '中痛',
    feelingSeverePain: '很痛',

    // ========================================
    // STATUS MESSAGES
    // ========================================
    statusConnecting: '正在連接...',
    statusConnected: '已連接',
    statusDisconnected: '已斷開',
    robotStatusDisconnected: '未連線',
    countdownLabel: '剩餘時間',
    statusListening: '正在聆聽...',
    statusProcessing: '處理中...',
    statusSpeaking: '播放中...',
    statusReady: '準備就緒',
    statusIdle: '待機',
    statusMassaging: '按摩中',
    statusError: '錯誤',

    // ========================================
    // AUTO SPEAK & MASSAGE MESSAGES
    // ========================================
    autoSpeakLabel: '自動朗讀',
    massageComplete: '按摩完成',
    ttsMassageStopped: '已停止按摩',
    massageStoppedResponse: '收到！已停止按摩。',

    // ========================================
    // ERROR MESSAGES
    // ========================================
    errorNoMicrophone: '無法存取麥克風',
    errorNetworkFailed: '網路連接失敗',
    errorTTSFailed: '語音合成失敗',
    errorASRFailed: '語音識別失敗',
    errorRobotConnection: '機械臂連接失敗',
    errorInvalidInput: '輸入無效',
    errorTimeout: '操作超時',
    errorUnknown: '未知錯誤',

    // ========================================
    // PLACEHOLDERS
    // ========================================
    chatInputPlaceholder: '輸入訊息...',
    searchPlaceholder: '搜尋...',
    questionPlaceholder: '輸入問題',
    answerPlaceholder: '輸入答案',

    // ========================================
    // KNOWLEDGE PANEL
    // ========================================
    knowledgeAddBtn: '新增問答',
    knowledgeQuestion: '問題',
    knowledgeAnswer: '答案',
    knowledgeCount: '共 {count} 條',
    knowledgeEmpty: '尚無知識條目',
    knowledgeDeleteConfirm: '確定要刪除此條目嗎？',
    kbTotalLabel: '總問答對',
    kbEnabledLabel: '已啟用',
    kbHitRateLabel: '緩存命中率',
    kbAddNewTitle: '添加新問答對',
    kbCategoryLabel: '分類:',
    kbCategoryPlaceholder: '例如:學校資訊',
    kbQuestionLabel: '問題(可添加多個相似問法):',
    kbQuestionPlaceholder: '輸入問題',
    kbAddMoreBtn: '+ 添加更多問法',
    kbAnswerLabel: '答案:',
    kbAnswerPlaceholder: '輸入答案',
    kbSaveBtn: '保存問答對',
    kbExistingTitle: '現有問答對',

    // ========================================
    // ROBOT DETAILS DIALOG
    // ========================================
    robotDetailsTitle: '🤖 機械臂詳細資訊',
    openRobotDetailsBtn: '📊 機械臂詳細資訊',

    // ========================================
    // TORQUE MONITOR
    // ========================================
    torqueDialogTitle: '📊 力/扭矩即時監測',
    torqueForce: '力道',
    torqueTorque: '扭矩',
    torqueTimestamp: '時間戳',
    torqueForceLabel: '力 (N):',
    torqueTorqueLabel: '扭矩 (Nm):',
    torqueMaxInfo: '最大力: 60 N | 最大扭矩: 15 Nm',

    // ========================================
    // CHAT MESSAGES
    // ========================================
    you: '你',
    assistant: '助手',
    system: '系統',
    patient: '病人',

    // ========================================
    // CONFIRMATIONS
    // ========================================
    confirmClearChat: '確定要清空對話記錄嗎？',
    confirmStopMassage: '確定要停止按摩嗎？',
    confirmDisconnect: '確定要斷開機械臂連接嗎？',

    // ========================================
    // SUCCESS MESSAGES
    // ========================================
    successSaved: '已儲存',
    successConnected: '連接成功',
    successDisconnected: '已斷開連接',
    successDeleted: '已刪除',
    successAdded: '已新增',

    // ========================================
    // TOOLTIPS
    // ========================================
    tooltipSettings: '開啟設定',
    tooltipKnowledge: '知識庫管理',
    tooltipMicrophone: '按住說話',
    tooltipSend: '發送訊息',
    tooltipClear: '清空對話',

  },

  en: {
    // ========================================
    // APP TITLE & HEADERS
    // ========================================
    appTitle: 'Massage Chatbot for Nursing Training',
    appSubtitle: 'AI-Powered Massage Robot Assistant',
    headerTitle: 'Calf Massage',
    headerMassageGuide: 'Massage mode active. To adjust settings, say: "Massage settings"',
    settingsTitle: 'Settings',
    knowledgeTitle: 'Knowledge Base Management',

    // ========================================
    // LANGUAGE TOGGLE (NEW)
    // ========================================
    languageLabel: 'Language',
    langChinese: '繁體中文',
    langEnglish: 'English',
    languageInfo: 'Select interface language',

    // ========================================
    // SETTINGS PANEL - AI MODEL
    // ========================================
    aiModelLabel: 'AI Model',
    aiModelInfo: 'Select AI assistant model',
    modelGroupTogether: '🌍 Together AI',
    modelGroupAzure: '☁️ Azure OpenAI',
    modelTogetherDeepseek: '🧠 DeepSeek V3 (Recommended)',
    modelTogetherMixtral: '🎯 Mixtral 8x7B',
    modelTogetherQwen: '💫 Qwen 72B',
    modelAzureGPT: '🤖 Azure GPT (ChatGPT)',
    modelAzureGrok: '⚡ Grok-4 Fast (Ultra-low Latency)',
    apiStatusTitle: 'API Configuration Status:',

    // ========================================
    // SETTINGS PANEL - VOICE
    // ========================================
    voiceSelectLabel: 'Voice Selection',
    voiceSelectInfo: 'Select your preferred text-to-speech voice',
    voiceGroupCantonese: '🔊 Edge TTS - Cantonese',
    voiceGroupEnglish: '🔊 Edge TTS - English',
    voiceGroupAzureZh: '☁️ Azure TTS - Cantonese (Cloud)',
    voiceGroupAzureEn: '☁️ Azure TTS - English (Cloud)',
    voiceGroupAzure: 'Azure TTS',

    voiceHiuGaai: 'HiuGaai (Female)',
    voiceHiuMaan: 'HiuMaan (Female)',
    voiceWanLung: 'WanLung (Male)',
    voiceHiuGaaiDesc: '🎀 Sweet Voice (HiuGaai) - Standard Speed',
    voiceHiuMaanDesc: '🌸 Gentle Voice (HiuMaan) - Adjusted Speed',
    voiceWanLungDesc: '🎯 Bright Voice (WanLung) - Adjusted Speed',
    voiceAzureHiuGaai: '☁️ Azure HiuGaai (Cloud Female)',
    voiceAzureHiuMaan: '☁️ Azure HiuMaan (Cloud Female)',
    voiceAzureWanLung: '☁️ Azure WanLung (Cloud Male)',

    voiceJenny: 'Jenny (Female)',
    voiceAria: 'Aria (Female)',
    voiceGuy: 'Guy (Male)',
    voiceDavis: 'Davis (Male)',
    voiceJennyDesc: '💁 Jenny (Female) - Friendly',
    voiceAriaDesc: '🎭 Aria (Female) - Expressive',
    voiceGuyDesc: '👨 Guy (Male) - Professional',
    voiceDavisDesc: '🎙️ Davis (Male) - News',
    voiceAzureJenny: '☁️ Azure Jenny (Cloud)',
    voiceAzureAria: '☁️ Azure Aria (Cloud)',
    voiceAzureGuy: '☁️ Azure Guy (Cloud)',

    // ========================================
    // SETTINGS PANEL - SPEECH RATE
    // ========================================
    speechRateLabel: 'Speech Rate',
    speechRateInfo: 'Adjust voice reading speed (50%-200%)',
    speechRateSlow: 'Slow',
    speechRateFast: 'Fast',

    // ========================================
    // SETTINGS PANEL - RESPONSE LENGTH
    // ========================================
    responseLengthLabel: 'Response Length',
    responseLengthInfo: 'Control AI assistant response detail level',
    responseBrief: '🌱 Brief',
    responseNormal: '🌿 Normal',
    responseDetailed: '🌳 Detailed',

    // ========================================
    // SETTINGS PANEL - ASR ENGINE
    // ========================================
    asrEngineLabel: 'Speech Recognition',
    asrInfoBrowser: 'Using browser built-in speech recognition',
    asrBrowser: '🌐 Browser Recognition (Free)',
    asrXunfei: '🎯 iFlytek Recognition (Accurate - Not Configured)',

    // ========================================
    // SETTINGS PANEL - SENTENCE DETECTION
    // ========================================
    sentenceDetectionLabel: 'Sentence End Detection',
    highConfidenceLabel: 'High Confidence Timeout (ms)',
    silenceTimeoutLabel: 'Silence Timeout (ms)',

    // ========================================
    // SETTINGS PANEL - MICROPHONE
    // ========================================
    micCalibrationLabel: 'Microphone Sensitivity',
    calibrateMicBtn: 'Calibrate Microphone',
    calibrating: 'Calibrating...',
    calibrationComplete: 'Calibration Complete',
    micCalibrationInfo: 'Click button and wait 5 seconds in a quiet environment',

    // ========================================
    // SETTINGS PANEL - ROBOT CONNECTION
    // ========================================
    robotConnectionLabel: 'UR10e Robot Connection',
    robotIpPlaceholder: 'Enter Robot IP Address',
    connectRobotBtn: 'Connect Robot',
    disconnectRobotBtn: 'Disconnect',
    rtdeIoStatusLabel: 'RTDE IO',
    connecting: 'Connecting...',
    robotNotConnected: '⚪ Not Connected',
    robotControlModeRemoteDesc: 'Uses RTDEControlInterface and dashboard load/play.',
    robotControlModeLocalDesc: 'Local mode: RTDE IO registers + ur10e_modes_local_mode.urs. Keep the PolyScope program PLAYING.',
    robotControlModeInfo: 'Local mode: backend auto-connects and only uses register control.',
    robotControlModeLabel: 'Control Mode',
    robotControlModeRemoteOption: 'Remote (RTDE Control)',
    robotControlModeLocalOption: 'Local (URScript Registers)',
    robotControlModeStatusIdle: 'Control mode: -',
    robotControlModeStatusRemote: 'Control mode: Remote',
    robotControlModeStatusLocal: 'Control mode: Local',
    robotControlModeStatusMismatch: 'Control mode mismatch: UI {ui} / Backend {backend}',
    robotControlModeReconnectHint: 'Control mode changed. Disconnect and reconnect the robot to apply it.',
    robotConnPrefix: 'Robot',
    robotMotionPrefix: 'State',
    robotStateMoving: 'Moving',
    robotConnectedLabel: 'Connected',
    robotDisconnectedLabel: 'Disconnected',
    robotMotionRunning: 'Running',
    robotMotionPaused: 'Paused',
    robotMotionIdle: 'Idle',
    robotMotionError: 'Error',
    robotMotionDisconnected: 'Disconnected',
    robotJogUpLabel: '⬆️ Z Up',
    robotJogDownLabel: '⬇️ Z Down',
    robotJogHint: 'Tip: Hold to move, release to stop (use 🛑 emergency stop if needed)',
    // Robot Dialog Section Titles
    robotStatusSection: '📊 Status Monitor',
    robotJogSection: '🎮 Z-Axis Jog',
    robotCalibSection: '📍 Calibration',
    robotDialogHint: '💡 Hold Jog buttons to move, release to stop. Calibration: Move to table corners and save A/B.',
    // Calibration
    calibrationStatusLabel: 'Status:',
    calibSaveALabel: '📍 Save A',
    calibSaveBLabel: '📍 Save B',
    calibMoveALabel: '→ A',
    calibMoveBLabel: '→ B',
    calibMoveSafeLabel: '⬆️ Safe',
    calibRestoreLabel: '📂 Restore',
    calibClearLabel: '🗑️ Clear',
    calibStatusNone: 'Not Set',
    calibStatusASet: 'A Saved',
    calibStatusBSet: 'B Saved',
    calibStatusValid: '✓ Valid',
    calibStatusInvalid: '✗ Invalid',

    // ========================================
    // SETTINGS PANEL - TOGGLES
    // ========================================
    wakeWordLabel: 'Wake Word',
    wakeWordDesc: 'Enable "hello" wake word',
    wakeWordHint: '✅ Say "hello" to start a conversation',
    restartWakeWordBtn: '🔄 Restart Voice Detection',

    // Voice Setup Banner
    voiceSetupListening: 'Listening...',
    voiceSetupMode: 'Select mode (Upward/Wave/Spiral/Knead)',
    voiceSetupIntensity: 'Select intensity (Low/Medium/High)',
    voiceSetupDuration: 'Select duration (1min/3min/5min)',
    voiceSetupConfirm: 'Confirm to start (Confirm/Cancel)',
    // Simple mode voice setup
    voiceSetupSimple: 'Say mode, intensity, and duration at once (e.g., Knead medium 3 minutes)',
    voiceSetupSimpleConfirm: 'Confirm to start (Confirm/Cancel)',

    // Setup Mode Toggle (Simple/Advanced)
    setupModeSettingLabel: 'Massage Setup Mode',
    simpleModeLabel: 'Simple Mode (2 steps)',
    simpleModeDesc: 'Voice all settings at once',
    advancedModeLabel: 'Advanced Mode (4 steps)',
    advancedModeDesc: 'Step-by-step selection',
    simpleVoiceHint: 'Voice: mode + intensity + duration (missing items use defaults)',
    forceAssistLabel: 'Force Assist (Z-axis)',
    forceAssistLabelShort: 'Force Assist (Z-axis)',
    forceAssistDesc: 'Turn OFF in URSim. Turn ON on real robot for calf contact.',

    torqueMonitorLabel: 'Force/Torque Monitor',
    torqueMonitorDesc: 'Enable real-time monitoring',
    torqueMonitorInfo: 'Display force and torque data during massage',

    // ========================================
    // MODE SWITCHER
    // ========================================
    modeMassageTitle: '💆 Massage Mode',

    // ========================================
    // MASSAGE CONTROLS - MODES
    // ========================================
    massageModeLabel: 'Massage Mode',
    modeUpward: 'Upward Push',
    modeWave: 'Wave Push',
    modeSpiral: 'Spiral Press',
    modeKnead: 'Knead',

    // ========================================
    // MASSAGE CONTROLS - INTENSITY
    // ========================================
    intensityLabel: 'Intensity',
    intensitySmall: 'Light',
    intensityMedium: 'Medium',
    intensityLarge: 'Strong',

    // ========================================
    // MASSAGE CONTROLS - DURATION
    // ========================================
    durationLabel: 'Duration',
    duration1min: '1 Minute',
    duration3min: '3 Minutes',
    duration5min: '5 Minutes',

    // ========================================
    // BUTTONS
    // ========================================
    startMassageBtn: 'Start Massage',
    stopMassageBtn: 'Stop Massage',
    robotStopBtn: '🛑 Stop Robot',
    pauseMassageBtn: 'Pause',
    resumeMassageBtn: 'Resume',
    closeBtn: 'Close',
    saveBtn: 'Save',
    cancelBtn: 'Cancel',
    confirmBtn: 'Confirm',
    addBtn: 'Add',
    editBtn: 'Edit',
    deleteBtn: 'Delete',

    // ========================================
    // PATIENT FEELINGS
    // ========================================
    patientFeelingLabel: 'Your Feeling',
    feelingComfortable: 'Comfortable',
    feelingSlightPain: 'Slight Pain',
    feelingMediumPain: 'Medium Pain',
    feelingSeverePain: 'Severe Pain',

    // ========================================
    // STATUS MESSAGES
    // ========================================
    robotStatusDisconnected: 'Disconnected',
    countdownLabel: 'Remaining Time',
    statusConnecting: 'Connecting...',
    statusConnected: 'Connected',
    statusDisconnected: 'Disconnected',
    statusListening: 'Listening...',
    statusProcessing: 'Processing...',
    statusSpeaking: 'Speaking...',
    statusReady: 'Ready',
    statusIdle: 'Idle',
    statusMassaging: 'Massaging',
    statusError: 'Error',

    // ========================================
    // AUTO SPEAK & MASSAGE MESSAGES
    // ========================================
    autoSpeakLabel: 'Auto Speak',
    massageComplete: 'Massage Complete',
    ttsMassageStopped: 'Massage stopped',
    massageStoppedResponse: 'Got it! Massage stopped.',

    // ========================================
    // ERROR MESSAGES
    // ========================================
    errorNoMicrophone: 'Cannot access microphone',
    errorNetworkFailed: 'Network connection failed',
    errorTTSFailed: 'Text-to-speech failed',
    errorASRFailed: 'Speech recognition failed',
    errorRobotConnection: 'Robot connection failed',
    errorInvalidInput: 'Invalid input',
    errorTimeout: 'Operation timed out',
    errorUnknown: 'Unknown error',

    // ========================================
    // PLACEHOLDERS
    // ========================================
    chatInputPlaceholder: 'Type a message...',
    searchPlaceholder: 'Search...',
    questionPlaceholder: 'Enter question',
    answerPlaceholder: 'Enter answer',

    // ========================================
    // KNOWLEDGE PANEL
    // ========================================
    knowledgeAddBtn: 'Add Q&A',
    knowledgeQuestion: 'Question',
    knowledgeAnswer: 'Answer',
    knowledgeCount: 'Total: {count}',
    knowledgeEmpty: 'No knowledge entries yet',
    knowledgeDeleteConfirm: 'Are you sure you want to delete this entry?',
    kbTotalLabel: 'Total Q&A Pairs',
    kbEnabledLabel: 'Enabled',
    kbHitRateLabel: 'Cache Hit Rate',
    kbAddNewTitle: 'Add New Q&A Pair',
    kbCategoryLabel: 'Category:',
    kbCategoryPlaceholder: 'e.g. School Info',
    kbQuestionLabel: 'Question (add multiple similar phrasings):',
    kbQuestionPlaceholder: 'Enter question',
    kbAddMoreBtn: '+ Add More Phrasings',
    kbAnswerLabel: 'Answer:',
    kbAnswerPlaceholder: 'Enter answer',
    kbSaveBtn: 'Save Q&A Pair',
    kbExistingTitle: 'Existing Q&A Pairs',

    // ========================================
    // ROBOT DETAILS DIALOG
    // ========================================
    robotDetailsTitle: '🤖 Robot Arm Details',
    openRobotDetailsBtn: '📊 Robot Arm Details',

    // ========================================
    // TORQUE MONITOR
    // ========================================
    torqueDialogTitle: '📊 Real-time Force/Torque Monitor',
    torqueForce: 'Force',
    torqueTorque: 'Torque',
    torqueTimestamp: 'Timestamp',
    torqueForceLabel: 'Force (N):',
    torqueTorqueLabel: 'Torque (Nm):',
    torqueMaxInfo: 'Max Force: 60 N | Max Torque: 15 Nm',

    // ========================================
    // CHAT MESSAGES
    // ========================================
    you: 'You',
    assistant: 'Assistant',
    system: 'System',
    patient: 'Patient',

    // ========================================
    // CONFIRMATIONS
    // ========================================
    confirmClearChat: 'Are you sure you want to clear the chat history?',
    confirmStopMassage: 'Are you sure you want to stop the massage?',
    confirmDisconnect: 'Are you sure you want to disconnect the robot?',

    // ========================================
    // SUCCESS MESSAGES
    // ========================================
    successSaved: 'Saved',
    successConnected: 'Connected successfully',
    successDisconnected: 'Disconnected',
    successDeleted: 'Deleted',
    successAdded: 'Added',

    // ========================================
    // TOOLTIPS
    // ========================================
    tooltipSettings: 'Open Settings',
    tooltipKnowledge: 'Knowledge Base Management',
    tooltipMicrophone: 'Hold to speak',
    tooltipSend: 'Send message',
    tooltipClear: 'Clear chat',
  }
};

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Get translated string for current language
 * @param {string} key - Translation key
 * @param {Object} params - Optional parameters for template replacement
 * @param {string} langOverride - Optional language override
 * @returns {string} Translated string
 */
function t(key, params = {}, langOverride = null) {
  const lang = langOverride || localStorage.getItem('language') || 'zh';
  let text = translations[lang]?.[key] || translations['zh'][key] || key;

  // Replace template variables like {count}
  Object.keys(params).forEach(param => {
    text = text.replace(`{${param}}`, params[param]);
  });

  return text;
}

/**
 * Set application language
 * @param {string} lang - Language code ('zh' or 'en')
 */
function setLanguage(lang) {
  if (!translations[lang]) {
    console.error(`Language '${lang}' not supported`);
    return;
  }
  localStorage.setItem('language', lang);
  document.documentElement.lang = lang;
}

/**
 * Get current language
 * @returns {string} Current language code
 */
function getCurrentLanguage() {
  return localStorage.getItem('language') || 'zh';
}

// Export for use in other modules if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { t, setLanguage, getCurrentLanguage, translations };
}

// Also expose globally for browser use
if (typeof window !== 'undefined') {
  window.t = t;
  window.setLanguage = setLanguage;
  window.getCurrentLanguage = getCurrentLanguage;
  window.translations = translations;
}
