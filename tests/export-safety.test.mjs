import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const SCRIPT = join(REPO, 'create_project_zip.sh');

// Build a throwaway fixture project containing FAKE secrets and runtime junk,
// run the export, and assert none of it lands in the archive. (Sec 17)
function buildFixture() {
    const root = mkdtempSync(join(tmpdir(), 'zipsafe-'));
    const proj = join(root, 'proj');
    mkdirSync(join(proj, 'robot'), { recursive: true });
    mkdirSync(join(proj, '.massage_state'), { recursive: true });
    mkdirSync(join(proj, 'venv'), { recursive: true });
    mkdirSync(join(proj, 'node_modules'), { recursive: true });
    mkdirSync(join(proj, '.git'), { recursive: true });
    mkdirSync(join(proj, 'certs'), { recursive: true });
    writeFileSync(join(proj, 'app.py'), 'print("ok")\n');
    writeFileSync(join(proj, 'README.md'), '# hi\n');
    writeFileSync(join(proj, '.env.example'), 'PORT=5033\n');      // allowed template
    writeFileSync(join(proj, '.env'), 'AZURE_SPEECH_KEY=FAKE_SECRET\n');
    writeFileSync(join(proj, '.env.local'), 'X=FAKE_SECRET2\n');
    writeFileSync(join(proj, 'server.key'), 'PRIVATEKEY\n');
    writeFileSync(join(proj, 'certs', 'tls.crt'), 'CERT\n');
    writeFileSync(join(proj, 'robot', 'calibration_data.json'), '{"point_a_pose":[1,2,3,4,5,6]}\n');
    writeFileSync(join(proj, '.massage_state', 'calibration_data.json'), '{"secret":"poses"}\n');
    writeFileSync(join(proj, 'venv', 'lib.py'), '#env\n');
    writeFileSync(join(proj, 'node_modules', 'pkg.js'), '#dep\n');
    writeFileSync(join(proj, '.git', 'config'), '[core]\n');
    writeFileSync(join(proj, 'server.log'), 'FAKE_LOG_LINE\n');
    writeFileSync(join(proj, 'massage_robot.pid'), '12345\n');
    return { root, proj };
}

function listArchive(zipPath) {
    return execFileSync('zipinfo', ['-1', zipPath], { encoding: 'utf8' });
}

test('project ZIP export excludes secrets and runtime state', () => {
    const { root, proj } = buildFixture();
    const out = join(root, 'out.zip');
    try {
        execFileSync('bash', [SCRIPT, proj, out], { stdio: 'pipe' });
        const listing = listArchive(out);
        const entries = listing.split('\n').filter(Boolean);
        // Match on whole archive paths, not loose substrings, so that an allowed
        // entry such as `proj/.env.example` cannot false-trigger a `.env` check.
        const forbidden = [
            'proj/.env',
            'proj/.env.local',
            'server.key',
            'certs/tls.crt',
            'robot/calibration_data.json',
            '.massage_state/calibration_data.json',
            'venv/',
            'node_modules/',
            '.git/',
            'server.log',
            'massage_robot.pid',
            'FAKE_LOG_LINE',
        ];
        const present = (needle) => {
            if (needle.endsWith('/')) {
                const dir = needle.slice(0, -1);
                return entries.some((e) => e.startsWith(needle) || e.startsWith(`proj/${needle}`) || e === dir || e === `proj/${dir}`);
            }
            return entries.some((e) => e === needle || e === `proj/${needle}` || e.endsWith(`/${needle}`));
        };
        for (const needle of forbidden) {
            assert.ok(!present(needle), `archive must NOT contain ${needle}`);
        }
        // Keep real source and the safe template, and prove the exact-secret
        // paths are gone even though a lookalike safe file survives.
        assert.ok(entries.includes('proj/app.py'), 'should keep app.py');
        assert.ok(entries.includes('proj/.env.example'), 'should keep .env.example template');
        assert.ok(!entries.includes('proj/.env'), '.env must be excluded even though .env.example is kept');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
