import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const evidence = process.env.MISTSEA_EVIDENCE ?? "evidence/phase3_1";
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), "mistsea-production-"));
const output = openSync(join(evidence, "production-server.log"), "w");
const url = "http://127.0.0.1:3002";
const child = spawn(process.execPath, ["release/server/src/server/index.js"], {
  env: {
    PATH: process.env.PATH,
    PORT: "3002",
    HOST: "127.0.0.1",
    LLM_ENABLED: "false",
    MISTSEA_SAVE: join(directory, "valley.sqlite"),
  },
  stdio: ["ignore", output, output],
});
let browser;

try {
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null)
          throw Error(
            `Compiled server exited ${child.exitCode}; see production-server.log`,
          );
        try {
          return (await fetch(`${url}/health`)).json();
        } catch {
          return null;
        }
      },
      { timeout: 10000 },
    )
    .toMatchObject({
      status: "ok",
      phase: 3,
      schemaVersion: 3,
      contentVersion: 1,
    });
  browser = await chromium.launch({
    chromiumSandbox: true,
    ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (
      new URL(request.url()).origin !== url &&
      !request.url().startsWith("data:")
    )
      errors.push(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(url);
  const stage = page.locator("#game");
  await expect(stage).toHaveAttribute("data-ready", "true");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("#objective")).toHaveText("修复雾灯旧桥");
  const initial = Number(await stage.getAttribute("data-x"));
  await page.keyboard.down("d");
  try {
    await expect
      .poll(async () => Number(await stage.getAttribute("data-x")))
      .toBeGreaterThan(initial + 10);
  } finally {
    await page.keyboard.up("d");
  }
  await expect(stage).toHaveAttribute("data-moving", "false");
  await page.screenshot({
    path: join(evidence, "scene-production.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS: compiled Fastify, SQLite, WebSocket, local assets and keyboard movement without API keys.",
  );
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null && child.signalCode === null) {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
  closeSync(output);
  rmSync(directory, { recursive: true, force: true });
}
