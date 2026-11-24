import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
const child = spawn(process.execPath, ["release/server/src/server/index.js"], {
  env: { ...process.env, PORT: "3002", HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
let browser;
try {
  const deadline = Date.now() + 15000;
  while (true) {
    if (child.exitCode !== null) throw Error("Server exited " + child.exitCode);
    try {
      const r = await fetch("http://127.0.0.1:3002/health");
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw Error("Startup timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("http://127.0.0.1:3002/");
  await page.waitForFunction(() => window.__PHASE0__?.ready);
  await page.waitForSelector("#asset-status");
  await page.screenshot({
    path: "evidence/scene-production.png",
    fullPage: true,
  });
  const state = await page.evaluate(() => window.__PHASE0__);
  if (state.assetsLoaded !== 13 || errors.length)
    throw Error(JSON.stringify({ state, errors }));
  console.log(
    "PASS: compiled client + Fastify static server + SQLite health + 13 assets, no browser errors.",
  );
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
  writeFileSync("evidence/production-server.log", log);
}
