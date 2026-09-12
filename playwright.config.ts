import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: ["ui.spec.ts", "admin-visual.spec.ts"],
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4318",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:4318/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "4318",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgresql://radar@127.0.0.1:55432/radar_test",
    },
  },
});
