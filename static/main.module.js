// ===== main.module.js - ES Module Entry Point =====
// Phase E1: Module entry with module global bridge.
// Load order: i18n → tts-infrastructure → audio_processor → azure_service_monitor →
//             stt-service → core/* → voice/* → massage/* → ui/* → app.js → main.module.js

import { attachModuleGlobals } from './module-bridge.js?v=1';

(function () {
    'use strict';

    attachModuleGlobals();

    window.__mainModuleInitialized = true;

    // ===== Module Verification =====
    // Verify all required modules are loaded before initialization
    function verifyModules() {
        const required = [
            // Core
            { name: 'SystemMode', check: () => typeof window.SystemMode === 'object' },
            { name: 'MassageStateMachine', check: () => typeof window.MassageStateMachine === 'function' },

            // Voice
            { name: 'AudioAssetLibrary', check: () => typeof window.AudioAssetLibrary === 'function' },
            { name: 'AudioManager', check: () => typeof window.AudioManager === 'function' },

            // Massage
            { name: 'SetupWizardCore', check: () => typeof window.SetupWizardCore === 'object' },

            // UI
            { name: 'SetupWizardUI', check: () => typeof window.SetupWizardUI === 'object' },

            // Listening Modes (created by app.js at top-level)
            { name: 'createMassageListening', check: () => typeof window.createMassageListening === 'function' },
            { name: 'createFollowUpListening', check: () => typeof window.createFollowUpListening === 'function' },
            { name: 'createAlwaysListening', check: () => typeof window.createAlwaysListening === 'function' }
        ];

        const missing = required.filter(m => !m.check());
        if (missing.length > 0) {
            console.warn('[main.module.js] Missing modules:', missing.map(m => m.name).join(', '));
            return false;
        }

        console.log('[main.module.js] All required modules verified');
        return true;
    }

    // ===== Initialization Sequence =====
    async function initializeApplication() {
        console.log('🚀 [main.module.js] Starting application initialization...');

        // Step 1: Verify all modules are loaded
        const modulesOk = verifyModules();
        if (!modulesOk) {
            console.error('[main.module.js] Module verification failed, continuing with available modules');
        }

        // Step 2: Verify StateMachine instance
        if (window.stateMachine) {
            console.log('[main.module.js] StateMachine instance ready:', window.stateMachine.currentMode);
        }

        // Step 3: Verify audioManager singleton
        if (window.audioManager) {
            console.log('[main.module.js] AudioManager singleton ready');
        }

        // Step 4: Verify SetupWizardCore instance
        if (window._setupWizardCore) {
            console.log('[main.module.js] SetupWizardCore instance ready');
        }

        // Step 5: Verify listening mode instances
        if (window._massageListening) {
            console.log('[main.module.js] MassageListening ready');
        }
        if (window._followUpListening) {
            console.log('[main.module.js] FollowUpListening ready');
        }
        if (window._alwaysListening) {
            console.log('[main.module.js] AlwaysListening ready');
        }

        // Step 6: Mark main.js initialized before app init
        window.__mainJsInitialized = true;

        // Step 7: Call app.js initialization if available
        // app.js exposes initApp() for the main initialization logic
        if (typeof window.initApp === 'function') {
            console.log('[main.module.js] Calling app.js initApp()...');
            try {
                window.__initAppCallCount = (window.__initAppCallCount || 0) + 1;
                await window.initApp();
                console.log('[main.module.js] app.js initApp() completed');
            } catch (err) {
                console.error('[main.module.js] Error in initApp():', err);
            }
        } else {
            console.log('[main.module.js] No initApp() found, app.js handles its own DOMContentLoaded');
        }

        // Step 8: Mark initialization complete
        console.log('✅ [main.module.js] Application initialization complete');

        // Dispatch custom event for any listeners
        window.dispatchEvent(new CustomEvent('app:initialized', {
            detail: {
                timestamp: Date.now(),
                modulesVerified: modulesOk
            }
        }));

        // After this point, app.js should only react to events, not initialize systems.
        window.__ARCH_REFACTOR_COMPLETE = true;
        window.dispatchEvent(new Event('app:ready'));
    }

    // ===== DOMContentLoaded Handler =====
    // This is the SINGLE entry point for initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeApplication);
    } else {
        // DOM already ready, initialize immediately
        initializeApplication();
    }

    // ===== Export for debugging =====
    window.MainJS = window.MainJS || {
        verifyModules,
        initializeApplication,
        version: '1.0.0'
    };
})();
