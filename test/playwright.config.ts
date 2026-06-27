// test/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // single shared DB - avoid races across tests
  workers: 1,           // avoid port contention / DB race
  reporter: 'line',
  use: {
    // The playwright container shares the app container's network namespace
    // (network_mode: service:app in the compose file), so the app is reachable
    // on loopback. We MUST use 127.0.0.1, not the service name 'app': Chrome
    // force-upgrades non-loopback origins http->https, and the app speaks plain
    // HTTP only. Loopback is the one origin Chrome never auto-upgrades.
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});