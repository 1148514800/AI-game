import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  distance,
  nearbyTarget,
  mapWidth,
  speed,
  valley,
  type Point,
  type Target,
} from "../src/shared/world.js";
import { route } from "./paths.js";

const evidence = process.env.MISTSEA_EVIDENCE ?? "evidence/phase3_1";
const backendUrl = "http://127.0.0.1:3003";

const test = base.extend<{
  backend: { start: () => Promise<void>; stop: () => Promise<void> };
}>({
  backend: [
    async ({}, use, info) => {
      mkdirSync(evidence, { recursive: true });
      const directory = mkdtempSync(join(tmpdir(), "mistsea-browser-"));
      const log = openSync(
        join(
          evidence,
          `e2e-service-${info.title.replace(/[^a-zA-Z0-9]+/g, "-")}.log`,
        ),
        "w",
      );
      let child: ChildProcess | undefined;
      async function start() {
        child = spawn(
          process.execPath,
          ["--import", "tsx", "src/server/index.ts"],
          {
            env: {
              PATH: process.env.PATH,
              LLM_ENABLED: "false",
              HOST: "127.0.0.1",
              PORT: "3003",
              MISTSEA_SAVE: join(directory, "valley.sqlite"),
            },
            stdio: ["ignore", log, log],
          },
        );
        await expect
          .poll(
            async () => {
              if (child?.exitCode !== null)
                throw Error(`Backend exited: ${child?.exitCode}`);
              try {
                return (await fetch(`${backendUrl}/health`)).status;
              } catch {
                return 0;
              }
            },
            { timeout: 8000 },
          )
          .toBe(200);
      }
      async function stop() {
        if (child && child.exitCode === null && child.signalCode === null) {
          const exit = once(child, "exit");
          child.kill("SIGTERM");
          await exit;
        }
        child = undefined;
      }
      try {
        await start();
        await use({ start, stop });
      } finally {
        await stop();
        closeSync(log);
        rmSync(directory, { recursive: true, force: true });
      }
    },
    { auto: true },
  ],
});

const ready = (page: Page) =>
  expect(page.locator("#game")).toHaveAttribute("data-ready", "true", {
    timeout: 12000,
  });
const bag = (page: Page, item: string) => page.locator(`[data-item="${item}"]`);
const progress = (page: Page) =>
  page.locator("#progress").evaluate((el: HTMLProgressElement) => el.value);
const position = (page: Page) =>
  page
    .locator("#game")
    .evaluate((el) => ({ x: Number(el.dataset.x), y: Number(el.dataset.y) }));
const screenshot = (page: Page, basename: string) =>
  page.screenshot({ path: join(evidence, `${basename}.png`), fullPage: true });

async function waitStill(page: Page) {
  await expect(page.locator("#game")).toHaveAttribute("data-moving", "false");
}

async function walk(page: Page, goal: (p: Point) => boolean, repaired = false) {
  const npc = await page.locator("#game").evaluate((el) => ({
    x: Number(el.dataset.cenyanX),
    y: Number(el.dataset.cenyanY),
  }));
  const steps = route(await position(page), goal, repaired, [npc]);
  for (const step of steps) {
    const axis = step.axis;
    const value = step[axis];
    const current = (await position(page))[axis];
    const sign = Math.sign(value - current);
    if (Math.abs(value - current) <= 2) continue;
    const key = axis === "x" ? (sign > 0 ? "d" : "a") : sign > 0 ? "s" : "w";
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        ({ axis, value, sign }) => {
          const current = Number(
            document.getElementById("game")!.dataset[axis],
          );
          return (current - value) * sign >= -1.7;
        },
        { axis, value, sign },
        { timeout: 2200 + (Math.abs(value - current) * 1000) / speed },
      );
    } finally {
      await page.keyboard.up(key);
    }
  }
  await waitStill(page);
}

async function approach(page: Page, target: Target, repaired = false) {
  await walk(
    page,
    (p) =>
      distance(p, target) <= target.range - 8 &&
      nearbyTarget(p)?.id === target.id,
    repaired,
  );
  expect(distance(await position(page), target)).toBeLessThan(target.range);
  await expect(page.locator("#target")).toHaveText(target.name);
}

test("fresh journey collects all materials, repairs, crosses, explores and restores", async ({
  page,
  backend,
}) => {
  const external: string[] = [];
  const errors: string[] = [];
  const initialMissing: string[] = [];
  let restarting = false;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:5174" && url.protocol !== "data:")
      external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !restarting) errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !restarting)
      initialMissing.push(response.url());
  });
  await page.goto("/");
  await ready(page);
  await expect(bag(page, "wood")).toHaveText("0");
  await expect(bag(page, "stone")).toHaveText("0");
  await expect(page.locator("#music")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("canvas")).toBeVisible();
  const colors = await page
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set<number>();
      for (let i = 0; i < pixels.length; i += 4)
        colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
      return colors.size;
    });
  expect(colors).toBeGreaterThan(80);
  await screenshot(page, "scene-desktop");
  await page.getByRole("button", { name: "全谷地图" }).click();
  await screenshot(page, "valley-overview");
  await page.getByRole("button", { name: "返回场景" }).click();

  for (const resident of valley.residents) {
    await approach(page, resident);
    await page.keyboard.press("e");
    await expect(page.locator("#feedback")).toHaveText(resident.intro);
    await expect(page.locator("#feedback-icon")).toHaveAttribute(
      "src",
      `/assets/${resident.asset}-face.png`,
    );
    await screenshot(page, `resident-${resident.id}`);
    if (resident.id === "cenyan") {
      await expect(page.getByRole("dialog", { name: "岑砚" })).toBeVisible();
      await expect(page.locator("#dialogue-mode")).toContainText("模拟");
      await page.getByRole("button", { name: "关闭对话" }).click();
    }
  }
  await approach(page, valley.bridge);
  await page.keyboard.press("e");
  await expect(page.locator("#feedback")).toContainText(
    "旧桥需要木材 6、石材 2",
  );
  await page.getByRole("button", { name: "交付材料" }).click();
  await expect(page.locator("#feedback")).toContainText("材料不足");
  await expect(page.locator("#bridge-wood")).toHaveText("0 / 6");
  await walk(page, (p) => p.x > 432 && p.x < 453 && Math.abs(p.y - 368) <= 4.1);
  await page.keyboard.down("d");
  await expect.poll(async () => (await position(page)).x).toBeGreaterThan(450);
  await page.waitForTimeout(1050);
  await page.keyboard.up("d");
  await waitStill(page);
  expect((await position(page)).x).toBeLessThan(461);
  await screenshot(page, "bridge-before");

  let wood = 0;
  let stone = 0;
  for (const resource of valley.resources.slice(0, 8)) {
    await approach(page, resource);
    await page.keyboard.press("e");
    const amount = resource.item === "wood" ? ++wood : ++stone;
    await expect(bag(page, resource.item)).toHaveText(String(amount));
    await expect(page.locator("#feedback")).toContainText("已放入背包");
    if (wood === 1 && stone === 0) {
      await screenshot(page, "collection");
      const checkpoint = await position(page);
      await page.reload();
      await ready(page);
      await expect(bag(page, "wood")).toHaveText("1");
      expect(distance(await position(page), checkpoint)).toBeLessThan(1);
      await page.keyboard.press("e");
      await expect(page.locator("#feedback")).toContainText("恢复");
      await expect(bag(page, "wood")).toHaveText("1");
    }
  }
  expect({ wood, stone }).toEqual({ wood: 6, stone: 2 });
  await screenshot(page, "inventory");

  await approach(page, valley.bridge);
  await page.getByRole("button", { name: "交付材料" }).click();
  await expect(page.locator("#bridge-wood")).toHaveText("6 / 6");
  await expect(page.locator("#bridge-stone")).toHaveText("2 / 2");
  await expect(bag(page, "wood")).toHaveText("0");
  await expect(bag(page, "stone")).toHaveText("0");
  await page.getByRole("button", { name: "开始施工" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(9);
  await screenshot(page, "construction");
  restarting = true;
  await backend.stop();
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  await expect(page.locator("#screen-detail")).toContainText(/重试|恢复/);
  await backend.start();
  await ready(page);
  const persisted = await progress(page);
  expect(persisted).toBeGreaterThan(9);
  expect(persisted).toBeLessThan(50);
  await expect(page.locator("#bridge-wood")).toHaveText("6 / 6");
  await expect(page.locator("#game")).toHaveAttribute("data-working", "false");
  await page.getByRole("button", { name: "开始施工" }).click();
  await expect(page.locator("#objective")).toHaveText("查看航标遗迹", {
    timeout: 20000,
  });
  expect(await progress(page)).toBe(100);
  await screenshot(page, "bridge-after");

  await approach(page, valley.ruin, true);
  expect((await position(page)).x).toBeGreaterThan(600);
  await page.getByRole("button", { name: "查看航标" }).click();
  await expect(page.locator("#objective")).toHaveText("旅程完成");
  await expect(page.locator("#feedback")).toHaveText(valley.ruin.clue);
  await screenshot(page, "beacon-ruin");
  const end = await position(page);
  await page.reload();
  await ready(page);
  await expect(page.locator("#objective")).toHaveText("旅程完成");
  expect(distance(await position(page), end)).toBeLessThan(1);
  await backend.stop();
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  await backend.start();
  await ready(page);
  await expect(page.locator("#objective")).toHaveText("旅程完成");
  await expect(page.locator("#progress")).toHaveJSProperty("value", 100);
  expect(distance(await position(page), end)).toBeLessThan(1);

  await page.getByRole("button", { name: "重开旅程" }).click();
  await page.getByRole("button", { name: "继续当前旅程" }).click();
  await expect(page.locator("#objective")).toHaveText("旅程完成");
  await page.getByRole("button", { name: "重开旅程" }).click();
  await page.getByRole("button", { name: "确认重开" }).click();
  await expect(page.locator("#objective")).toHaveText("修复雾灯旧桥");
  await expect(page.locator("#progress")).toHaveJSProperty("value", 0);
  expect(distance(await position(page), valley.spawn)).toBeLessThan(1);
  expect(errors).toEqual([]);
  expect(initialMissing).toEqual([]);
  expect(external).toEqual([]);
});

test("four-way walk frames, pause, a following camera and opt-in music", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const stage = page.locator("#game");
  // Use a real reachable open plaza, not the tree beside the spawn. Frequent
  // observation prevents the test itself holding a key into a distant obstacle.
  await walk(page, (point) => distance(point, { x: 208, y: 376 }) <= 4);
  for (const [key, axis, sign, facing, column] of [
    ["d", "x", 1, "right", 3],
    ["s", "y", 1, "down", 0],
    ["a", "x", -1, "left", 2],
    ["w", "y", -1, "up", 1],
  ] as const) {
    const before = (await position(page))[axis];
    await page.keyboard.down(key);
    try {
      await expect
        .poll(async () => ((await position(page))[axis] - before) * sign, {
          intervals: [16, 25, 50],
        })
        .toBeGreaterThan(12);
      await expect(stage).toHaveAttribute("data-direction", facing);
      await expect(stage).toHaveAttribute("data-moving", "true");
      const frame = Number(await stage.getAttribute("data-frame"));
      expect(frame % 4).toBe(column);
      await expect
        .poll(async () => Number(await stage.getAttribute("data-frame")), {
          intervals: [16, 25, 50],
        })
        .not.toBe(frame);
    } finally {
      await page.keyboard.up(key);
    }
    await waitStill(page);
    await expect(stage).toHaveAttribute("data-frame", String(column));
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#screen-title")).toHaveText("旅程暂停");
  const paused = await position(page);
  await page.keyboard.down("d");
  await page.waitForTimeout(250);
  await page.keyboard.up("d");
  expect(await position(page)).toEqual(paused);
  await page.keyboard.press("Escape");
  await approach(page, valley.bridge);
  await expect
    .poll(async () => Number(await stage.getAttribute("data-camera-x")))
    .toBeGreaterThan(100);
  const cameraX = Number(await stage.getAttribute("data-camera-x"));
  const viewWidth = await page
    .locator("canvas")
    .evaluate((element: HTMLCanvasElement) => element.width);
  expect(cameraX + viewWidth).toBeLessThanOrEqual(mapWidth + 1);
  await page.getByRole("button", { name: "音乐关" }).click();
  await expect(page.getByRole("button", { name: "音乐开" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "音乐开" }).click();
  await expect(page.getByRole("button", { name: "音乐关" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("390px narrow window renders the scene, residents and touch controls", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await ready(page);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator("#residents img")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "向右" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await screenshot(page, "scene-narrow");
  } finally {
    await context.close();
  }
});

test("missing bridge art blocks readiness with a clear error", async ({
  page,
}) => {
  await page.route("**/assets/bridge-open.png", (request) =>
    request.fulfill({ status: 404, body: "asset removed by test" }),
  );
  await page.goto("/");
  await expect(page.locator("#screen-title")).toHaveText("游戏素材加载失败");
  await expect(page.locator("#screen-detail")).toContainText("bridge-open");
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  await expect(page.locator("#interact")).toBeDisabled();
  await screenshot(page, "asset-failure");
});

test("HTTP failure stays unavailable and automatically recovers", async ({
  page,
}) => {
  await page.route("**/health", (request) =>
    request.fulfill({ status: 502, body: "backend unavailable" }),
  );
  await page.goto("/");
  await expect(page.locator("#screen-detail")).toContainText(
    "HTTP 服务无法连接",
  );
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  await page.unroute("**/health");
  await ready(page);
});

test("WebSocket handshake failure remains visible and prevents input", async ({
  page,
}) => {
  await page.routeWebSocket("**/ws", (socket) =>
    socket.close({ code: 1011, reason: "offline test" }),
  );
  await page.goto("/");
  await expect(page.locator("#screen-detail")).toContainText(
    "WebSocket 连接失败",
  );
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "false");
  await expect(page.locator("#interact")).toBeDisabled();
});

test("the real server rejects augmented movement and out-of-range actions", async () => {
  const socket = new WebSocket("ws://127.0.0.1:3003/ws");
  const messages: Array<{
    type: string;
    code?: string;
    state?: { player: Point };
  }> = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  try {
    await once(socket, "open");
    await expect.poll(() => messages[0]?.type).toBe("snapshot");
    socket.send(
      JSON.stringify({
        type: "move",
        dx: 1,
        dy: 0,
        x: 654,
        y: 303,
        timestamp: Date.now(),
      }),
    );
    await expect
      .poll(() => messages.find((m) => m.code === "INVALID_MESSAGE")?.type)
      .toBe("error");
    socket.send(
      JSON.stringify({
        type: "action",
        id: randomUUID(),
        target: valley.ruin.id,
        verb: "inspect",
      }),
    );
    await expect
      .poll(() => messages.find((m) => m.code === "TOO_FAR")?.type)
      .toBe("result");
    for (const message of messages.filter((m) => m.type === "snapshot")) {
      expect(message.state?.player).toMatchObject({
        x: valley.spawn.x,
        y: valley.spawn.y,
      });
    }
  } finally {
    socket.terminate();
  }
});
