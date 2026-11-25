import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";
import { route } from "../../tests/paths.js";
import {
  distance,
  nearbyTarget,
  speed,
  valley,
} from "../../src/shared/world.js";

export const viewport = { width: 1280, height: 960 };
export const durationMs = 5000;
export const warmupMs = 1000;
export const mockDelayMs = 8500;
export const launchOptions = {
  channel: "chromium",
  headless: true,
  chromiumSandbox: true,
  // This is a default switch in the locked Playwright release.
  ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
  timeout: 7000,
};
export const launchBrowser = (env: Record<string, string>) =>
  chromium.launch({ ...launchOptions, env });

export type Scenario =
  "idle" | "movement" | "construction" | "dialogue-pending";
export type MockUi = {
  input: string;
  send: string;
  pending: string;
  mockBadge: string;
  delayEnv: string;
};

export async function probeRenderer(browser: Browser) {
  const page = await browser.newPage({ viewport });
  // tsx preserves nested function names with an esbuild helper absent in browser realms.
  await page.evaluate("globalThis.__name = (fn) => fn");
  try {
    const contexts = await page.evaluate(() => {
      const canvas = () => document.createElement("canvas");
      const webgl = (
        gl: WebGLRenderingContext | WebGL2RenderingContext | null,
      ) => {
        if (!gl) return null;
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          version: gl.getParameter(gl.VERSION) as string,
          renderer: gl.getParameter(gl.RENDERER) as string,
          unmaskedRenderer: info
            ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string)
            : null,
        };
      };
      return {
        canvas2d: Boolean(canvas().getContext("2d")),
        webgl: webgl(canvas().getContext("webgl")),
        experimentalWebgl: webgl(
          canvas().getContext(
            "experimental-webgl",
          ) as WebGLRenderingContext | null,
        ),
        webgl2: webgl(canvas().getContext("webgl2")),
      };
    });
    const session = await browser.newBrowserCDPSession();
    try {
      const { gpu } = await session.send("SystemInfo.getInfo");
      return {
        contexts,
        devices: gpu.devices,
        featureStatus: gpu.featureStatus,
      };
    } finally {
      await session.detach();
    }
  } finally {
    await page.close();
  }
}

type Renderer = {
  type: string;
  version?: string;
  unmaskedRenderer?: string | null;
};
declare global {
  interface Window {
    mistseaPerformanceContext?: (
      canvas: HTMLCanvasElement,
    ) => Renderer | undefined;
  }
}

export async function observeGameCanvas(page: Page) {
  await page.addInitScript("globalThis.__name = (fn) => fn;(" + (() => {
    const contexts = new WeakMap<
      HTMLCanvasElement,
      { kind: string; context: RenderingContext }
    >();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      attributes?: unknown,
    ) {
      const context = Reflect.apply(getContext, this, [
        kind,
        attributes,
      ]) as RenderingContext | null;
      if (context) contexts.set(this, { kind, context });
      return context;
    } as typeof getContext;
    window.mistseaPerformanceContext = (canvas) => {
      const entry = contexts.get(canvas);
      if (!entry) return;
      if (!("getParameter" in entry.context)) return { type: entry.kind };
      const gl = entry.context;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      if (gl.isContextLost()) throw Error("The game's WebGL context was lost.");
      return {
        type: entry.kind,
        version: gl.getParameter(gl.VERSION) as string,
        unmaskedRenderer: info
          ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string)
          : null,
      };
    };
  }).toString() + ")();");
}

const position = (page: Page) =>
  page
    .locator("#game")
    .evaluate((el) => ({ x: Number(el.dataset.x), y: Number(el.dataset.y) }));

async function approachCenyan(page: Page) {
  const resident = valley.residents.find(({ id }) => id === "cenyan");
  if (!resident) throw Error("Cenyan is missing from the map.");
  const steps = route(
    await position(page),
    (point) =>
      distance(point, resident) <= resident.range - 8 &&
      nearbyTarget(point)?.id === resident.id,
    false,
  );
  for (const step of steps) {
    const { axis } = step;
    const delta = step[axis] - (await position(page))[axis];
    if (Math.abs(delta) <= 2) continue;
    const sign = Math.sign(delta);
    const key = axis === "x" ? (sign > 0 ? "d" : "a") : sign > 0 ? "s" : "w";
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        ({ axis, target, sign }) => {
          const current = Number(
            document.getElementById("game")!.dataset[axis],
          );
          return (current - target) * sign >= -1.7;
        },
        { axis, target: step[axis], sign },
        { timeout: 2200 + (Math.abs(delta) * 1000) / speed },
      );
    } finally {
      await page.keyboard.up(key);
    }
  }
  await expect(page.locator("#target")).toHaveText(resident.name);
  await expect(page.locator("#game")).toHaveAttribute("data-moving", "false");
}

function captureFrames(page: Page, pendingSelector?: string) {
  return page.evaluate(
    ({ duration, pendingSelector }) => {
      const stage = document.querySelector<HTMLElement>("#game")!;
      const progress =
        document.querySelector<HTMLProgressElement>("#progress")!;
      function state() {
        const pending = pendingSelector
          ? document.querySelector(pendingSelector)
          : null;
        return {
          visible: document.visibilityState === "visible",
          ready: stage.dataset.ready === "true",
          x: Number(stage.dataset.x),
          y: Number(stage.dataset.y),
          moving: stage.dataset.moving === "true",
          working: stage.dataset.working === "true",
          progressPercent: progress.value,
          pending: Boolean(
            pending?.getClientRects().length &&
            getComputedStyle(pending).visibility === "visible",
          ),
        };
      }
      return new Promise<{
        startEpochMs: number;
        endEpochMs: number;
        frameTimesMs: number[];
        start: ReturnType<typeof state>;
        end: ReturnType<typeof state>;
      }>((resolve, reject) => {
        const frameTimesMs: number[] = [];
        let first: number;
        let previous: number;
        let start: ReturnType<typeof state>;
        let request: number;
        const timer = setTimeout(() => {
          cancelAnimationFrame(request);
          reject(
            Error(
              "The rendered page did not deliver five seconds of RAF timestamps before timeout.",
            ),
          );
        }, duration + 3000);
        function frame(timestamp: number) {
          if (first === undefined) {
            first = timestamp;
            start = state();
          } else {
            frameTimesMs.push(timestamp - previous);
          }
          previous = timestamp;
          if (timestamp - first < duration) {
            request = requestAnimationFrame(frame);
            return;
          }
          clearTimeout(timer);
          resolve({
            startEpochMs: performance.timeOrigin + first,
            endEpochMs: performance.timeOrigin + timestamp,
            frameTimesMs,
            start,
            end: state(),
          });
        }
        request = requestAnimationFrame(frame);
      });
    },
    { duration: durationMs, pendingSelector },
  );
}

export async function samplePage(
  page: Page,
  scenario: Scenario,
  screenshotPath: string,
  mockUi?: MockUi,
) {
  const stage = page.locator("#game");
  const canvas = stage.locator("canvas");
  await expect(stage).toHaveAttribute("data-ready", "true", { timeout: 8000 });
  await expect(canvas).toBeVisible();
  const renderer = await canvas.evaluate((el) =>
    window.mistseaPerformanceContext?.(el as HTMLCanvasElement),
  );
  if (!renderer)
    throw Error("No actual rendering context was observed on the game canvas.");
  await page.getByRole("button", { name: "音效开", exact: true }).click();
  if (scenario === "dialogue-pending") await approachCenyan(page);
  await delay(warmupMs);

  if (scenario === "construction") {
    await page.getByRole("button", { name: "开始施工" }).click();
    await expect(stage).toHaveAttribute("data-working", "true");
  }
  if (scenario === "dialogue-pending") {
    if (!mockUi)
      throw Error("The after run needs a pending Mock UI configuration.");
    await page.keyboard.press("e");
    await expect(page.locator(mockUi.mockBadge)).toBeVisible();
    await page.locator(mockUi.input).fill("岑砚，修旧桥前需要准备什么？");
    await page.locator(mockUi.send).click();
    await expect(page.locator(mockUi.pending)).toBeVisible();
  }

  const movementLegs: number[] = [];
  let held: "a" | "d" = "d";
  async function move() {
    let previous = (await position(page)).x;
    for (let index = 0; index < 5; index++) {
      await delay(950);
      const next = (await position(page)).x;
      const advanced = (next - previous) * (held === "d" ? 1 : -1);
      movementLegs.push(advanced);
      if (advanced < 25)
        throw Error(`Movement leg ${index + 1} advanced only ${advanced}px.`);
      previous = next;
      await page.keyboard.up(held);
      held = held === "d" ? "a" : "d";
      await page.keyboard.down(held);
    }
  }

  try {
    if (scenario === "movement") {
      await page.keyboard.down(held);
      await expect(stage).toHaveAttribute("data-moving", "true");
    }
    const [frames] = await Promise.all([
      captureFrames(
        page,
        scenario === "dialogue-pending" ? mockUi?.pending : undefined,
      ),
      scenario === "movement" ? move() : undefined,
    ]);
    const { start, end } = frames;
    if (!start.visible || !end.visible || !start.ready || !end.ready)
      throw Error(
        "The page was hidden or disconnected at a sampling boundary.",
      );
    if (
      scenario === "idle" &&
      (start.moving ||
        end.moving ||
        start.working ||
        end.working ||
        start.x !== end.x ||
        start.y !== end.y)
    )
      throw Error("The idle scenario did not stay still.");
    if (
      scenario === "movement" &&
      (!start.moving || !end.moving || Math.abs(end.y - start.y) > 0.1)
    )
      throw Error(
        "The horizontal movement scenario was inactive at a sampling boundary.",
      );
    if (
      scenario === "construction" &&
      (!start.working ||
        !end.working ||
        end.progressPercent <= start.progressPercent)
    )
      throw Error(
        "Construction was interrupted or failed to advance during sampling.",
      );
    if (scenario === "dialogue-pending" && (!start.pending || !end.pending))
      throw Error(
        "The Mock response did not remain pending for the entire sampling window.",
      );
    await page.screenshot({ path: screenshotPath, timeout: 4000 });
    return { renderer, frames, movementLegs };
  } finally {
    if (scenario === "movement") await page.keyboard.up(held);
  }
}
