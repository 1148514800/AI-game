import { defineConfig } from "@playwright/test";

const evidence = process.env.MISTSEA_EVIDENCE ?? "evidence/phase2";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.e2e.ts",
  workers: 1,
  timeout: 150000,
  outputDir: `${evidence}/playwright-artifacts`,
  reporter: [
    ["list"],
    ["json", { outputFile: `${evidence}/playwright-results.json` }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1280, height: 960 },
    headless: true,
    launchOptions: {
      chromiumSandbox: true,
      ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
    },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:client",
    env: { PORT: "3003", MISTSEA_VITE_PORT: "5174" },
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15000,
  },
});
