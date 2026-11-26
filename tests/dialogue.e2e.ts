import { test as base, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { route } from "./paths.js";
import { distance, speed, valley } from "../src/shared/world.js";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const evidence = process.env.MISTSEA_EVIDENCE ?? "evidence/phase3_1";
const url = "http://127.0.0.1:5174";
const test = base.extend<{
  mockEnv: Record<string, string>;
  gameBackend: void;
}>({
  mockEnv: [{ LLM_MOCK_DELAY_MS: "1700" }, { option: true }],
  gameBackend: [
    async ({ mockEnv }, use, info) => {
      mkdirSync(evidence, { recursive: true });
      const dir = mkdtempSync(join(tmpdir(), "mistsea-dialogue-browser-"));
      const log = openSync(
        join(evidence, `dialogue-server-${info.line}.log`),
        "w",
      );
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/server/index.ts"],
        {
          env: {
            PATH: process.env.PATH,
            ...mockEnv,
            LLM_ENABLED: "false",
            HOST: "127.0.0.1",
            PORT: "3003",
            MISTSEA_SAVE: join(dir, "world.sqlite"),
          },
          stdio: ["ignore", log, log],
        },
      );
      try {
        await expect
          .poll(
            async () => {
              if (child.exitCode !== null)
                throw Error(`Backend exited ${child.exitCode}`);
              const response = await fetch("http://127.0.0.1:3003/health", {
                signal: AbortSignal.timeout(400),
              }).catch(() => null);
              return response?.status;
            },
            { timeout: 8000 },
          )
          .toBe(200);
        await use();
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const done = once(child, "close");
          child.kill("SIGTERM");
          await done;
        }
        closeSync(log);
        rmSync(dir, { recursive: true, force: true });
      }
    },
    { auto: true },
  ],
});


const panel = (page: Page) => page.getByRole("dialog", { name: "岑砚" });
const input = (page: Page) => page.getByRole("textbox", { name: "对岑砚说" });
const chat = (page: Page) => page.getByRole("log");
const shoot = (page: Page, name: string) =>
  page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });

async function approach(page: Page) {
  const stage = page.locator("#game");
  await expect(stage).toHaveAttribute("data-ready", "true");
  await expect(panel(page)).toBeHidden();
  for (const [key, axis, sign, target] of [
    ["d", "x", 1, 247],
    ["w", "y", -1, 321],
  ] as const) {
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        ({ axis, sign, target }) =>
          (Number(document.querySelector<HTMLElement>("#game")!.dataset[axis]) -
            target) *
            sign >=
          0,
        { axis, sign, target },
        { timeout: 3500 },
      );
    } finally {
      await page.keyboard.up(key);
    }
    await expect(stage).toHaveAttribute("data-moving", "false");
  }
  await expect(page.locator("#target")).toHaveText("岑砚");
}

test("ordinary E opens offline dialogue, handles candidate Enter, exchanges safe Chinese text and keeps rendering", async ({
  page,
}) => {
  await page.goto(url);
  await approach(page);
  await page.keyboard.press("e");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator("#dialogue-mode")).toHaveText("模拟对话 · Mock");
  await shoot(page, "dialogue");
  const stage = page.locator("#game");
  await input(page).pressSequentially("wasde");
  await expect(input(page)).toHaveValue("wasde");
  await expect(stage).toHaveAttribute("data-moving", "false");

  await input(page).fill("我想看看漏雨的屋顶 <img src=x onerror=alert(1)>");
  await input(page).dispatchEvent("compositionstart");
  await input(page).press("Enter");
  await expect(chat(page).locator("p")).toHaveCount(0);
  await input(page).evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(chat(page).locator("p")).toHaveCount(0);
  await page.waitForTimeout(90);
  await input(page).press("Enter");
  await expect(page.locator("#dialogue-pending")).toBeVisible();
  await shoot(page, "dialogue-thinking");
  const cameraBefore = await stage.getAttribute("data-camera-x");
  await page.getByRole("button", { name: "全谷地图" }).click();
  await expect(stage).not.toHaveAttribute("data-camera-x", cameraBefore!);
  await expect(stage.locator("canvas")).toBeVisible();
  await expect(panel(page)).toBeVisible();
  await expect(chat(page)).toContainText("我家的屋顶漏雨");
  await page.getByRole("button", { name: "返回场景" }).click();

  await input(page).fill("刚才我说了什么？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(chat(page).locator("p")).toHaveCount(4);
  await expect(chat(page)).toContainText("你刚才提到");
  await expect(chat(page)).toContainText("<img src=x onerror=alert(1)>");
  await expect(chat(page).locator("img")).toHaveCount(0);
  await expect(page.locator("[data-item=wood]")).toHaveText("0");
  await expect(page.locator("#progress")).toHaveJSProperty("value", 0);
  await shoot(page, "dialogue-multiturn");

  await input(page).fill("修桥之前怎么准备？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator("#dialogue-pending")).toBeVisible();
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator("#screen-title")).toHaveText("旅程暂停");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: /与岑砚交谈/ }).click();
  await expect(chat(page).locator("p")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭对话" }).click();
  const start = Number(await stage.getAttribute("data-y"));
  await page.keyboard.down("s");
  try {
    await expect
      .poll(async () => Number(await stage.getAttribute("data-y")))
      .toBeGreaterThan(start + 12);
  } finally {
    await page.keyboard.up("s");
  }
  await shoot(page, "scene-optimized");
});

test.describe("limited Mock", () => {
  test.use({
    mockEnv: { LLM_MOCK_DELAY_MS: "150", LLM_MAX_TOTAL_REQUESTS: "1" },
  });
  test("390px dialogue fits and exposes budget failure with a manual retry", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await page.goto(url);
      await approach(page);
      await page.getByRole("button", { name: /与岑砚交谈/ }).click();
      await expect(panel(page)).toBeVisible();
      const box = await panel(page).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      await shoot(page, "dialogue-narrow");
      await input(page).fill("旧桥已经好了吧？");
      await page.getByRole("button", { name: "发送" }).click();
      await expect(chat(page)).toContainText("旧桥未修通");
      await input(page).fill("现在可以再问吗");
      await page.getByRole("button", { name: "发送" }).click();
      await expect(page.locator("#dialogue-error")).toContainText("额度已用完");
      await expect(
        page.getByRole("button", { name: "重试这条消息" }),
      ).toBeVisible();
      await shoot(page, "dialogue-budget");
      await page.getByRole("button", { name: "重试这条消息" }).click();
      await expect(page.locator("#dialogue-error")).toContainText("额度已用完");
      await expect(chat(page).locator("p")).toHaveCount(3);
    } finally {
      await context.close();
    }
  });
});

test.describe("faulted Mock", () => {
  test.use({ mockEnv: { LLM_TIMEOUT_MS: "200", LLM_MOCK_FAILURE: "timeout" } });
  test("timeout is visible and manual retry remains Mock", async ({ page }) => {
    await page.goto(url);
    await approach(page);
    await page.keyboard.press("e");
    await input(page).fill("你好，岑砚");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.locator("#dialogue-error")).toContainText("等候回复超时");
    await expect(page.locator("#dialogue-mode")).toContainText("Mock");
    await shoot(page, "dialogue-failure");
    await page.getByRole("button", { name: "重试这条消息" }).click();
    await expect(page.locator("#dialogue-error")).toContainText("等候回复超时");
    await expect(chat(page).locator("p")).toHaveCount(1);
  });
});

test.describe("Phase 3 offline action request", () => {
  test.use({ mockEnv: { LLM_MOCK_DELAY_MS: "300" } });

  test("natural request accepts a plan and the actor actually harvests after the dialogue closes", async ({
    page,
  }) => {
    await page.goto(url);
    await approach(page);
    await page.keyboard.press("e");
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole("button", { name: "请岑砚修桥" }).click();
    await expect(input(page)).not.toHaveValue("");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(chat(page)).toContainText("计划已接受，等待规则执行。");
    await shoot(page, "phase3-action-accepted");
    const close = panel(page).getByRole("button", { name: "关闭对话" });
    if (await close.isVisible()) await close.click();
    await page.locator("#cenyan-debug summary").click();
    await expect(page.locator("#cenyan-bag")).toHaveText("木材 1 · 石材 0", {
      timeout: 15000,
    });
    await expect(page.locator("[data-item=wood]")).toHaveText("0");
    await expect(page.locator("#cenyan-memory")).toContainText("旅人声称");
    await expect(page.locator("#cenyan-memory")).toContainText("规则事实");
    await shoot(page, "phase3-action-harvest");
  });
});

test.describe("Phase 3 autonomous Mock journey", () => {
  test.use({
    mockEnv: {
      LLM_MOCK_AUTONOMY_ENABLED: "true",
      LLM_MOCK_DELAY_MS: "180",
      LLM_AUTONOMY_REQUESTS_PER_MINUTE: "20",
      LLM_MAX_REQUESTS_PER_MINUTE: "24",
    },
  });

  test("fresh actor walks and visibly supplies and repairs the bridge, with folded responsive debug", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    const stage = page.locator("#game");
    await expect(stage).toHaveAttribute("data-ready", "true");
    await expect(page.locator("#cenyan-debug")).not.toHaveAttribute("open", "");
    await page.locator("#cenyan-debug summary").click();
    await expect(page.locator("#cenyan-status")).toContainText("Mock 模拟");
    await expect(stage).toHaveAttribute("data-cenyan-activity", "moving", {
      timeout: 10000,
    });
    const frame = await stage.getAttribute("data-cenyan-frame");
    await expect(stage).not.toHaveAttribute("data-cenyan-frame", frame!);
    await shoot(page, "phase3-npc-moving");
    await page.getByRole("button", { name: "全谷地图", exact: true }).click();
    await expect(page.locator("#cenyan-bag")).toHaveText("木材 1 · 石材 0");
    await expect(page.locator("#cenyan-memory")).toContainText("获得 木材");
    await shoot(page, "phase3-npc-collected");
    await page.getByRole("button", { name: "返回场景", exact: true }).click();
    const position = () =>
      stage.evaluate((el) => ({
        x: Number(el.dataset.x),
        y: Number(el.dataset.y),
      }));
    // Reach a west-bank viewing point with ordinary keys, routing around the
    // existing buildings rather than holding D into Luozhou's house.
    const steps = route(
      await position(),
      (point) =>
        point.x >= 390 &&
        distance(point, valley.bridge) <= 80 &&
        distance(point, valley.bridge) >= 45,
      false,
    );
    for (const step of steps) {
      const axis = step.axis;
      const target = step[axis];
      const delta = target - (await position())[axis];
      if (Math.abs(delta) <= 2) continue;
      const sign = Math.sign(delta);
      const key = axis === "x" ? (sign > 0 ? "d" : "a") : sign > 0 ? "s" : "w";
      await page.keyboard.down(key);
      try {
        await page.waitForFunction(
          ({ axis, target, sign }) =>
            (Number(document.getElementById("game")!.dataset[axis]) - target) *
              sign >=
            -1.7,
          { axis, target, sign },
          { timeout: 2200 + (Math.abs(delta) * 1000) / speed },
        );
      } finally {
        await page.keyboard.up(key);
      }
    }
    await expect(page.locator("#bridge-wood")).toHaveText("6 / 6", {
      timeout: 85_000,
    });
    await expect(page.locator("#bridge-stone")).toHaveText("2 / 2");
    await shoot(page, "phase3-npc-delivered");
    await expect(stage).toHaveAttribute("data-cenyan-activity", "working");
    await expect
      .poll(() =>
        page
          .locator("#progress")
          .evaluate((element: HTMLProgressElement) => element.value),
      )
      .toBeGreaterThan(0);
    await shoot(page, "phase3-npc-building");
    await expect(page.locator("#percent")).toHaveText("100%", {
      timeout: 20_000,
    });
    await expect(page.locator("#objective")).toHaveText("查看航标遗迹");
    await expect(page.locator("[data-item=stone]")).toHaveText("0");
    await expect(page.locator("#cenyan-memory")).toContainText("旧桥已修通");
    await shoot(page, "phase3-npc-bridge-restored");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
    await page.locator("#cenyan-debug").scrollIntoViewIfNeeded();
    await shoot(page, "phase3-npc-debug-narrow");
    expect(errors).toEqual([]);
  });
});
