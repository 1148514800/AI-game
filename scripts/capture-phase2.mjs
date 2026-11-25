// Additional clean, normal keyboard/UI product capture; not a Live model test.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, openSync, closeSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { route } from "../tests/paths.ts";
import { valley, distance, nearbyTarget, speed } from "../src/shared/world.ts";
const out = process.env.MISTSEA_EVIDENCE ?? "evidence/phase2/visual-review-final";
mkdirSync(out, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), "mistsea-phase2-visual-"));
const log = openSync(join(out, "production-dialogue-server.log"), "w");
const server = spawn(process.execPath, ["release/server/src/server/index.js"], {
  env: { PATH: process.env.PATH, HOST: "127.0.0.1", PORT: "3006", MISTSEA_SAVE: join(dir, "world.sqlite"), LLM_ENABLED: "false", LLM_MOCK_DELAY_MS: "1600" },
  stdio: ["ignore", log, log],
});
const done = once(server, "close");
let browser;
try {
  await expect.poll(async () => (await fetch("http://127.0.0.1:3006/health").catch(() => null))?.status, { timeout: 8000 }).toBe(200);
  browser = await chromium.launch({ channel: "chromium", headless: true, chromiumSandbox: true, ignoreDefaultArgs: ["--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:3006/");
  const stage = page.locator("#game");
  await expect(stage).toHaveAttribute("data-ready", "true", { timeout: 12000 });
  const pos = () => stage.evaluate(el => ({ x: Number(el.dataset.x), y: Number(el.dataset.y) }));
  const npc = valley.residents.find(n => n.id === "cenyan");
  for (const stop of route(await pos(), p => distance(p, npc) <= npc.range - 8 && nearbyTarget(p)?.id === npc.id, false)) {
    const axis = stop.axis, value = stop[axis], start = (await pos())[axis], sign = Math.sign(value - start);
    if (Math.abs(value - start) <= 2) continue;
    const key = axis === "x" ? (sign > 0 ? "d" : "a") : (sign > 0 ? "s" : "w");
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(({ axis, value, sign }) => (Number(document.getElementById("game").dataset[axis]) - value) * sign >= -1.7,
        { axis, value, sign }, { timeout: 2200 + Math.abs(value - start) * 1000 / speed });
    } finally { await page.keyboard.up(key); }
  }
  await expect(stage).toHaveAttribute("data-moving", "false");
  await page.keyboard.press("e");
  await expect(page.locator("#cenyan-dialogue")).toBeVisible();
  await expect(page.locator("#dialogue-mode")).toContainText("Mock");
  await page.locator("#dialogue-input").fill("岑砚，你现在有什么打算？");
  await page.locator("#dialogue-send").click();
  await expect(page.locator("#dialogue-pending")).toBeVisible();
  await page.screenshot({ path: join(out, "dialogue-clean-thinking.png"), fullPage: true });
  await expect(page.getByRole("log").locator("p")).toHaveCount(2);
  await page.locator("#dialogue-input").fill("你怎么看修旧桥？我应该先准备什么？");
  await page.locator("#dialogue-send").click();
  await expect(page.getByRole("log").locator("p")).toHaveCount(4);
  await expect(page.getByRole("log")).toContainText("旧桥未修通");
  await expect(page.locator("[data-item=wood]")).toHaveText("0");
  await page.screenshot({ path: join(out, "dialogue-clean-multiturn.png"), fullPage: true });
  await expect(page.locator("#progress")).toHaveJSProperty("value", 0);
  if (errors.length) throw Error(errors.join("; "));
  writeFileSync(join(out, "capture-results.json"), JSON.stringify({ mode: "Mock only; not a real model test", input: "normal keyboard/UI", world: "fresh isolated save; no state injection", completedTurns: 2, pageErrors: errors, exitCode: 0 }, null, 2) + "\n");
  console.log("PASS: clean two-turn production dialogue captured through ordinary keyboard/UI; Mock only.");
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) server.kill("SIGTERM");
  await done;
  closeSync(log);
  rmSync(dir, { recursive: true, force: true });
}
