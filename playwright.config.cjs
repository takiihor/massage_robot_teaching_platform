/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 60000,
  expect: {
    timeout: 5000
  },
  use: {
    baseURL: process.env.TEST_URL || 'http://localhost:5000',
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

module.exports = config;
