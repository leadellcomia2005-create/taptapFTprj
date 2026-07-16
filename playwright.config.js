import { defineConfig } from "@playwright/test";

const localBrowserChannel = process.env.CI ? undefined : process.env.PLAYWRIGHT_CHANNEL || "msedge";
const clientOrigin = "http://127.0.0.1:4173";
const apiOrigin = "http://127.0.0.1:8181";
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "true";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: clientOrigin,
    browserName: "chromium",
    channel: localBrowserChannel,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: [
    {
      command: "npm run start --prefix server",
      url: `${apiOrigin}/api/status`,
      timeout: 60_000,
      reuseExistingServer,
      env: {
        ...process.env,
        PORT: "8181",
        CLIENT_ORIGIN: clientOrigin,
        FIREBASE_DATABASE_URL: "",
        FIREBASE_STORAGE_BUCKET: "",
        OPENAI_API_KEY: "",
        PAYMONGO_SECRET_KEY: "",
        TWILIO_ACCOUNT_SID: "",
        TWILIO_AUTH_TOKEN: ""
      }
    },
    {
      command: "npm run dev --prefix client -- --host 127.0.0.1 --port 4173 --mode e2e",
      url: clientOrigin,
      timeout: 60_000,
      reuseExistingServer,
      env: {
        ...process.env,
        VITE_API_BASE_URL: `${apiOrigin}/api`,
        VITE_SOCKET_URL: apiOrigin,
        VITE_ENABLE_DEMO_MODE: "true",
        VITE_ENABLE_FIREBASE_STORAGE: "false",
        VITE_DISABLE_FIREBASE: "true",
        VITE_FIREBASE_API_KEY: "",
        VITE_FIREBASE_PROJECT_ID: "",
        VITE_FIREBASE_DATABASE_URL: ""
      }
    }
  ]
});
