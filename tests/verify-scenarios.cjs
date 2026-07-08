/**
 * Scenario Configuration Verification
 * Lightweight smoke verification for scenario structure, timing and audio files.
 */

const fs = require('fs');
const path = require('path');

const scenarioControllerPath = path.join(__dirname, '../static/src/nursing/ScenarioController.js');
const content = fs.readFileSync(scenarioControllerPath, 'utf-8');

const checks = [
    { name: 'Scenario 0 keyboard practice defined', test: () => content.includes('scenario_0: {') && content.includes('Keyboard expression practice') },
    { name: 'Scenario 1 defined', test: () => content.includes('scenario_1: {') },
    { name: 'Scenario 1 baseline stage', test: () => /scenario_1:[\s\S]*baseline:\s*{/.test(content) },
    { name: 'Scenario 1 stage12', test: () => content.includes('stage12: {') },
    { name: 'Scenario 1 stopOutcome', test: () => content.includes('stopOutcome: {') },
    { name: 'Scenario 1 continueIntermediate', test: () => content.includes('continueIntermediate: {') },
    { name: 'Scenario 1 continueOutcome', test: () => content.includes('continueOutcome: {') },
    { name: 'S1 Baseline: HR 89', test: () => /scenario_1:[\s\S]{0,700}baseline:[\s\S]{0,400}hr:\s*89/.test(content) },
    { name: 'S1 Baseline: BP 115/73', test: () => /scenario_1:[\s\S]{0,700}baseline:[\s\S]{0,400}sbp:\s*115[\s\S]{0,80}dbp:\s*73/.test(content) },
    { name: 'S1 Baseline: SpO2 97%', test: () => /scenario_1:[\s\S]{0,700}baseline:[\s\S]{0,400}spo2:\s*97/.test(content) },
    { name: 'S1 Stage 1.2: HR 86', test: () => /stage12:[\s\S]{0,400}hr:\s*86/.test(content) },
    { name: 'S1 Intermediate: SpO2 95%', test: () => /continueIntermediate:[\s\S]{0,500}spo2:\s*95/.test(content) },
    { name: 'S1 Final: HR 115', test: () => /continueOutcome:[\s\S]{0,500}hr:\s*115/.test(content) },
    { name: 'Scenario 2 defined', test: () => content.includes('scenario_2: {') },
    { name: 'S2 Stage 1.2: HR 103', test: () => /scenario_2:[\s\S]{0,1200}stage12:[\s\S]{0,400}hr:\s*103/.test(content) },
    { name: 'S2 Continue: BP 143/95', test: () => /scenario_2:[\s\S]{0,2200}continueOutcome:[\s\S]{0,500}sbp:\s*143[\s\S]{0,80}dbp:\s*95/.test(content) },
    { name: 'scheduleStage12(60000)', test: () => content.includes('scheduleStage12(60000)') },
    { name: 'scheduleOutcome(60000)', test: () => content.includes('scheduleOutcome(60000)') },
    { name: 'scheduleOutcome(30000)', test: () => content.includes('scheduleOutcome(30000)') },
    { name: 'F6 hotkey', test: () => /event\.key\s*===\s*'F6'[\s\S]{0,200}selectScenario\('scenario_0'/.test(content) },
    { name: 'F7 hotkey', test: () => /event\.key\s*===\s*'F7'[\s\S]{0,200}selectScenario\('scenario_1'/.test(content) },
    { name: 'F8 hotkey', test: () => /event\.key\s*===\s*'F8'[\s\S]{0,200}selectScenario\('scenario_2'/.test(content) },
    { name: 'F9 hotkey', test: () => /event\.key\s*===\s*'F9'[\s\S]{0,200}selectScenario\('off'/.test(content) },
    { name: 'All soundtrack IDs referenced', test: () => Array.from({ length: 8 }, (_, idx) => `soundtrack_0${idx + 1}`).every((id) => content.includes(id)) },
    { name: 'All expression presets referenced', test: () => ['baseline', 'mild_anxiety', 'mild_pain', 'high_anxiety', 'moderate_pain', 'severe_pain'].every((id) => content.includes(`expressionPresetId: '${id}'`)) }
];

let passed = 0;
let failed = 0;

console.log('='.repeat(70));
console.log('SCENARIO 1 & 2 CONFIGURATION VERIFICATION');
console.log('='.repeat(70));

for (const check of checks) {
    try {
        if (check.test()) {
            console.log(`✓ ${check.name}`);
            passed += 1;
        } else {
            console.log(`✗ ${check.name}`);
            failed += 1;
        }
    } catch (error) {
        console.log(`✗ ${check.name} (${error.message})`);
        failed += 1;
    }
}

const audioBasePath = path.join(__dirname, '../static/predefined_sound_track');
const voiceVariants = ['azure_man_8_tracks', 'azure_cantonese_oldman_8_tracks'];
for (const variant of voiceVariants) {
    for (let i = 1; i <= 8; i += 1) {
        const audioPath = path.join(audioBasePath, variant, `soundtrack_0${i}.mp3`);
        if (fs.existsSync(audioPath)) {
            console.log(`✓ ${variant}/soundtrack_0${i}.mp3`);
            passed += 1;
        } else {
            console.log(`✗ ${variant}/soundtrack_0${i}.mp3 NOT FOUND`);
            failed += 1;
        }
    }
}

console.log('');
console.log(`RESULTS: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
