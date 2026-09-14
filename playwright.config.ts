import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    baseURL: 'http://127.0.0.1:5177',
    viewport: { width: 1280, height: 800 },
    timezoneId: 'Pacific/Auckland',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5177 --strictPort',
    url: 'http://127.0.0.1:5177',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
