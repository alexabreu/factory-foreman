import process from 'node:process'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  reporter: [ [ 'list' ], [ 'junit', { outputFile: 'test-results/e2e.xml' } ], [ 'json', { outputFile: 'test-results/e2e.json' } ] ],
  use: {
    baseURL: 'http://localhost:4173',
    video: 'retain-on-failure',
    // A machine with its own Chromium (a sandbox, a dev container) can point at it.
    launchOptions: { executablePath: process.env.SAMPLE_TARGET_CHROMIUM || undefined },
  },
  webServer: { command: 'pnpm dev', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
})
