/** @type {import('@playwright/test').PlaywrightTestConfig} */
const fs = require('fs');
const path = require('path');

// Resolve the app's URL the same way start.sh does: TEST_URL wins, then $PORT,
// then PORT= in .env, then the documented default.  A hard-coded
// http://localhost:5000 ignored the configured PORT, so the suite pointed at a
// dead port whenever the app ran on anything other than 5000.
function resolveBaseURL() {
  if (process.env.TEST_URL) return process.env.TEST_URL;
  if (process.env.PORT) return `http://127.0.0.1:${process.env.PORT}`;
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const match = fs
      .readFileSync(envPath, 'utf8')
      .match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    if (match) return `http://127.0.0.1:${match[1]}`;
  }
  return 'http://127.0.0.1:5033';
}

const config = {
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 60000,
  expect: {
    timeout: 5000
  },
  use: {
    baseURL: resolveBaseURL(),
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 10000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  reporter: [
    ['list'],
    ['html', { open: 'never' }]
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium'
      }
    }
  ]
};

// Opt-in isolated test server. Existing TEST_URL deployments retain their
// usual behavior, while CI can run without a robot or cloud credentials.
if (process.env.TEST_START_SERVER === '1') {
  config.webServer = {
    command: 'python3 main.py',
    url: `${resolveBaseURL()}/health`,
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      HOST: '127.0.0.1',
      AUTO_CONNECT_RTDE: '0',
      MASSAGE_SIMULATION_MODE: '0',
      ENABLE_AZURE_SPEECH_STT: 'false',
      AZURE_SPEECH_KEY: '',
      AZURE_SPEECH_REGION: ''
    }
  };
}

module.exports = config;
