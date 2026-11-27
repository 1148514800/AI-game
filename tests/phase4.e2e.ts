import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { freeBackendPort, stopBackend } from "./backend-process.js";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Snapshot } from "../src/shared/protocol.js";
import { actorName, npcIds, type NpcId } from "../src/shared/social.js";
import {
  distance,
  nearbyTarget,
  residents,
  speed,
  valley,
  type Point,
} from "../src/shared/world.js";
import { findKeyboardRoute } from "./paths.js";

const evidence = join(
  process.env.MISTSEA_EVIDENCE ?? "evidence/phase4",
  "society",
);
const stage = (page: Page) => page.locator("#game");
const ready = (page: Page) =>
  expect(stage(page)).toHaveAttribute("data-ready", "true");

function observe(page: Page) {
  let latest: Snapshot | undefined;
  const activities = Object.fromEntries(
    npcIds.map((id) => [id, new Set<string>()]),
  ) as Record<NpcId, Set<string>>;
  const speech = new Set<string>();
  const opinions = new Set<string>();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(String(payload));
      if (message.type !== "snapshot") return;
      latest = message as Snapshot;
      for (const id of npcIds) {
        activities[id].add(latest.actors[id].activity);
        for (const entry of latest.actors[id].memory)
          if (entry.kind === "opinion") opinions.add(entry.content);
      }
      for (const line of latest.bubbles) speech.add(line.text);
    }),
  );
  return {
    get latest() {
      return latest!;
    },
    activities,
    speech,
    opinions,
    errors,
  };
}

type Observation = ReturnType<typeof observe>;

async function service(label: string, autonomy: boolean) {
  mkdirSync(evidence, { recursive: true });
  const folder = mkdtempSync(join(tmpdir(), "mistsea-phase4-ui-"));
  const output = openSync(join(evidence, label + "-service.log"), "w");
  let child: ChildProcess | undefined;
  async function start() {
    await freeBackendPort();
    child = spawn(
      process.execPath,
      ["--import", "tsx", "src/server/index.ts"],
      {
        env: {
          PATH: process.env.PATH,
          HOST: "127.0.0.1",
          PORT: "3003",
          MISTSEA_SAVE: join(folder, "world.sqlite"),
          LLM_ENABLED: "false",
          LLM_MOCK_AUTONOMY_ENABLED: String(autonomy),
          LLM_MOCK_DELAY_MS: "180",
          LLM_MAX_REQUESTS_PER_MINUTE: "100",
          LLM_AUTONOMY_REQUESTS_PER_MINUTE: "60",
          LLM_MAX_REQUESTS_PER_SESSION: "150",
          LLM_AUTONOMY_REQUESTS_PER_SESSION: "130",
        },
        stdio: ["ignore", output, output],
      },
    );
    await expect
      .poll(async () => {
        if (child?.exitCode !== null)
          throw Error("Backend exited, see " + label + "-service.log");
        return fetch("http://127.0.0.1:3003/health", {
          signal: AbortSignal.timeout(500),
        })
          .then((response) => response.status)
          .catch(() => 0);
      }, { timeout: 8000 })
      .toBe(200);
  }
  async function stop() {
    await stopBackend(child);
    child = undefined;
    await freeBackendPort();
  }
  async function close() {
    await stop();
    closeSync(output);
    rmSync(folder, { recursive: true, force: true });
  }
  return { start, stop, close };
}

// WebSocket snapshots guide ordinary keyboard movement. No messages are
// injected into the page or emitted outside its normal controls.
async function walk(
  page: Page,
  observation: Observation,
  reached: (point: Point, snapshot: Snapshot) => boolean,
) {
  await stage(page).focus();
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = observation.latest;
    if (reached(snapshot.state.player, snapshot)) return;
    const path = findKeyboardRoute(
      snapshot.state.player,
      (point) => reached(point, snapshot),
      snapshot.state.bridge.repaired,
      Object.values(snapshot.state.actors),
    );
    if (!path) {
      await page.waitForTimeout(150);
      continue;
    }
    for (const stop of path) {
      const delta =
        stop[stop.axis] - observation.latest.state.player[stop.axis];
      if (Math.abs(delta) < 2) continue;
      const sign = Math.sign(delta);
      const key =
        stop.axis === "x" ? (sign > 0 ? "d" : "a") : sign > 0 ? "s" : "w";
      await page.keyboard.down(key);
      try {
        await expect
          .poll(
            () =>
              (observation.latest.state.player[stop.axis] - stop[stop.axis]) *
              sign,
            { timeout: 1800 + (Math.abs(delta) * 1000) / speed },
          )
          .toBeGreaterThan(-2);
      } catch {
        break;
      } finally {
        await page.keyboard.up(key);
      }
    }
    await expect(stage(page)).toHaveAttribute("data-moving", "false");
  }
  expect(reached(observation.latest.state.player, observation.latest)).toBe(
    true,
  );
}

async function open(page: Page, observation: Observation, npc: NpcId) {
  await walk(
    page,
    observation,
    (player, snapshot) =>
      distance(player, snapshot.state.actors[npc]) <=
      residents.get(npc)!.range - 4,
  );
  await page.locator("#talk-" + npc).click();
  await expect(
    page.getByRole("dialog", { name: actorName(npc) }),
  ).toBeVisible();
  await expect(page.locator("#dialogue-mode")).toContainText("Mock");
}
async function say(page: Page, text: string, result: RegExp) {
  await page.locator("#dialogue-input").fill(text);
  await page.locator("#dialogue-send").click();
  await expect(
    page
      .locator("#dialogue-transcript")
      .locator("p")
      .filter({ hasText: result })
      .last(),
  ).toBeVisible();
}

test("Phase 4 A–C/E/G: autonomous residents gather, negotiate and repair without traveler resources", async ({
  page,
}) => {
  test.setTimeout(230_000);
  const backend = await service("autonomous", true);
  const observation = observe(page);
  try {
    await backend.start();
    await page.goto("/");
    await ready(page);
    const start = observation.latest.state;
    await expect
      .poll(
        () => npcIds.every((id) => observation.activities[id].has("moving")),
        { timeout: 25_000 },
      )
      .toBe(true);
    expect(observation.latest.state.player).toEqual(start.player);
    expect(observation.latest.state.inventory).toEqual(start.inventory);
    await page.screenshot({
      path: join(evidence, "A-three-residents.png"),
      fullPage: true,
    });
    // Nearby speech is rendered only within observation distance. Move up the
    // west-bank lane after the passive A observation and leave all work to NPCs.
    await walk(
      page,
      observation,
      (point) => point.y < 270 && point.x > 190 && point.x < 270,
    );
    await expect
      .poll(
        () =>
          observation.latest.state.events.some(
            (event) => event.kind === "cooperation",
          ),
        { timeout: 150_000 },
      )
      .toBe(true);
    const { state } = observation.latest;
    expect(state.bridge.repaired).toBe(true);
    expect(state.inventory).toEqual(start.inventory);
    expect(state.contributions.player).toEqual({
      wood: 0,
      stone: 0,
      workMs: 0,
    });
    expect(state.sharedWorkMs).toBeGreaterThan(0);
    expect(
      npcIds.every(
        (id) =>
          state.contributions[id].wood + state.contributions[id].stone > 0,
      ),
    ).toBe(true);
    expect(
      npcIds.every((id) => Object.keys(state.actors[id].relations).length > 0),
    ).toBe(true);
    expect(
      observation.latest.state.talkCooldowns["cenyan:luozhou"],
    ).toBeGreaterThan(0);
    expect(
      observation.latest.state.talkCooldowns["ahe:luozhou"],
    ).toBeGreaterThan(0);
    expect(
      [...observation.opinions].some((opinion) =>
        opinion.includes("我分批送木料"),
      ),
    ).toBe(true);
    expect(
      [...observation.opinions].some((opinion) =>
        opinion.includes("不能把存货都交出去"),
      ),
    ).toBe(true);
    expect(
      observation.activities.cenyan.has("talking") ||
        observation.activities.ahe.has("talking"),
    ).toBe(true);
    expect(npcIds.some((id) => observation.activities[id].has("waiting"))).toBe(
      true,
    );
    await expect
      .poll(
        () => npcIds.every((id) => observation.activities[id].has("resting")),
        { timeout: 35_000 },
      )
      .toBe(true);
    await expect(page.locator("#valley-events")).toContainText("合力修通旧桥");
    await page.screenshot({
      path: join(evidence, "C-autonomous-bridge.png"),
      fullPage: true,
    });
    expect(observation.errors).toEqual([]);
    writeFileSync(
      join(evidence, "autonomous.json"),
      JSON.stringify(
        {
          contributions: state.contributions,
          bridge: state.bridge,
          sharedWorkMs: state.sharedWorkMs,
          activities: Object.fromEntries(
            npcIds.map((id) => [id, [...observation.activities[id]]]),
          ),
          nearbySpeech: [...observation.speech],
        },
        undefined,
        2,
      ),
    );
  } finally {
    await backend.close();
  }
});

test("Phase 4 D–H: UI opens each actor, lends and returns real wood, restarts, and joins bridge work", async ({
  page,
}) => {
  test.setTimeout(220_000);
  const backend = await service("consent", false);
  const observation = observe(page);
  const bag = page.locator("[data-item=wood]");
  const panel = page.locator("#cenyan-dialogue");
  const close = () => page.locator("#dialogue-close").click();
  try {
    await backend.start();
    await page.goto("/");
    await ready(page);
    await expect(bag).toHaveText("0");
    const collect = async (node: (typeof valley.resources)[number]) => {
      await walk(
        page,
        observation,
        (point, snapshot) =>
          distance(point, node) <= node.range - 5 &&
          nearbyTarget(point, snapshot.state.actors)?.id === node.id,
      );
      const old = observation.latest.state.inventory[node.item];
      await stage(page).focus();
      await page.keyboard.press("e");
      await expect
        .poll(() => observation.latest.state.inventory[node.item])
        .toBe(old + node.yieldCount);
    };
    const node = valley.resources[0];
    await collect(node);
    await expect(bag).toHaveText(String(node.yieldCount));
    await open(page, observation, "ahe");
    await say(page, "屋顶木料的私事，我只告诉阿禾。", /聚落|物资/);
    await panel.getByText("交接与约定", { exact: true }).click();
    await page.locator("#social-kind").selectOption("loan");
    await panel.getByRole("button", { name: "提出约定" }).click();
    await expect(panel.getByRole("log")).toContainText("完成出借");
    await expect(bag).toHaveText(String(node.yieldCount - 1));
    const before = observation.latest;
    const pledge = before.state.pledges.at(-1)!;
    expect(pledge.status).toBe("accepted");
    expect(pledge.from).toBe("ahe");
    expect(
      before.actors.ahe.memory.some((entry) =>
        entry.content.includes("只告诉阿禾"),
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(evidence, "F-loan.png"),
      fullPage: true,
    });
    await close();
    await backend.stop();
    await backend.start();
    await page.reload();
    await ready(page);
    expect(observation.latest.state.pledges.at(-1)?.id).toBe(pledge.id);
    expect(observation.latest.actors.ahe.model?.sharedUsage?.requests).toBe(
      before.actors.ahe.model?.sharedUsage?.requests,
    );
    await open(page, observation, "ahe");
    await say(page, "请把借用的木材归还给我。", /计划已接受/);
    await close();
    await expect(bag).toHaveText(String(node.yieldCount));
    await expect
      .poll(() => observation.latest.state.pledges.at(-1)?.status)
      .toBe("fulfilled");
    expect(
      observation.latest.actors.cenyan.memory.every(
        (entry) => !entry.content.includes("只告诉阿禾"),
      ),
    ).toBe(true);

    for (const resource of valley.resources.slice(1, 8))
      await collect(resource);
    await expect(bag).toHaveText("6");
    await expect(page.locator("[data-item=stone]")).toHaveText("2");
    await open(page, observation, "luozhou");
    await say(page, "请你和我一起修桥施工。", /计划已接受/);
    await close();
    await expect
      .poll(() => observation.latest.actors.luozhou.activity)
      .toBe("waiting");
    await open(page, observation, "cenyan");
    await say(page, "洛舟已在工地。请你和我们一起施工。", /计划已接受/);
    await close();
    await walk(
      page,
      observation,
      (point, snapshot) =>
        distance(point, valley.bridge) <= valley.bridge.range - 5 &&
        distance(point, snapshot.state.actors.luozhou) <=
          residents.get("luozhou")!.range - 4,
    );
    await expect
      .poll(() => observation.latest.actors.cenyan.activity)
      .toBe("waiting");
    await page.locator("#delivery-item").selectOption("wood");
    await page.locator("#delivery-qty").fill("1");
    await page.getByRole("button", { name: "交指定材料" }).click();
    await expect(page.locator("#bridge-wood")).toHaveText("1 / 6");
    expect(observation.latest.state.contributions.player.wood).toBe(1);
    await walk(
      page,
      observation,
      (point, snapshot) =>
        distance(point, valley.bridge) <= valley.bridge.range - 5 &&
        distance(point, snapshot.state.actors.cenyan) <=
          residents.get("cenyan")!.range - 4,
    );
    await expect(page.locator("#stop-wait")).toHaveAttribute(
      "data-actor",
      "cenyan",
    );
    await page.locator("#stop-wait").click();
    await expect(page.locator("#feedback")).toContainText("已取消条件等待");
    await page.locator("#delivery-qty").fill("5");
    await page.getByRole("button", { name: "交指定材料" }).click();
    await expect(page.locator("#bridge-wood")).toHaveText("6 / 6");
    await page.locator("#delivery-item").selectOption("stone");
    await page.locator("#delivery-qty").fill("2");
    await page.getByRole("button", { name: "交指定材料" }).click();
    await expect
      .poll(() => observation.latest.actors.luozhou.activity)
      .toBe("working");
    await page.getByRole("button", { name: "开始施工" }).click();
    await expect
      .poll(() => observation.latest.state.sharedWorkMs)
      .toBeGreaterThan(0);
    await expect
      .poll(() => observation.latest.state.bridge.repaired, { timeout: 15_000 })
      .toBe(true);
    expect(
      observation.latest.state.contributions.player.workMs,
    ).toBeGreaterThan(0);
    expect(
      observation.latest.state.contributions.luozhou.workMs,
    ).toBeGreaterThan(0);
    await page.locator("#cenyan-debug summary").click();
    await page.locator("#debug-actor").selectOption("ahe");
    await expect(page.locator("#actor-relations")).toBeVisible();
    await page.screenshot({
      path: join(evidence, "H-restart-and-debug.png"),
      fullPage: true,
    });
    expect(observation.errors).toEqual([]);
  } finally {
    await backend.close();
  }
});
