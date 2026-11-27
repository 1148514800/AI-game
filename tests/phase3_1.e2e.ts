import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { freeBackendPort } from "./backend-process.js";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Snapshot } from "../src/shared/protocol.js";
import {
  distance,
  isPassable,
  nearbyTarget,
  residents,
  speed,
  valley,
  type Point,
} from "../src/shared/world.js";
import { findKeyboardRoute } from "./paths.js";

const evidence = resolve(
  process.env.MISTSEA_EVIDENCE ?? "evidence/phase4",
  "cooperation",
);
const stage = (page: Page) => page.locator("#game");
const log = (page: Page) => page.getByRole("log");
const replyInput = (page: Page) => page.locator("#dialogue-input");
const playerWood = (page: Page) => page.locator("[data-item=wood]");
const npcBag = (page: Page) => page.locator("#cenyan-bag");
const ready = (page: Page) =>
  expect(stage(page)).toHaveAttribute("data-ready", "true", {
    timeout: 12_000,
  });
const activity = (page: Page, expected: string, timeout = 12_000) =>
  expect(stage(page)).toHaveAttribute("data-cenyan-activity", expected, {
    timeout,
  });

async function positions(page: Page) {
  return stage(page).evaluate((el) => ({
    player: { x: Number(el.dataset.x), y: Number(el.dataset.y) },
    cenyan: { x: Number(el.dataset.cenyanX), y: Number(el.dataset.cenyanY) },
  }));
}

async function walk(
  page: Page,
  reached: (p: Point, npc: Point) => boolean,
  repaired = false,
) {
  await stage(page).focus();
  const diagnostics: object[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const { player, cenyan } = await positions(page);
    if (reached(player, cenyan)) return;
    const goal = (point: Point) => reached(point, cenyan);
    const steps = findKeyboardRoute(player, goal, repaired, [cenyan, ...valley.residents.filter((id) => id.id !== "cenyan")]);
    if (!steps) {
      // Diagnose the obstruction without using a route that ignores Cenyan.
      const terrainRoute = findKeyboardRoute(player, goal, repaired, []);
      diagnostics.push({
        player,
        cenyan,
        repaired,
        reason: terrainRoute
          ? "terrain route exists, but blocked with current NPC clearance"
          : "no terrain route on either grid, even without the NPC",
      });
      if (!terrainRoute) break;
      await page.waitForTimeout(150);
      continue;
    }
    for (const step of steps) {
      const axis = step.axis;
      const endpoint = step[axis];
      const delta = endpoint - (await positions(page)).player[axis];
      if (Math.abs(delta) <= 2) continue;
      const sign = Math.sign(delta);
      const key = axis === "x" ? (sign > 0 ? "d" : "a") : sign > 0 ? "s" : "w";
      await page.keyboard.down(key);
      let blocked = false;
      try {
        await page.waitForFunction(
          ({ axis, endpoint, sign }) =>
            (Number(document.getElementById("game")!.dataset[axis]) -
              endpoint) *
              sign >=
            -1.7,
          { axis, endpoint, sign },
          { timeout: 1600 + (Math.abs(delta) * 1000) / speed },
        );
      } catch (error) {
        if (!(error instanceof Error && error.name === "TimeoutError"))
          throw error;
        blocked = true;
      } finally {
        await page.keyboard.up(key);
      }
      if (blocked) {
        diagnostics.push({
          ...(await positions(page)),
          step,
          reason: "key movement did not reach waypoint",
        });
        break;
      }
    }
    await expect(stage(page)).toHaveAttribute("data-moving", "false");
  }
  const { player, cenyan } = await positions(page);
  expect(
    reached(player, cenyan),
    `Keyboard route did not reach the requested location: ${JSON.stringify({ player, cenyan, repaired, diagnostics })}`,
  ).toBe(true);
}

async function openChat(page: Page, moveToNpc = true) {
  if (moveToNpc)
    await walk(
      page,
      (player, npc) =>
        distance(player, npc) <= residents.get("cenyan")!.range - 5,
    );
  const { player, cenyan } = await positions(page);
  expect(distance(player, cenyan)).toBeLessThanOrEqual(
    residents.get("cenyan")!.range,
  );
  if (nearbyTarget(player, cenyan)?.id === "cenyan") {
    await stage(page).focus();
    await page.keyboard.press("e");
  } else await page.locator("#talk-cenyan").click();
  await expect(replyInput(page)).toBeVisible();
  await expect(page.locator("#dialogue-mode")).toContainText("Mock");
}
async function say(page: Page, text: string, expected: string) {
  const rows = log(page).locator("p").filter({ hasText: expected });
  const previous = await rows.count();
  await replyInput(page).fill(text);
  await replyInput(page).press("Enter");
  await expect(rows).toHaveCount(previous + 1);
  await expect(page.locator("#dialogue-pending")).toBeHidden();
}
const closeChat = (page: Page) => page.locator("#dialogue-close").click();
async function resumeForestMove(page: Page) {
  const held = (await positions(page)).cenyan;
  await closeChat(page);
  await expect
    .poll(async () => distance(held, (await positions(page)).cenyan))
    .toBeGreaterThan(2);
  await activity(page, "moving");
}

test.use({
  trace: { mode: "on", screenshots: false, snapshots: false, sources: false },
});

test("Phase3.1 A–F normal UI: consent, persisted plan, following, shared bridge and restarted context", async ({
  page,
}) => {
  test.setTimeout(150_000);
  mkdirSync(evidence, { recursive: true });
  const directory = mkdtempSync(join(tmpdir(), "mistsea-phase31-browser-"));
  const capture = join(evidence, "mock-context.jsonl");
  writeFileSync(capture, "");
  const traceFile = join(evidence, "trajectory.json");
  const serviceLog = openSync(join(evidence, "services.log"), "w");
  let child: ChildProcess | undefined;
  let latest: Snapshot | undefined;
  let followTrajectory = false;
  const trajectory: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const starts: number[] = [];
  let lastSample = 0;
  let followCandidateSnapshot: Snapshot | undefined;
  let followMinGap = Infinity;
  let followMovement = 0;
  const followViolations: string[] = [];
  const mark = (step: string, detail?: object) =>
    trajectory.push({
      step,
      at: Date.now(),
      state: latest?.state,
      activity: latest?.cenyan.activity,
      working: latest?.working,
      ...detail,
    });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(payload.toString());
      if (message.type === "snapshot") {
        latest = message as Snapshot;
        if (followTrajectory) {
          const { player, cenyan, bridge } = latest.state;
          followMinGap = Math.min(followMinGap, distance(player, cenyan));
          if (!isPassable(cenyan.x, cenyan.y, bridge.repaired))
            followViolations.push("NPC outside passable terrain");
          if (followCandidateSnapshot) {
            const distanceTravelled = distance(
              followCandidateSnapshot.state.cenyan,
              cenyan,
            );
            const allowed =
              (speed * (latest.now - followCandidateSnapshot.now + 50)) / 1000;
            if (distanceTravelled > allowed + 0.01)
              followViolations.push("NPC exceeded movement budget");
            followMovement += distanceTravelled;
          }
          followCandidateSnapshot = latest;
        }
        if (
          (followTrajectory ||
            (latest.state.sharedWorkMs > 0 && !latest.state.bridge.repaired)) &&
          latest.now - lastSample >= 500
        ) {
          lastSample = latest.now;
          const { player, cenyan, bridge, sharedWorkMs } = latest.state;
          trajectory.push({
            at: latest.now,
            player,
            cenyan: { x: cenyan.x, y: cenyan.y },
            progressMs: bridge.progressMs,
            sharedWorkMs,
            activity: latest.cenyan.activity,
            playerWorking: latest.working,
          });
        }
      } else if (
        message.type === "result" ||
        (message.type === "dialogue" && message.event === "reply")
      )
        trajectory.push({ at: Date.now(), message });
    }),
  );
  const shoot = (name: string) =>
    page.screenshot({ path: join(evidence, name + ".png"), fullPage: true });

  async function start() {
    await freeBackendPort();
    child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/phase3_1-server.ts"],
      {
        env: {
          PATH: process.env.PATH,
          PORT: "3003",
          LLM_ENABLED: "false",
          MISTSEA_SAVE: join(directory, "world.sqlite"),
          MISTSEA_CONTEXT_CAPTURE: capture,
        },
        stdio: ["ignore", serviceLog, serviceLog],
      },
    );
    child.once("error", (error) => errors.push(error.message));
    await expect
      .poll(
        async () => {
          if (
            !child?.pid ||
            child.exitCode !== null ||
            child.signalCode !== null
          )
            throw Error(
              `Backend failed to start. See ${join(evidence, "services.log")}`,
            );
          return (
            await fetch("http://127.0.0.1:3003/health", {
              signal: AbortSignal.timeout(350),
            }).catch(() => null)
          )?.status;
        },
        { timeout: 8000 },
      )
      .toBe(200);
    starts.push(child.pid!);
    mark("service-started", { pid: child.pid });
  }
  async function stop() {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
      return;
    const processToStop = child;
    const exited = once(processToStop, "exit");
    processToStop.kill("SIGTERM");
    const exit = await Promise.race([
      exited,
      delay(5000, null, { ref: false }),
    ]);
    if (!exit) {
      processToStop.kill("SIGKILL");
      await exited;
      throw Error("Fixture service ignored SIGTERM.");
    }
    mark("service-stopped", { pid: processToStop.pid, exit });
    expect(exit).toEqual([0, null]);
  }

  try {
    await start();
    await page.goto("/");
    await ready(page);
    await page.locator("#cenyan-debug summary").click();
    await expect(playerWood(page)).toHaveText("0");
    await expect(page.locator("[data-item=stone]")).toHaveText("0");
    await expect(npcBag(page)).toHaveText("木材 0 · 石材 0");
    mark("A-fresh");
    for (const [index, node] of valley.resources.slice(0, 4).entries()) {
      await walk(
        page,
        (player, npc) =>
          distance(player, node) <= node.range - 5 &&
          nearbyTarget(player, npc)?.id === node.id,
      );
      await page.keyboard.press("e");
      await expect(playerWood(page)).toHaveText(String(index + 1));
      mark("A-player-harvested", { target: node.id });
    }

    await openChat(page);
    await page.locator("#gift-qty").fill("2");
    await page.locator("#gift-send").click();
    await expect(log(page)).toContainText("岑砚拒绝了旅人的赠送");
    await expect(page.locator("#cenyan-decision")).toContainText(
      "GIFT_REJECTED",
    );
    await expect(playerWood(page)).toHaveText("4");
    await expect(npcBag(page)).toHaveText("木材 0 · 石材 0");
    await page.locator("#gift-qty").fill("1");
    await page.locator("#gift-send").click();
    await expect(log(page)).toContainText("旅人赠给岑砚木材 ×1");
    await expect(playerWood(page)).toHaveText("3");
    await expect(npcBag(page)).toHaveText("木材 1 · 石材 0");
    await expect(page.locator("#cenyan-decision")).toContainText(
      '"giftResponse"',
    );
    await expect(page.locator("#cenyan-decision")).toContainText(
      "GIFT_TRANSFERRED",
    );
    await shoot("E-traveler-gift");
    await say(page, "你能送我一份木材吗？", "我提议送你一份木材。");
    await closeChat(page);
    await expect(page.locator("#gift-incoming")).toContainText(
      "岑砚提议赠你木材 ×1",
    );
    await expect(playerWood(page)).toHaveText("3");
    await expect(npcBag(page)).toHaveText("木材 1 · 石材 0");
    await shoot("E-explicit-consent");
    await page.locator("#gift-reject").click();
    await expect(page.locator("#feedback")).toContainText(
      "旅人拒绝了岑砚的赠送",
    );
    await expect(playerWood(page)).toHaveText("3");
    await expect(npcBag(page)).toHaveText("木材 1 · 石材 0");
    await openChat(page, false);
    await say(page, "你能送我一份木材吗？", "我提议送你一份木材。");
    await closeChat(page);
    await page.locator("#gift-accept").click();
    await expect(page.locator("#feedback")).toContainText(
      "岑砚赠给旅人木材 ×1",
    );
    await expect(playerWood(page)).toHaveText("4");
    await expect(npcBag(page)).toHaveText("木材 0 · 石材 0");
    mark("E-bidirectional-consent");

    await walk(page, (player, npc) => distance(player, npc) <= 17);
    await openChat(page, false);
    await say(page, "请先去林地找些木材。", "计划已接受");
    await resumeForestMove(page);
    await openChat(page, false);
    await say(page, "能改去靠东的倒木吗？", "行，改走东侧。");
    await expect(page.locator("#cenyan-goal")).toHaveText("改去靠东的倒木");
    await expect(page.locator("#cenyan-result")).toContainText(
      "已被新计划替换",
    );
    await resumeForestMove(page);
    await openChat(page, false);
    await say(page, "到了以后，能把这两处倒木都采一点吗？", "已保存待执行计划");
    await expect(page.locator("#cenyan-pending")).toContainText(
      "抵达后采两处倒木",
    );
    await resumeForestMove(page);
    await openChat(page, false);
    await say(page, "要不现在先回工坊？", "这次没有接受行动计划。");
    await expect(page.locator("#cenyan-goal")).toHaveText("改去靠东的倒木");
    await expect(page.locator("#cenyan-pending")).toContainText(
      "抵达后采两处倒木",
    );
    await expect(page.locator("#cenyan-decision")).toContainText("reject");
    mark("D-replace-defer-reject");
    await shoot("D-persisted-pending");
    // Dialogue holds the current movement and pending plan until the process actually exits.
    await stop();
    await expect(stage(page)).toHaveAttribute("data-ready", "false");
    await start();
    await ready(page);
    await expect(page.locator("#cenyan-goal")).toHaveText("抵达后采两处倒木", {
      timeout: 15_000,
    });
    await expect(page.locator("#cenyan-pending")).toHaveText("暂无");
    await expect(npcBag(page)).toHaveText("木材 2 · 石材 0", {
      timeout: 15_000,
    });
    mark("D-promoted-and-harvested");

    for (const [index, text] of [
      "请到南坡采第一份石料。",
      "再从另一处采一份石料吧。",
    ].entries()) {
      await openChat(page);
      await say(page, text, "计划已接受");
      await closeChat(page);
      await expect(npcBag(page)).toHaveText(`木材 2 · 石材 ${index + 1}`, {
        timeout: 15_000,
      });
      mark("A-cenyan-harvested", { count: index + 1 });
    }
    await openChat(page);
    await say(page, "我们一起去桥边吧。", "好，我跟你到桥边。");
    await expect(page.locator("#cenyan-plan")).toContainText("跟随 旅人");
    const callsBeforeFollowing = latest!.cenyan.model!.sharedUsage!.requests;
    await closeChat(page);
    mark("B-accepted-and-closed");
    followTrajectory = true;
    await walk(page, (point) => distance(point, { x: 399, y: 449 }) <= 14);
    await activity(page, "waiting");
    mark("B-player-stops-cenyan-waits");
    await shoot("B-follow-stop");
    await walk(page, (point) => distance(point, valley.bridge) <= 15);
    await expect(page.locator("#cenyan-result")).toContainText(
      "同行抵达旧桥边",
    );
    followTrajectory = false;
    expect(followViolations).toEqual([]);
    expect(followMovement).toBeGreaterThan(55);
    expect(followMinGap).toBeGreaterThanOrEqual(7.99);
    expect(latest!.cenyan.model!.sharedUsage!.requests).toBe(
      callsBeforeFollowing,
    );
    mark("B-follow-arrived", {
      followMovement,
      followMinGap,
      callsBeforeFollowing,
    });
    await shoot("B-follow-arrived");

    await page.locator("#delivery-qty").fill("2");
    await page.locator("#delivery-send").click();
    await expect(page.locator("#bridge-wood")).toHaveText("2 / 6");
    await expect(playerWood(page)).toHaveText("2");
    await page.locator("#delivery-send").click();
    await expect(page.locator("#bridge-wood")).toHaveText("4 / 6");
    await expect(playerWood(page)).toHaveText("0");
    await expect(page.locator("#bridge-player-contribution")).toContainText(
      "木材 4 · 石材 0",
    );
    await openChat(page, false);
    await say(page, "请把你这次采的木石交到工地。", "计划已接受");
    await closeChat(page);
    await expect(page.locator("#bridge-wood")).toHaveText("6 / 6");
    await expect(page.locator("#bridge-stone")).toHaveText("2 / 2");
    await expect(npcBag(page)).toHaveText("木材 0 · 石材 0");
    await expect(page.locator("#bridge-cenyan-contribution")).toContainText(
      "木材 2 · 石材 2",
    );
    mark("A-shared-materials");
    await shoot("A-shared-materials");

    await openChat(page, false);
    await say(page, "我们一起铺桥板吧。", "计划已接受");
    await closeChat(page);
    await activity(page, "working");
    await page.getByRole("button", { name: "开始施工" }).click();
    await expect(page.locator("#next-step")).toHaveText(
      "你和岑砚正在一起铺设桥板。",
    );
    await expect.poll(() => latest!.state.sharedWorkMs).toBeGreaterThan(200);
    await shoot("C-shared-work");
    mark("C-simultaneous-work");
    await expect(page.locator("#percent")).toHaveText("100%", {
      timeout: 15_000,
    });
    expect(latest!.state.contributions.player.workMs).toBeGreaterThan(0);
    expect(latest!.state.contributions.cenyan.workMs).toBeGreaterThan(0);
    expect(
      latest!.state.contributions.player.workMs +
        latest!.state.contributions.cenyan.workMs,
    ).toBeCloseTo(valley.bridge.workMs, 3);
    await expect(page.locator("#cenyan-memory")).toContainText(
      "旅人与岑砚合力修通旧桥",
    );
    mark("C-repaired");
    await shoot("C-repaired");

    const requestsBeforeRestart = latest!.cenyan.model!.sharedUsage!.requests;
    await stop();
    await expect(stage(page)).toHaveAttribute("data-ready", "false");
    await start();
    await ready(page);
    expect(new Set(starts).size).toBe(3);
    expect(latest!.cenyan.model!.sharedUsage!.requests).toBe(
      requestsBeforeRestart,
    );
    await expect(page.locator("#cenyan-memory")).toContainText(
      "旅人与岑砚合力修通旧桥",
    );
    await expect(page.locator("#bridge-wood")).toHaveText("6 / 6");
    await openChat(page, false);
    const followup = "还记得我们一起修桥的经过吗？";
    await say(page, followup, "旅人与岑砚合力修通旧桥");
    await expect
      .poll(() => latest!.cenyan.model!.sharedUsage!.requests)
      .toBe(requestsBeforeRestart + 1);
    const calls = readFileSync(capture, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const restored = calls.find((call) => call.text === followup);
    expect(restored.pid).toBe(starts[2]);
    expect(restored.messages[0].content).toContain("旅人与岑砚合力修通旧桥");
    expect(restored.messages[0].content).toContain("岑砚和旅人同行抵达旧桥边");
    expect(restored.messages[0].content).toContain("岑砚赠给旅人木材 ×1");
    mark("F-restarted-model-context", {
      pid: restored.pid,
      calls: calls.length,
    });
    await shoot("F-restarted-memory");
    await closeChat(page);

    await walk(
      page,
      (point) =>
        point.x > valley.bridge.left + 110 &&
        Math.abs(point.y - valley.bridge.y) <= 14,
      true,
    );
    expect((await positions(page)).player.x).toBeGreaterThan(
      valley.bridge.left + 110,
    );
    mark("C-crossed-under-keyboard-control");
    await shoot("C-crossed");
    expect(errors).toEqual([]);
  } finally {
    try {
      await stop();
    } finally {
      writeFileSync(
        traceFile,
        JSON.stringify({ starts, errors, trajectory }, null, 2) + "\n",
      );
      closeSync(serviceLog);
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
