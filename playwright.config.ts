import { defineConfig, devices } from '@playwright/test'
import { randomUUID } from 'node:crypto'

// The e2e build uses an in-browser test backend (src/testing/e2eBackend.ts).
// Its single test user's password is generated per run; nothing is stored.
process.env.E2E_PASSWORD ??= `pw-${randomUUID()}`
const PORT = 4183

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_E2E: 'true',
      VITE_E2E_PASSWORD: process.env.E2E_PASSWORD,
    },
  },
})
