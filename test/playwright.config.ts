// test/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // single shared DB - avoid races across tests
  workers: 1,           // avoid port contention / DB race
  reporter: 'line',
  use: {
    // Compose service name, NOT localhost:8000. Sibling containers
    // reach each other by service name on the internal compose network.
    baseURL: process.env.BASE_URL ?? 'http://app:8000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Stop Chromium auto-upgrading the single-label `app` hostname
          // (compose service name) from http to https — the app serves
          // plain HTTP only and the upgrade causes ERR_SSL_PROTOCOL_ERROR.
          args: ['--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable'],
        },
      },
    },
  ],
});