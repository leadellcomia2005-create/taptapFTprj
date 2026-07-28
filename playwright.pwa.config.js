import { defineConfig } from "@playwright/test";

const localBrowserChannel = process.env.CI ? undefined : process.env.PLAYWRIGHT_CHANNEL || "msedge";
const clientOrigin = "http://127.0.0.1:4175";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "pwa.spec.js",
  outputDir: "./test-results/pwa",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: clientOrigin,
    browserName: "chromium",
    channel: localBrowserChannel,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run build --prefix client -- --mode e2e && npm run preview --prefix client -- --host 127.0.0.1 --port 4175 --strictPort",
    url: clientOrigin,
    timeout: 120_000,
    reuseExistingServer: false
  }
});
