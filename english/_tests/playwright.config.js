import { defineConfig } from '@playwright/test';

/* Chromium is used because it implements MediaRecorder, getUserMedia with
   a fake device, and the Web Speech API surface we need. On platforms
   Playwright doesn't support yet, point PW_CHROMIUM_PATH to a local
   Chromium/Chrome binary. */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  /* inside _tests/: Quarto ignores it, so failure reports are never rendered into the site */
  outputDir: './results',
  timeout: 180000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/latent-frontiers/',
    permissions: ['microphone'],
    launchOptions: {
      executablePath,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
    }
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true }, grep: /@mobile/ }
  ],
  webServer: {
    command: 'node serve.js',
    url: 'http://127.0.0.1:4173/latent-frontiers/',
    reuseExistingServer: true,
    timeout: 20000
  }
});
