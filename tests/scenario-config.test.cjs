/**
 * Scenario Configuration Unit Test
 * Verifies deterministic teaching scenario values without requiring a browser.
 */

const fs = require('fs');
const path = require('path');

const scenarioControllerPath = path.join(__dirname, '../static/src/nursing/ScenarioController.js');
const content = fs.readFileSync(scenarioControllerPath, 'utf-8');

const EXPECTED = {
    scenario_1: {
        baseline: {
            hr: 89, sbp: 115, dbp: 73, rr: 18, spo2: 97,
            pain: 0, anxiety: 0, comfort: 2,
            virtualMinutesOnFire: 0,
            virtualRateSecsPerSec: 5,
            expressionPresetId: 'baseline'
        },
        stage12: {
            hr: 86, sbp: 98, dbp: 65, rr: 14, spo2: 97,
            pain: 0, anxiety: 0, comfort: 3,
            virtualMinutesOnFire: 5,
            virtualRateSecsPerSec: 15,
            expressionPresetId: 'baseline'
        },
        stopOutcome: {
            hr: 88, sbp: 103, dbp: 66, rr: 16, spo2: 97,
            pain: 0, anxiety: 2, comfort: 0,
            virtualMinutesOnFire: 5,
            virtualRateSecsPerSec: 0,
            expressionPresetId: 'mild_anxiety'
        },
        continueIntermediate: {
            hr: 102, sbp: 115, dbp: 72, rr: 20, spo2: 95,
            pain: 2, anxiety: 3, comfort: 1,
            virtualMinutesOnFire: 20,
            virtualRateSecsPerSec: 15,
            expressionPresetId: 'mild_pain'
        },
        continueOutcome: {
            hr: 115, sbp: 116, dbp: 76, rr: 22, spo2: 94,
            pain: 2, anxiety: 4, comfort: 1,
            virtualMinutesOnFire: 20,
            virtualRateSecsPerSec: 15,
            expressionPresetId: 'high_anxiety'
        }
    },
    scenario_2: {
        baseline: {
            hr: 89, sbp: 115, dbp: 73, rr: 18, spo2: 97,
            pain: 0, anxiety: 0, comfort: 2,
            virtualMinutesOnFire: 0,
            virtualRateSecsPerSec: 5,
            expressionPresetId: 'baseline'
        },
        stage12: {
            hr: 103, sbp: 122, dbp: 84, rr: 24, spo2: 94,
            pain: 5, anxiety: 4, comfort: 0,
            virtualMinutesOnFire: 5,
            virtualRateSecsPerSec: 15,
            expressionPresetId: 'high_anxiety'
        },
        stopOutcome: {
            hr: 101, sbp: 121, dbp: 83, rr: 22, spo2: 94,
            pain: 5, anxiety: 3, comfort: 0,
            virtualMinutesOnFire: 5,
            virtualRateSecsPerSec: 0,
            expressionPresetId: 'moderate_pain'
        },
        continueOutcome: {
            hr: 119, sbp: 143, dbp: 95, rr: 26, spo2: 93,
            pain: 5, anxiety: 5, comfort: 0,
            virtualMinutesOnFire: 20,
            virtualRateSecsPerSec: 15,
            expressionPresetId: 'severe_pain'
        }
    }
};

function findBalancedBlock(source, marker) {
    const start = source.indexOf(marker);
    if (start === -1) return null;
    const braceStart = source.indexOf('{', start);
    if (braceStart === -1) return null;
    let depth = 0;
    for (let i = braceStart; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') depth -= 1;
        if (depth === 0) return source.slice(braceStart, i + 1);
    }
    return null;
}

function extractStage(scenarioId, stageId) {
    const scenarioBlock = findBalancedBlock(content, `${scenarioId}:`);
    if (!scenarioBlock) return null;
    const stageBlock = findBalancedBlock(scenarioBlock, `${stageId}:`);
    if (!stageBlock) return null;

    const values = {};
    const targets = stageBlock.match(/targets:\s*{([^}]+)}/);
    const subjective = stageBlock.match(/subjective:\s*{([^}]+)}/);
    for (const block of [targets, subjective]) {
        if (!block) continue;
        block[1].split(',').forEach((pair) => {
            const [key, value] = pair.split(':').map((item) => item.trim());
            if (key) values[key] = Number(value);
        });
    }
    const minute = stageBlock.match(/virtualMinutesOnFire:\s*(\d+)/);
    const rate = stageBlock.match(/virtualRateSecsPerSec:\s*(\d+)/);
    const preset = stageBlock.match(/expressionPresetId:\s*'([^']+)'/);
    values.virtualMinutesOnFire = minute ? Number(minute[1]) : undefined;
    values.virtualRateSecsPerSec = rate ? Number(rate[1]) : undefined;
    values.expressionPresetId = preset ? preset[1] : undefined;
    return values;
}

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`✓ ${name}`);
        passed += 1;
        return;
    }
    console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
    failed += 1;
}

console.log('='.repeat(70));
console.log('Scenario Configuration Unit Tests');
console.log('='.repeat(70));

check('ScenarioController.js exists', fs.existsSync(scenarioControllerPath));
check('SCENARIOS object is defined', content.includes('const SCENARIOS = {'));
check('Scenario 1 is defined', content.includes('scenario_1: {'));
check('Scenario 2 is defined', content.includes('scenario_2: {'));

for (const [scenarioId, stages] of Object.entries(EXPECTED)) {
    for (const [stageId, expected] of Object.entries(stages)) {
        const actual = extractStage(scenarioId, stageId);
        check(`${scenarioId}.${stageId} exists`, !!actual);
        if (!actual) continue;
        for (const [key, expectedValue] of Object.entries(expected)) {
            check(
                `${scenarioId}.${stageId}.${key} = ${expectedValue}`,
                actual[key] === expectedValue,
                `actual ${actual[key]}`
            );
        }
    }
}

check('stage12 timer is 60 seconds', content.includes('scheduleStage12(60000)'));
check('outcome timer is 60 seconds', content.includes('scheduleOutcome(60000)'));
check('intermediate outcome timer is 30 seconds', content.includes('scheduleOutcome(30000)'));
check('F7 selects scenario_1', /event\.key\s*===\s*'F7'[\s\S]{0,200}selectScenario\('scenario_1'/.test(content));
check('F8 selects scenario_2', /event\.key\s*===\s*'F8'[\s\S]{0,200}selectScenario\('scenario_2'/.test(content));
check('F9 selects off', /event\.key\s*===\s*'F9'[\s\S]{0,200}selectScenario\('off'/.test(content));

const audioBasePath = path.join(__dirname, '../static/predefined_sound_track');
const voiceVariants = ['azure_man_8_tracks', 'azure_cantonese_oldman_8_tracks'];
for (const variant of voiceVariants) {
    for (let i = 1; i <= 8; i += 1) {
        const file = path.join(audioBasePath, variant, `soundtrack_0${i}.mp3`);
        check(`${variant}/soundtrack_0${i}.mp3 exists`, fs.existsSync(file));
    }
}

console.log('');
console.log(`RESULTS: ${passed}/${passed + failed} checks passed`);
process.exit(failed === 0 ? 0 : 1);
