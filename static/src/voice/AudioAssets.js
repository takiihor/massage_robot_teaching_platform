/*
 * Module: AudioAssets
 * Purpose: Audio asset URL helpers and asset library singleton.
 * Exports: _getApiBaseUrl, _buildUrl, _fileUrl, _BEEP_WAV_DATA_URL, AudioAssetLibrary
 * Module bridge globals: window.AudioAssetLibrary (via module-bridge)
 */

export function _getApiBaseUrl() {
    try {
        const apiUrl = window.API_URL || window.__API_URL;
        if (apiUrl) return apiUrl;
        const cfg = window.SERVER_CONFIG || null;
        if (cfg?.api_url) return cfg.api_url;
        if (cfg?.protocol && cfg?.host && cfg?.port) return `${cfg.protocol}://${cfg.host}:${cfg.port}`;
    } catch (e) { /* ignore */ }
    return '';
}

export function _buildUrl(pathname) {
    const base = _getApiBaseUrl();
    return base ? `${base}${pathname}` : pathname;
}

export function _fileUrl(dir, filename) {
    return _buildUrl(`/${dir}/${encodeURIComponent(filename)}`);
}

export function _normalizeAudioLanguage(lang) {
    const value = String(lang || '').trim().toLowerCase();
    return value.startsWith('en') ? 'en' : 'zh';
}

export function _getCurrentAudioLanguage(preferred = null) {
    if (preferred) return _normalizeAudioLanguage(preferred);

    try {
        const storedVoice = globalThis.localStorage?.getItem?.('voiceLanguage');
        if (storedVoice) return _normalizeAudioLanguage(storedVoice);
    } catch (e) { /* ignore */ }

    try {
        const voiceSelect = globalThis.document?.getElementById?.('voiceLanguageSelect');
        if (voiceSelect?.value) return _normalizeAudioLanguage(voiceSelect.value);
    } catch (e) { /* ignore */ }

    try {
        const storedLanguage = globalThis.localStorage?.getItem?.('language');
        if (storedLanguage) return _normalizeAudioLanguage(storedLanguage);
    } catch (e) { /* ignore */ }

    try {
        const languageSelect = globalThis.document?.getElementById?.('languageSelect');
        if (languageSelect?.value) return _normalizeAudioLanguage(languageSelect.value);
    } catch (e) { /* ignore */ }

    try {
        if (typeof getCurrentLanguage === 'function') return _normalizeAudioLanguage(getCurrentLanguage());
    } catch (e) { /* ignore */ }

    return 'zh';
}

// 200ms tone placeholder (WAV/PCM, base64) for IDs without recorded assets yet
export const _BEEP_WAV_DATA_URL = 'data:audio/wav;base64,UklGRiQZAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAZAAAAAI8Grgz1EQgWoxiYGdgYbhaFEmANVQfNADn6BvSg7mPqmOdu5vrmMenv7PPx8bLx4O7h2dzc2dDY0dTPzdDKy8O6vsG4r7aruK+3r7u0sLixsbKysbCvsq+0rr+1sLKwsbCysLaxs7OztbO2tLaztrq7uL+7v7y+v7+9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL+7u7a0sbCwsrGytbO3t7m8v8G9v8C9vby+vL8='; // placeholder only

export class AudioAssetLibrary {
    constructor() {
        // Core cache and loading management
        this.cache = new Map();
        this.loadingPromises = new Map();
        this.preloadQueue = [];
        this.isPreloading = false;

        // Enhanced cache configuration
        this.maxCacheSize = 50;
        this.maxCacheMemoryMB = 20; // Maximum memory usage in MB
        this.preloadBatchSize = 3; // Reduced batch size for better responsiveness
        this.preloadDelayMs = 50; // Delay between batches
        this.preloadRetryAttempts = 3;
        this.preloadRetryDelayMs = 1000;

        // Performance monitoring
        this.stats = {
            cacheHits: 0,
            cacheMisses: 0,
            loadErrors: 0,
            totalLoadTime: 0,
            averageLoadTime: 0,
            memoryUsageMB: 0,
            evictions: 0,
            preloadProgress: 0
        };

        // Language and directory mappings
        this.languageMappings = {
            'zh': {
                systemDir: 'assets/audio/system_female',
                patientDir: 'assets/audio/patient_male'
            },
            'en': {
                systemDir: 'assets/audio/system_female_english',
                patientDir: 'assets/audio/patient_male_english'
            }
        };

        // File mappings for each language
        this.fileMappings = {
            'zh': {
                system: {
                    'system.choose_mode': '請選擇模式.mp3',
                    'system.choose_force': '請選擇力度.mp3',
                    'system.choose_duration': '請選擇時間.mp3',
                    'system.confirm_summary': '請確認開始.mp3',
                    'system.enter_running': '按摩現在開始.mp3',
                    'system.enter_setup': '已進入按摩設定.mp3',
                    'system.paused': '已經暫停.mp3',
                    'system.cancelled': '已取消設定.mp3',
                    'system.massage_completed_rest': '按摩已經完成 記得休息多D.mp3',
                    'system.massage_mode_guide': '已進入按摩模式 如果你想調整按摩設定 請.m4a',
                    'system.resumed': '恢復.mp3',
                    'system.stopped': '停止.mp3',
                    'system.emergency_stop': '緊急停止.mp3',
                    'system.generic_ack': '收到你.mp3',
                    'system.eng_mode_activated': '收到,工程模式已開啟.mp3',
                    'system.eng_mode_deactivated': '工程模式已關閉.mp3',
                    'system.draw_circle': '收到,依家開始畫一個圓形.mp3',
                    'system.draw_square': '收到,依家開始畫一個正方形.mp3',
                    'system.draw_triangle': '收到,依家開始畫一個三角形.mp3',
                    // Simple mode audio
                    'system.choose_mode_force_duration_simple': '請一次講出模式、力度和時間（未說明的項目會使用預設）.mp3',
                    // Stitched confirmation clips for simple mode
                    'system.simple_prefix': '已選擇.mp3',
                    'system.mode_push_up': '向上推.mp3',
                    'system.mode_wave_push': '波浪推.mp3',
                    'system.mode_spiral_press': '螺旋按.mp3',
                    'system.mode_knead': '揉捏.mp3',
                    'system.force_light': '力度小.mp3',
                    'system.force_medium': '力度中.mp3',
                    'system.force_strong': '力度大.mp3',
                    'system.duration_1min': '1分鐘.mp3',
                    'system.duration_3min': '3分鐘.mp3',
                    'system.duration_5min': '5分鐘.mp3',
                },
                patient: {
                    'patient.comfy_01': 'comfy_01_呢個力度好舒服.mp3',
                    'patient.comfy_02': 'comfy_02_啱啱好.mp3',
                    'patient.comfy_03': 'comfy_03_我覺得好放鬆.mp3',
                    'patient.comfy_04': 'comfy_04_可以照而家咁樣.mp3',
                    'patient.slight_discomfort_01': 'slight_dis_01_有少少頂住_輕啲會好啲.mp3',
                    'patient.slight_discomfort_02': 'slight_dis_02_呢個位有少少緊.mp3',
                    'patient.slight_discomfort_03': 'slight_dis_03_有少少刺刺地_但仲可以接受.mp3',
                    'patient.slight_discomfort_04': 'slight_dis_04_減少少力度就得.mp3',
                    'patient.pain_01': 'pain_01_呢一下有啲痛.mp3',
                    'patient.pain_02': 'pain_02_痛感集中喺呢個位置.mp3',
                    'patient.pain_03': 'pain_03_有刺痛感.mp3',
                    'patient.pain_04': 'pain_04_輕啲同慢啲會好啲.mp3',
                    'patient.severe_pain_01': 'severe_pain_01_呢個位置非常痛.mp3',
                    'patient.severe_pain_02': 'severe_pain_02_痛感好強.mp3',
                    'patient.severe_pain_03': 'severe_pain_03_我受唔到呢個力度.mp3',
                    'patient.severe_pain_04': 'severe_pain_04_呢度感覺好唔對路.mp3',
                }
            },
            'en': {
                system: {
                    'system.choose_mode': 'Please select mode.mp3',
                    'system.choose_force': 'Please select intensity.mp3',
                    'system.choose_duration': 'Please select duration.mp3',
                    'system.confirm_summary': 'Please confirm to start.mp3',
                    'system.enter_running': 'Massage starting now.mp3',
                    'system.enter_setup': 'Entered massage settings.mp3',
                    'system.paused': 'Paused.mp3',
                    'system.cancelled': 'Settings cancelled.mp3',
                    'system.massage_completed_rest': 'Massage completed.mp3',
                    'system.massage_mode_guide': 'Massage mode activated.mp3',
                    'system.resumed': 'Resume.mp3',
                    'system.stopped': 'Stop.mp3',
                    'system.emergency_stop': 'Emergency stop.mp3',
                    'system.generic_ack': 'Got it.mp3',
                    'system.eng_mode_activated': 'Received. Engineering mode has been activated..mp3',
                    'system.eng_mode_deactivated': 'Engineering mode has been deactivated..mp3',
                    'system.draw_circle': 'Received. Starting to draw a circle now..mp3',
                    'system.draw_square': 'Received. Starting to draw a square now..mp3',
                    'system.draw_triangle': 'Received. Starting to draw a triangle now..mp3',
                    // Simple mode audio
                    'system.choose_mode_force_duration_simple': 'Please say the mode, intensity, and duration in one sentence. Missing items will use defaults..mp3',
                    // Stitched confirmation clips for simple mode
                    'system.simple_prefix': 'Selected.mp3',
                    'system.mode_push_up': 'Push up.mp3',
                    'system.mode_wave_push': 'Wave push.mp3',
                    'system.mode_spiral_press': 'Spiral press.mp3',
                    'system.mode_knead': 'Knead.mp3',
                    'system.force_light': 'Light intensity.mp3',
                    'system.force_medium': 'Medium intensity.mp3',
                    'system.force_strong': 'Strong intensity.mp3',
                    'system.duration_1min': '1 minute.mp3',
                    'system.duration_3min': '3 minutes.mp3',
                    'system.duration_5min': '5 minutes.mp3',
                },
                patient: {
                    'patient.comfy_01': 'comfy_01_This_intensity_feels_comfortable.mp3',
                    'patient.comfy_02': 'comfy_02_It_feels_just_right.mp3',
                    'patient.comfy_03': 'comfy_03_I_feel_very_relaxed.mp3',
                    'patient.comfy_04': 'comfy_04_You_can_keep_it_like_this.mp3',
                    'patient.slight_discomfort_01': 'slight_dis_01_It_feels_a_bit_pressing_Lighter_would_be.mp3',
                    'patient.slight_discomfort_02': 'slight_dis_02_This_spot_feels_a_little_tight.mp3',
                    'patient.slight_discomfort_03': 'slight_dis_03_It_s_slightly_prickly_but_still_acceptab.mp3',
                    'patient.slight_discomfort_04': 'slight_dis_04_A_small_reduction_would_be_good.mp3',
                    'patient.pain_01': 'pain_01_This_feels_painful.mp3',
                    'patient.pain_02': 'pain_02_The_pain_is_focused_in_this_area.mp3',
                    'patient.pain_03': 'pain_03_I_feel_a_sharp_pain.mp3',
                    'patient.pain_04': 'pain_04_Lighter_and_slower_would_feel_better.mp3',
                    'patient.severe_pain_01': 'severe_pain_01_This_area_is_extremely_painful.mp3',
                    'patient.severe_pain_02': 'severe_pain_02_The_pain_is_very_strong.mp3',
                    'patient.severe_pain_03': 'severe_pain_03_I_can_t_tolerate_this_intensity.mp3',
                    'patient.severe_pain_04': 'severe_pain_04_Something_feels_very_wrong_here.mp3',
                }
            }
        };

        // Enhanced priority levels for preloading with scores
        this.assetPriorities = {
            'critical': [
                { assetId: 'system.choose_mode', score: 100 },
                { assetId: 'system.confirm_summary', score: 95 },
                { assetId: 'system.enter_running', score: 90 }
            ],
            'high': [
                { assetId: 'system.choose_force', score: 85 },
                { assetId: 'system.choose_duration', score: 80 },
                { assetId: 'system.paused', score: 75 },
                { assetId: 'system.resumed', score: 70 },
                { assetId: 'patient.comfy_01', score: 65 },
                { assetId: 'patient.pain_01', score: 60 }
            ],
            'medium': [
                { assetId: 'system.stopped', score: 55 },
                { assetId: 'system.emergency_stop', score: 50 },
                { assetId: 'patient.slight_discomfort_01', score: 45 },
                { assetId: 'patient.pain_02', score: 40 }
            ],
            'low': [
                { assetId: 'patient.severe_pain_01', score: 35 },
                { assetId: 'patient.severe_pain_02', score: 30 }
            ]
        };

        // LRU tracking for intelligent eviction
        this.accessOrder = new Map(); // Tracks last access time

        // Memory usage tracking
        this.totalMemoryUsage = 0;

        this.initialize();
    }

    initialize() {
        if (window.DEBUG_LOGS) {
            console.log('[AudioAssetLibrary] Initialized with enhanced lazy loading');
        }
        this.startPreloading();
        this.startMemoryMonitoring();
    }

    /**
     * Start preloading high priority assets with intelligent scheduling
     */
    startPreloading() {
        if (this.isPreloading) return;

        this.isPreloading = true;

        // Get current language
        const lang = _getCurrentAudioLanguage();

        // Build preload queue with priority scores
        this.preloadQueue = [];

        for (const priorityLevel in this.assetPriorities) {
            const assets = this.assetPriorities[priorityLevel];
            for (const assetData of assets) {
                const assetId = assetData.assetId || assetData; // Support both old and new format
                const score = assetData.score || 50;
                const category = assetId.startsWith('system.') ? 'system' : 'patient';

                if (this.fileMappings[lang] && this.fileMappings[lang][category] && this.fileMappings[lang][category][assetId]) {
                    this.preloadQueue.push({
                        assetId,
                        lang,
                        category,
                        priority: priorityLevel,
                        score,
                        retryCount: 0
                    });
                }
            }
        }

        // Sort by score (highest first)
        this.preloadQueue.sort((a, b) => b.score - a.score);

        if (window.DEBUG_LOGS) {
            console.log(`[AudioAssetLibrary] Preloading ${this.preloadQueue.length} assets for language ${lang}`);
        }

        // Start preloading with delay to allow UI to load first
        setTimeout(() => this.processPreloadQueue(), 500);
    }

    /**
     * Start memory usage monitoring
     */
    startMemoryMonitoring() {
        setInterval(() => {
            this.updateMemoryUsage();
            this.checkMemoryPressure();
        }, 5000); // Check every 5 seconds
    }

    /**
     * Update memory usage statistics
     */
    updateMemoryUsage() {
        let totalSize = 0;
        for (const [key, asset] of this.cache.entries()) {
            totalSize += asset.size || 0;
        }
        this.totalMemoryUsage = totalSize;
        this.stats.memoryUsageMB = Math.round(totalSize / (1024 * 1024) * 100) / 100;
    }

    /**
     * Check for memory pressure and evict if necessary
     */
    checkMemoryPressure() {
        const memoryPressure = this.stats.memoryUsageMB / this.maxCacheMemoryMB;

        if (memoryPressure > 0.9 || this.cache.size > this.maxCacheSize) {
            console.warn(`[AudioAssetLibrary] Memory pressure detected: ${this.stats.memoryUsageMB}MB`);
            this.evictLeastUsefulAssets(memoryPressure);
        }
    }

    /**
     * Evict least useful assets based on LRU and priority
     */
    evictLeastUsefulAssets(memoryPressure) {
        const entries = Array.from(this.cache.entries());

        // Calculate utility score for each asset (lower = more likely to evict)
        const scoredEntries = entries.map(([key, asset]) => {
            const lastAccess = this.accessOrder.get(key) || 0;
            const age = Date.now() - lastAccess;
            const priorityScore = this.getAssetPriorityScore(asset.assetId);

            // Utility score combines age, priority, and size
            const utilityScore = (age / 1000) * priorityScore - (asset.size || 0) / 1024;

            return { key, asset, utilityScore };
        });

        // Sort by utility score (lowest first)
        scoredEntries.sort((a, b) => a.utilityScore - b.utilityScore);

        // Evict assets until memory pressure is relieved
        const targetEvictions = Math.ceil(entries.length * memoryPressure * 0.3);
        const toEvict = scoredEntries.slice(0, targetEvictions);

        for (const { key } of toEvict) {
            this.cache.delete(key);
            this.accessOrder.delete(key);
            this.stats.evictions++;
        }

        if (window.DEBUG_LOGS) {
            console.log(`[AudioAssetLibrary] Evicted ${toEvict.length} assets to free memory`);
        }
    }

    /**
     * Get priority score for asset
     */
    getAssetPriorityScore(assetId) {
        for (const priorityLevel in this.assetPriorities) {
            const assets = this.assetPriorities[priorityLevel];
            for (const assetData of assets) {
                const id = assetData.assetId || assetData;
                if (id === assetId) {
                    const scores = { critical: 10, high: 8, medium: 6, low: 4 };
                    return scores[priorityLevel] || 5;
                }
            }
        }
        return 5; // Default score
    }

    /**
     * Process preload queue in batches with adaptive scheduling
     */
    async processPreloadQueue() {
        if (this.preloadQueue.length === 0) {
            this.isPreloading = false;
            this.stats.preloadProgress = 100;
            if (window.DEBUG_LOGS) {
            console.log('[AudioAssetLibrary] Preloading completed');
        }
            return;
        }

        // Calculate progress
        const totalAssets = this.getTotalAssetCount();
        const loadedAssets = this.cache.size;
        this.stats.preloadProgress = Math.round((loadedAssets / totalAssets) * 100);

        // Adaptive batch size based on network conditions and memory usage
        const adaptiveBatchSize = this.calculateAdaptiveBatchSize();
        const batch = this.preloadQueue.splice(0, adaptiveBatchSize);

        // Process batch with concurrency control
        const results = await this.processBatchWithConcurrency(batch);

        // Handle results and retries
        const failedItems = results.filter(r => !r.success).map(r => r.item);

        if (failedItems.length > 0) {
            // Retry failed items with exponential backoff
            for (const item of failedItems) {
                item.retryCount = (item.retryCount || 0) + 1;
                if (item.retryCount < this.preloadRetryAttempts) {
                    // Exponential backoff
                    const delay = this.preloadRetryDelayMs * Math.pow(2, item.retryCount);
                    setTimeout(() => this.preloadQueue.unshift(item), delay);
                } else {
                    console.warn(`[AudioAssetLibrary] Failed to load ${item.assetId} after ${item.retryCount} attempts`);
                    this.stats.loadErrors++;
                }
            }
        }

        // Adaptive delay based on system load
        const delay = this.calculateAdaptiveDelay();
        setTimeout(() => this.processPreloadQueue(), delay);
    }

    /**
     * Calculate adaptive batch size based on current conditions
     */
    calculateAdaptiveBatchSize() {
        const memoryPressure = this.stats.memoryUsageMB / this.maxCacheMemoryMB;
        const baseSize = this.preloadBatchSize;

        if (memoryPressure > 0.8) {
            return Math.max(1, Math.floor(baseSize * 0.5)); // Reduce batch size under memory pressure
        } else if (memoryPressure < 0.4) {
            return Math.min(6, baseSize + 1); // Increase batch size when memory is available
        }

        return baseSize;
    }

    /**
     * Calculate adaptive delay based on system conditions
     */
    calculateAdaptiveDelay() {
        const memoryPressure = this.stats.memoryUsageMB / this.maxCacheMemoryMB;
        const baseDelay = this.preloadDelayMs;

        if (memoryPressure > 0.8) {
            return baseDelay * 2; // Slow down under memory pressure
        } else if (this.cache.size > this.maxCacheSize * 0.9) {
            return baseDelay * 1.5; // Slow down when cache is nearly full
        }

        return baseDelay;
    }

    /**
     * Process batch with concurrency control
     */
    async processBatchWithConcurrency(batch) {
        const results = [];
        const maxConcurrency = 2; // Limit concurrent loads

        for (let i = 0; i < batch.length; i += maxConcurrency) {
            const chunk = batch.slice(i, i + maxConcurrency);
            const chunkPromises = chunk.map(item =>
                this.preloadAsset(item).then(
                    asset => ({ success: true, asset, item }),
                    error => ({ success: false, error, item })
                )
            );

            const chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
        }

        const successCount = results.filter(r => r.success).length;
        if (successCount > 0) {
            if (window.DEBUG_LOGS) {
            console.log(`[AudioAssetLibrary] Preloaded ${successCount}/${batch.length} assets`);
        }
        }

        return results;
    }

    /**
     * Get total asset count for progress calculation
     */
    getTotalAssetCount() {
        let count = 0;
        const lang = _getCurrentAudioLanguage();

        for (const priorityLevel in this.assetPriorities) {
            const assets = this.assetPriorities[priorityLevel];
            for (const assetData of assets) {
                const assetId = assetData.assetId || assetData;
                const category = assetId.startsWith('system.') ? 'system' : 'patient';

                if (this.fileMappings[lang] && this.fileMappings[lang][category] && this.fileMappings[lang][category][assetId]) {
                    count++;
                }
            }
        }

        return count;
    }

    /**
     * Preload a single asset with enhanced error handling
     */
    async preloadAsset(item) {
        const { assetId, lang, category } = item;
        const cacheKey = `${lang}:${assetId}`;
        const startTime = Date.now();

        // Check if already cached
        if (this.cache.has(cacheKey)) {
            this.updateAccessOrder(cacheKey);
            this.stats.cacheHits++;
            return this.cache.get(cacheKey);
        }

        // Check if already loading
        if (this.loadingPromises.has(cacheKey)) {
            return this.loadingPromises.get(cacheKey);
        }

        this.stats.cacheMisses++;

        // Create loading promise with timeout
        const loadingPromise = this.loadAssetWithTimeout(assetId, lang, category, 10000);

        // Store loading promise
        this.loadingPromises.set(cacheKey, loadingPromise);

        try {
            const asset = await loadingPromise;

            if (asset) {
                // Cache the result
                this.cache.set(cacheKey, asset);
                this.updateAccessOrder(cacheKey);

                // Update statistics
                const loadTime = Date.now() - startTime;
                this.updateLoadStatistics(loadTime);

                // Check memory pressure after caching
                this.checkMemoryPressure();

                return asset;
            } else {
                throw new Error(`Asset ${assetId} returned null`);
            }
        } catch (error) {
            console.error(`[AudioAssetLibrary] Error loading asset ${assetId}:`, error);
            throw error;
        } finally {
            // Remove loading promise
            this.loadingPromises.delete(cacheKey);
        }
    }

    /**
     * Load asset with timeout
     */
    async loadAssetWithTimeout(assetId, lang, category, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Load timeout for ${assetId}`));
            }, timeoutMs);

            this.loadAsset(assetId, lang, category)
                .then(asset => {
                    clearTimeout(timer);
                    resolve(asset);
                })
                .catch(error => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    /**
     * Update access order for LRU tracking
     */
    updateAccessOrder(cacheKey) {
        this.accessOrder.set(cacheKey, Date.now());
    }

    /**
     * Update load statistics
     */
    updateLoadStatistics(loadTime) {
        this.stats.totalLoadTime += loadTime;
        const totalLoads = this.stats.cacheHits + this.stats.cacheMisses;
        this.stats.averageLoadTime = Math.round(this.stats.totalLoadTime / totalLoads);
    }

    /**
     * Load an asset from server with enhanced error handling
     */
    async loadAsset(assetId, lang, category) {
        const mappings = this.languageMappings[lang];
        const files = this.fileMappings[lang][category];

        if (!mappings || !files || !files[assetId]) {
            if (window.DEBUG_LOGS || !this._lastMissingAssetWarn || Date.now() - this._lastMissingAssetWarn > 60000) {
                console.warn(`[AudioAssetLibrary] Asset mapping not found: ${assetId} (${lang}:${category})`);
                this._lastMissingAssetWarn = Date.now();
            }
            return null;
        }

        const directory = category === 'system' ? mappings.systemDir : mappings.patientDir;
        const filename = files[assetId];

        try {
            const url = _fileUrl(directory, filename);
            let estimatedSize = 0;

            // Best-effort HEAD for size; do not block playback if it fails.
            try {
                const response = await fetch(url, {
                    method: 'HEAD',
                    cache: 'force-cache'
                });
                if (response.ok) {
                    const contentLength = response.headers.get('content-length');
                    estimatedSize = contentLength ? parseInt(contentLength) : 0;
                } else if (window.DEBUG_LOGS) {
                    console.warn(`[AudioAssetLibrary] HEAD failed (${response.status}) for ${assetId}`);
                }
            } catch (e) {
                if (window.DEBUG_LOGS) {
                    console.warn(`[AudioAssetLibrary] HEAD request failed for ${assetId}:`, e);
                }
            }

            if (window.DEBUG_LOGS) {
                if (estimatedSize > 0) {
                    console.log(`[AudioAssetLibrary] Loading asset: ${assetId} (${lang}) - ${Math.round(estimatedSize / 1024)}KB`);
                } else {
                    console.log(`[AudioAssetLibrary] Loading asset: ${assetId} (${lang})`);
                }
            }

            // Create audio element to preload
            return new Promise((resolve, reject) => {
                const audio = new Audio();
                let isResolved = false;

                const cleanup = () => {
                    if (isResolved) return;
                    isResolved = true;

                    // Remove event listeners
                    audio.removeEventListener('canplaythrough', onReady);
                    audio.removeEventListener('canplay', onReady);
                    audio.removeEventListener('loadedmetadata', onReady);
                    audio.removeEventListener('loadeddata', onProgress);
                    audio.removeEventListener('error', onError);
                    audio.removeEventListener('abort', onAbort);
                };

                const onReady = () => {
                    cleanup();

                    const asset = {
                        url: url,
                        audio: audio,
                        loadedAt: Date.now(),
                        assetId,
                        lang,
                        category,
                        size: this.estimateAudioSize(audio) || estimatedSize,
                        duration: audio.duration || 0,
                        format: filename.split('.').pop().toLowerCase()
                    };

                    resolve(asset);
                };

                const onProgress = () => {
                    // Optional: Log loading progress
                    if (audio.readyState >= 2) { // HAVE_CURRENT_DATA
                        if (window.DEBUG_LOGS) {
                        console.debug(`[AudioAssetLibrary] Loading progress: ${assetId} - readyState: ${audio.readyState}`);
                    }
                    }
                };

                const onError = (e) => {
                    cleanup();
                    const error = new Error(`Failed to load audio: ${assetId} - ${audio.error ? audio.error.message : 'Unknown error'}`);
                    reject(error);
                };

                const onAbort = () => {
                    cleanup();
                    reject(new Error(`Loading aborted: ${assetId}`));
                };

                // Add event listeners
                audio.addEventListener('canplaythrough', onReady, { once: true });
                audio.addEventListener('canplay', onReady, { once: true });
                audio.addEventListener('loadedmetadata', onReady, { once: true });
                audio.addEventListener('loadeddata', onProgress);
                audio.addEventListener('error', onError, { once: true });
                audio.addEventListener('abort', onAbort, { once: true });

                // Set up loading with timeout
                audio.src = url;
                audio.preload = 'auto';
                audio.load(); // Explicitly start loading

                // Set a timeout as a fallback
                setTimeout(() => {
                    if (!isResolved) {
                        cleanup();
                        reject(new Error(`Loading timeout: ${assetId}`));
                    }
                }, 15000); // 15 second timeout
            });
        } catch (error) {
            console.error(`[AudioAssetLibrary] Error loading asset ${assetId}:`, error);

            // Try fallback: create a placeholder asset
            if (this.shouldCreateFallback(assetId)) {
                if (window.DEBUG_LOGS) {
                    console.log(`[AudioAssetLibrary] Creating fallback for: ${assetId}`);
                }
                return this.createFallbackAsset(assetId, lang, category);
            }

            return null;
        }
    }

    /**
     * Determine if fallback should be created
     */
    shouldCreateFallback(assetId) {
        // Create fallback for critical system messages only
        const criticalAssets = [
            'system.choose_mode', 'system.choose_force', 'system.choose_duration',
            'system.confirm_summary', 'system.enter_running', 'system.paused',
            'system.resumed', 'system.stopped', 'system.emergency_stop'
        ];

        return criticalAssets.includes(assetId);
    }

    /**
     * Create fallback asset using TTS or placeholder
     */
    async createFallbackAsset(assetId, lang, category) {
        try {
            // For critical system messages, use TTS as fallback
            const text = this.getFallbackText(assetId, lang);
            if (text && window.speechSynthesis) {
                // Create a TTS-based asset
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.lang = lang === 'en' ? 'en-US' : 'zh-HK';
                utterance.rate = 0.9;

                return {
                    url: null,
                    utterance: utterance,
                    loadedAt: Date.now(),
                    assetId,
                    lang,
                    category,
                    size: 0,
                    duration: 0,
                    format: 'tts-fallback',
                    isFallback: true
                };
            }
        } catch (error) {
            console.error(`[AudioAssetLibrary] Failed to create fallback for ${assetId}:`, error);
        }

        return null;
    }

    /**
     * Get fallback text for TTS
     */
    getFallbackText(assetId, lang) {
        const fallbackTexts = {
            'zh': {
                'system.choose_mode': '請選擇模式',
                'system.choose_force': '請選擇力度',
                'system.choose_duration': '請選擇時間',
                'system.confirm_summary': '請確認開始',
                'system.enter_running': '按摩現在開始',
                'system.paused': '已經暫停',
                'system.resumed': '恢復',
                'system.stopped': '停止',
                'system.emergency_stop': '緊急停止'
            },
            'en': {
                'system.choose_mode': 'Please select mode',
                'system.choose_force': 'Please select intensity',
                'system.choose_duration': 'Please select duration',
                'system.confirm_summary': 'Please confirm to start',
                'system.enter_running': 'Massage starting now',
                'system.paused': 'Paused',
                'system.resumed': 'Resume',
                'system.stopped': 'Stop',
                'system.emergency_stop': 'Emergency stop'
            }
        };

        return fallbackTexts[lang]?.[assetId] || null;
    }

    /**
     * Get asset with enhanced lazy loading and fallback support
     */
    static async getAsset(assetId, options = {}) {
        const {
            priority = 'medium',
            timeout = 8000,
            fallback = true,
            language = null,
            lang: requestedLang = null
        } = options;

        const lang = _getCurrentAudioLanguage(requestedLang || language);

        // Determine category based on asset ID pattern
        const category = assetId.startsWith('patient.') ? 'patient' : 'system';

        // Get singleton instance
        const instance = AudioAssetLibrary.getInstance();
        const cacheKey = `${lang}:${assetId}`;

        // Check cache first
        if (instance.cache.has(cacheKey)) {
            instance.updateAccessOrder(cacheKey);
            instance.stats.cacheHits++;
            return instance.cache.get(cacheKey);
        }

        instance.stats.cacheMisses++;

        // Load asset if not cached
        try {
            const asset = await instance.preloadAssetWithTimeout({
                assetId,
                lang,
                category,
                priority,
                score: 50 // Default score for on-demand loads
            }, timeout);

            return asset;
        } catch (error) {
            console.error(`[AudioAssetLibrary] Failed to get asset ${assetId}:`, error);

            if (fallback) {
                // Try to create fallback
                const fallbackAsset = await instance.createFallbackAsset(assetId, lang, category);
                if (fallbackAsset) {
                    if (window.DEBUG_LOGS) {
                        console.log(`[AudioAssetLibrary] Using fallback for ${assetId}`);
                    }
                    return fallbackAsset;
                }
            }

            // Return placeholder for missing assets
            return instance.createPlaceholderAsset(assetId, lang, category);
        }
    }

    /**
     * Preload asset with timeout
     */
    async preloadAssetWithTimeout(item, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Load timeout for ${item.assetId}`));
            }, timeoutMs);

            this.preloadAsset(item)
                .then(asset => {
                    clearTimeout(timer);
                    resolve(asset);
                })
                .catch(error => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    /**
     * Create placeholder asset for missing audio
     */
    createPlaceholderAsset(assetId, lang, category) {
        if (window.DEBUG_LOGS || !this._lastMissingAssetWarn || Date.now() - this._lastMissingAssetWarn > 60000) {
            console.warn(`[AudioAssetLibrary] Creating placeholder for missing asset: ${assetId}`);
            this._lastMissingAssetWarn = Date.now();
        }

        return {
            url: _BEEP_WAV_DATA_URL,
            audio: null,
            loadedAt: Date.now(),
            assetId,
            lang,
            category,
            size: 0,
            duration: 0.2,
            format: 'placeholder',
            isPlaceholder: true
        };
    }

    /**
     * Get singleton instance
     */
    static getInstance() {
        if (!AudioAssetLibrary._instance) {
            AudioAssetLibrary._instance = new AudioAssetLibrary();
        }
        return AudioAssetLibrary._instance;
    }

    /**
     * Estimate audio file size with better accuracy
     */
    estimateAudioSize(audio) {
        if (!audio) return 0;

        // If we have actual duration, use it for estimation
        if (audio.duration && !isNaN(audio.duration)) {
            // Estimate based on format and bitrate
            const bitrate = this.estimateBitrate(audio.src);
            return Math.round(audio.duration * bitrate / 8);
        }

        // Fallback estimation based on typical file sizes
        return 50000; // 50KB default estimate
    }

    /**
     * Estimate bitrate based on file format
     */
    estimateBitrate(audioUrl) {
        if (!audioUrl) return 128000; // Default 128kbps

        const format = audioUrl.split('.').pop().toLowerCase();
        const bitrates = {
            'mp3': 128000,
            'm4a': 96000,
            'wav': 705600,
            'ogg': 128000,
            'webm': 128000
        };

        return bitrates[format] || 128000;
    }

    /**
     * Smart cache eviction based on multiple factors
     */
    evictOldestCacheEntry() {
        if (this.cache.size === 0) return;

        // Find least useful asset based on utility score
        let worstKey = null;
        let worstScore = Infinity;

        for (const [key, asset] of this.cache.entries()) {
            const score = this.calculateEvictionScore(key, asset);
            if (score < worstScore) {
                worstScore = score;
                worstKey = key;
            }
        }

        if (worstKey) {
            this.cache.delete(worstKey);
            this.accessOrder.delete(worstKey);
            this.stats.evictions++;
            console.log(`[AudioAssetLibrary] Evicted cache entry: ${worstKey} (score: ${worstScore.toFixed(2)})`);
        }
    }

    /**
     * Calculate eviction score for an asset (lower = more likely to evict)
     */
    calculateEvictionScore(key, asset) {
        const now = Date.now();
        const lastAccess = this.accessOrder.get(key) || asset.loadedAt || now;
        const age = now - lastAccess;

        // Factors: age (higher = better to keep), priority (higher = better to keep), size (smaller = better to keep)
        const ageScore = Math.log(age + 1) / 10; // Logarithmic age scoring
        const priorityScore = this.getAssetPriorityScore(asset.assetId);
        const sizePenalty = (asset.size || 0) / 100000; // Penalty for large files

        return priorityScore - ageScore + sizePenalty;
    }

    /**
     * Clear cache with optional selective clearing
     */
    clearCache(options = {}) {
        const {
            language = null,
            category = null,
            olderThan = null,
            priority = null
        } = options;

        let clearedCount = 0;

        if (language || category || olderThan || priority) {
            // Selective clearing
            const keysToDelete = [];

            for (const [key, asset] of this.cache.entries()) {
                let shouldDelete = true;

                if (language && !key.startsWith(`${language}:`)) {
                    shouldDelete = false;
                }

                if (category && asset.category !== category) {
                    shouldDelete = false;
                }

                if (olderThan && asset.loadedAt && asset.loadedAt > olderThan) {
                    shouldDelete = false;
                }

                if (priority) {
                    const assetPriority = this.getAssetPriorityLevel(asset.assetId);
                    if (assetPriority !== priority) {
                        shouldDelete = false;
                    }
                }

                if (shouldDelete) {
                    keysToDelete.push(key);
                }
            }

            for (const key of keysToDelete) {
                this.cache.delete(key);
                this.accessOrder.delete(key);
                clearedCount++;
            }
        } else {
            // Full clear
            clearedCount = this.cache.size;
            this.cache.clear();
            this.accessOrder.clear();
        }

        console.log(`[AudioAssetLibrary] Cleared ${clearedCount} cache entries`);
        this.updateMemoryUsage();
    }

    /**
     * Get asset priority level
     */
    getAssetPriorityLevel(assetId) {
        for (const [level, assets] of Object.entries(this.assetPriorities)) {
            for (const assetData of assets) {
                const id = assetData.assetId || assetData;
                if (id === assetId) {
                    return level;
                }
            }
        }
        return 'low'; // Default priority
    }

    /**
     * Get comprehensive cache statistics
     */
    getCacheStats() {
        this.updateMemoryUsage();

        const stats = {
            ...this.stats,
            size: this.cache.size,
            maxSize: this.maxCacheSize,
            loading: this.loadingPromises.size,
            preloadQueue: this.preloadQueue.length,
            isPreloading: this.isPreloading,
            memoryUsageMB: this.stats.memoryUsageMB,
            maxMemoryMB: this.maxCacheMemoryMB,
            cacheHitRate: this.calculateCacheHitRate(),
            averageLoadTime: this.stats.averageLoadTime,
            evictions: this.stats.evictions,
            loadErrors: this.stats.loadErrors,
            cacheEntries: []
        };

        // Add cache entries details
        for (const [key, asset] of this.cache.entries()) {
            const lastAccess = this.accessOrder.get(key) || asset.loadedAt || Date.now();
            stats.cacheEntries.push({
                key,
                assetId: asset.assetId,
                lang: key.split(':')[0],
                category: asset.category,
                loadedAt: asset.loadedAt,
                lastAccess,
                size: asset.size || 0,
                duration: asset.duration || 0,
                format: asset.format || 'unknown',
                isFallback: asset.isFallback || false,
                isPlaceholder: asset.isPlaceholder || false,
                priority: this.getAssetPriorityLevel(asset.assetId)
            });
        }

        // Sort by last access (most recent first)
        stats.cacheEntries.sort((a, b) => b.lastAccess - a.lastAccess);

        return stats;
    }

    /**
     * Calculate cache hit rate
     */
    calculateCacheHitRate() {
        const total = this.stats.cacheHits + this.stats.cacheMisses;
        if (total === 0) return 0;
        return Math.round((this.stats.cacheHits / total) * 100);
    }

    /**
     * Get performance report
     */
    getPerformanceReport() {
        const stats = this.getCacheStats();

        return {
            summary: {
                cacheEfficiency: `${stats.cacheHitRate}% hit rate`,
                memoryUsage: `${stats.memoryUsageMB}/${stats.maxMemoryMB}MB`,
                cacheUtilization: `${stats.size}/${stats.maxSize} files`,
                preloadProgress: `${stats.preloadProgress}%`,
                totalErrors: stats.loadErrors,
                totalEvictions: stats.evictions
            },
            recommendations: this.generateRecommendations(stats),
            details: stats
        };
    }

    /**
     * Generate performance recommendations
     */
    generateRecommendations(stats) {
        const recommendations = [];

        if (stats.cacheHitRate < 70) {
            recommendations.push({
                type: 'performance',
                message: 'Low cache hit rate. Consider preloading more assets.',
                priority: 'medium'
            });
        }

        if (stats.memoryUsageMB > stats.maxMemoryMB * 0.8) {
            recommendations.push({
                type: 'memory',
                message: 'High memory usage. Consider reducing cache size.',
                priority: 'high'
            });
        }

        if (stats.loadErrors > 5) {
            recommendations.push({
                type: 'reliability',
                message: 'Multiple load errors detected. Check network connectivity.',
                priority: 'high'
            });
        }

        if (stats.averageLoadTime > 3000) {
            recommendations.push({
                type: 'performance',
                message: 'Slow load times. Consider optimizing audio file sizes.',
                priority: 'medium'
            });
        }

        if (stats.evictions > 10) {
            recommendations.push({
                type: 'memory',
                message: 'Frequent cache evictions. Consider increasing cache size.',
                priority: 'low'
            });
        }

        return recommendations;
    }

    /**
     * Preload specific assets with priority and options
     */
    async preloadAssets(assetIds, options = {}) {
        const {
            lang = null,
            priority = 'medium',
            immediate = false
        } = options;

        const targetLang = _getCurrentAudioLanguage(lang);
        let addedCount = 0;

        for (const assetId of assetIds) {
            const category = assetId.startsWith('patient.') ? 'patient' : 'system';

            if (this.fileMappings[targetLang] && this.fileMappings[targetLang][category] && this.fileMappings[targetLang][category][assetId]) {
                const item = {
                    assetId,
                    lang: targetLang,
                    category,
                    priority,
                    score: this.getAssetPriorityScore(assetId) * 10, // Boost score for explicit preloads
                    retryCount: 0
                };

                if (immediate) {
                    // Add to front of queue for immediate loading
                    this.preloadQueue.unshift(item);
                } else {
                    this.preloadQueue.push(item);
                }

                addedCount++;
            }
        }

        console.log(`[AudioAssetLibrary] Added ${addedCount}/${assetIds.length} assets to preload queue`);

        if (!this.isPreloading) {
            this.processPreloadQueue();
        }

        return addedCount;
    }

    /**
     * Warm up cache for commonly used assets with intelligent selection
     */
    async warmUpCache(context = {}) {
        const {
            scenario = 'default',
            language = null
        } = context;

        const targetLang = _getCurrentAudioLanguage(language);

        // Context-aware asset selection
        let assetsToPreload = [];

        switch (scenario) {
            case 'massage_setup':
                assetsToPreload = [
                    'system.choose_mode', 'system.choose_force', 'system.choose_duration',
                    'system.confirm_summary', 'system.enter_setup', 'system.cancelled'
                ];
                break;

            case 'massage_running':
                assetsToPreload = [
                    'system.enter_running', 'system.paused', 'system.resumed',
                    'system.stopped', 'system.emergency_stop',
                    'patient.comfy_01', 'patient.slight_discomfort_01', 'patient.pain_01'
                ];
                break;

            case 'emergency':
                assetsToPreload = [
                    'system.emergency_stop', 'system.stopped'
                ];
                break;

            default:
                // Default common assets
                assetsToPreload = [
                    'system.choose_mode', 'system.choose_force', 'system.choose_duration',
                    'system.confirm_summary', 'system.enter_running',
                    'patient.comfy_01', 'patient.slight_discomfort_01', 'patient.pain_01'
                ];
        }

        console.log(`[AudioAssetLibrary] Warming up cache for ${scenario} scenario`);

        // Preload with high priority
        return await this.preloadAssets(assetsToPreload, {
            lang: targetLang,
            priority: 'high',
            immediate: true
        });
    }

    /**
     * Predictive preloading based on usage patterns
     */
    async predictivePreload() {
        // Analyze current state and predict likely next assets
        const currentMode = this.getCurrentAppMode();
        const recentAssets = this.getRecentlyUsedAssets(5);

        let predictedAssets = [];

        switch (currentMode) {
            case 'MASSAGE_SETUP':
                predictedAssets = ['system.confirm_summary', 'system.enter_running', 'system.cancelled'];
                break;

            case 'MASSAGE_RUNNING':
                predictedAssets = ['system.paused', 'system.stopped', 'patient.comfy_01', 'patient.pain_01'];
                break;

            case 'CHAT':
                predictedAssets = ['system.generic_ack'];
                break;
        }

        // Filter out already loaded assets
        const targetLang = _getCurrentAudioLanguage();
        const notLoaded = predictedAssets.filter(assetId => {
            const cacheKey = `${targetLang}:${assetId}`;
            return !this.cache.has(cacheKey);
        });

        if (notLoaded.length > 0) {
            console.log(`[AudioAssetLibrary] Predictive preloading: ${notLoaded.join(', ')}`);
            await this.preloadAssets(notLoaded, { priority: 'medium' });
        }
    }

    /**
     * Get current app mode (simplified detection)
     */
    getCurrentAppMode() {
        // This would need to be connected to the main app's state management
        // For now, return a default
        return 'CHAT';
    }

    /**
     * Get recently used assets
     */
    getRecentlyUsedAssets(count = 5) {
        const entries = Array.from(this.accessOrder.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, count)
            .map(([key]) => key.split(':')[1]);

        return entries;
    }

    /**
     * Optimize cache based on current usage patterns
     */
    optimizeCache() {
        const stats = this.getCacheStats();

        // If cache hit rate is low, preload more assets
        if (stats.cacheHitRate < 60) {
            console.log('[AudioAssetLibrary] Low hit rate detected, increasing preload');
            this.warmUpCache();
        }

        // If memory usage is high, aggressive eviction
        if (stats.memoryUsageMB > this.maxCacheMemoryMB * 0.85) {
            console.log('[AudioAssetLibrary] High memory usage, optimizing cache');
            this.clearCache({ olderThan: Date.now() - 300000 }); // Clear assets older than 5 minutes
        }

        // Update preload queue priorities based on recent usage
        this.rebalancePreloadQueue();
    }

    /**
     * Rebalance preload queue based on current priorities
     */
    rebalancePreloadQueue() {
        // Sort queue by score again (scores may have changed based on context)
        this.preloadQueue.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    /**
     * Export cache state for debugging
     */
    exportDebugInfo() {
        const stats = this.getCacheStats();
        const report = this.getPerformanceReport();

        return {
            timestamp: new Date().toISOString(),
            version: '2.0.0',
            configuration: {
                maxCacheSize: this.maxCacheSize,
                maxMemoryMB: this.maxCacheMemoryMB,
                preloadBatchSize: this.preloadBatchSize
            },
            statistics: stats,
            performance: report,
            queueState: {
                length: this.preloadQueue.length,
                isPreloading: this.isPreloading,
                nextItems: this.preloadQueue.slice(0, 5).map(item => ({
                    assetId: item.assetId,
                    priority: item.priority,
                    score: item.score
                }))
            }
        };
    }

    /**
     * Get file URL helper
     */
    _fileUrl(dir, filename) {
        return _buildUrl(`/${dir}/${encodeURIComponent(filename)}`);
    }

    static matchSystemTextToAssetId(text) {
        // Strip punctuation + parenthetical hints so "請選擇模式（...）" still maps to preset
        let t = (text || '');
        t = t.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
        t = t.replace(/[。！？!?,.]/g, '').trim().toLowerCase();

        // Combined Chinese and English text-to-asset mappings
        const byText = {
            // Chinese mappings
            '請選擇模式': 'system.choose_mode',
            '請選擇力度': 'system.choose_force',
            '請選擇時間': 'system.choose_duration',
            '請一次講出模式、力度和時間': 'system.choose_mode_force_duration_simple',
            '請一次講出模式力度和時間': 'system.choose_mode_force_duration_simple',
            '請確認開始': 'system.confirm_summary',
            '按摩現在開始': 'system.enter_running',
            '按摩現在開始啦': 'system.enter_running',
            '已經暫停': 'system.paused',
            '已取消設定': 'system.cancelled',
            '已進入按摩設定': 'system.enter_setup',
            '請一次講出模式、力度和時間': 'system.choose_mode_force_duration_simple',
            '收到 工程模式已開啟': 'system.eng_mode_activated',
            '工程模式已關閉': 'system.eng_mode_deactivated',
            '收到 依家開始畫一個圓形': 'system.draw_circle',
            '收到 依家開始畫一個正方形': 'system.draw_square',
            '收到 依家開始畫一個三角形': 'system.draw_triangle',
            // English mappings
            'please select mode': 'system.choose_mode',
            'please select intensity': 'system.choose_force',
            'please select force': 'system.choose_force',
            'please select duration': 'system.choose_duration',
            'please select time': 'system.choose_duration',
            'please say the mode intensity and duration in one sentence missing items will use defaults': 'system.choose_mode_force_duration_simple',
            'please confirm to start': 'system.confirm_summary',
            'massage starting now': 'system.enter_running',
            'paused': 'system.paused',
            'settings cancelled': 'system.cancelled',
            'entered massage settings': 'system.enter_setup',
            'please say mode intensity and duration all at once': 'system.choose_mode_force_duration_simple',
            'received engineering mode has been activated': 'system.eng_mode_activated',
            'engineering mode has been deactivated': 'system.eng_mode_deactivated',
            'received starting to draw a circle now': 'system.draw_circle',
            'received starting to draw a square now': 'system.draw_square',
            'received starting to draw a triangle now': 'system.draw_triangle',
        };
        return byText[t] || byText[t.toLowerCase()] || null;
    }
}
