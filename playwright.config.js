const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test_frontend/integration_test',
  timeout: 45000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test_frontend/test-results.json' }]
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'electron',
      testMatch: /.*main_window\.spec\.js/,
    },
    {
      name: 'chromium',
      testMatch: /.*sub_panels\.spec\.js/,
      use: {
        browserName: 'chromium',
      },
    },
    {
      name: 'sitl',
      testMatch: /.*sitl_validation\.spec\.js/,
    },
    {
      name: 'multi-vehicle',
      testMatch: /.*multi_vehicle_validation\.spec\.js/,
    },
  ],
});
