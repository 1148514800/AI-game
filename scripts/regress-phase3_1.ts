import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { setTimeout as delay } from "node:timers/promises";
import { DialogueSession } from "../src/server/dialogue/session.js";
import { SaveFile } from "../src/server/save.js";
import { World } from "../src/server/world.js";
import type { DialogueEvent } from "../src/shared/protocol.js";
import { distance, isPassable, speed, tickMs } from "../src/shared/world.js";

const output = process.env.MISTSEA_EVIDENCE ?? "evidence/phase4";
mkdirSync(output, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), "mistsea-phase31-tick-"));
const path = join(directory, "world.sqlite");
const setup = new SaveFile(path);
const initial = structuredClone(setup.initial);
initial.player = { x: 237, y: 354, facing: "right" };
Object.assign(initial.cenyan, { x: 220, y: 354 });
setup.write(initial);
setup.close();
const store = new SaveFile(path);
const world = new World(store);
const owner = {} as WebSocket;
let requests = 0;
let autonomy = 0;
let storageIssue: unknown;
const events: DialogueEvent[] = [];
const dialogue = new DialogueSession(
  path + ".llm.sqlite",
  () => ({ near: world.canTalkToCenyan(), bridge: world.publicBridge() }),
  (_, message) => events.push(message),
  {
    LLM_ENABLED: "false",
    LLM_MOCK_AUTONOMY_ENABLED: "true",
    LLM_MOCK_DELAY_MS: "60",
  },
  () => world.haltPlayer(),
  {
    world,
    active: () => true,
    storageError: (error) => {
      storageIssue = error;
    },
    mockDialogue: () => {
      requests++;
      return JSON.stringify({
        goal: "和旅人同行",
        speech: "好，我跟着你。",
        plan_policy: "replace",
        plan: [{ type: "follow", target_id: "player" }],
      });
    },
    mockDecision: () => {
      autonomy++;
      return JSON.stringify({
        goal: "原处等待",
        speech: "",
        plan: [{ type: "wait", seconds: 20 }],
      });
    },
  },
);

const begin = performance.now();
const samples: number[] = [];
const trajectory: object[] = [];
let elapsed = 0;
let maximumPending = 0;
let maximumQueue = 0;
let minGap = Infinity;
let movement = 0;
let movementAfterStop = 0;
let stopped = false;
let passed = false;
let issue: string | undefined;

try {
  dialogue.handle(owner, {
    type: "dialogue-open",
    id: randomUUID(),
    npc: "cenyan",
  });
  const opened = events.find((event) => event.event === "opened");
  assert.ok(opened && opened.event === "opened");
  const request = randomUUID();
  dialogue.handle(owner, {
    type: "dialogue-send",
    id: request,
    dialogId: opened.dialogId,
    text: "我们一起去桥边吧。",
  });
  maximumPending = dialogue.load.pending;
  maximumQueue = dialogue.load.queued;
  const deadline = performance.now() + 2000;
  while (
    !events.some(
      (event) => event.event === "reply" && event.requestId === request,
    ) &&
    performance.now() < deadline
  )
    await delay(20);
  assert.ok(
    events.some(
      (event) =>
        event.event === "reply" &&
        event.requestId === request &&
        event.action === "accepted",
    ),
  );
  dialogue.handle(owner, { type: "dialogue-close", dialogId: opened.dialogId });
  const first = performance.now();
  let previousTick = first;
  let previous = world.snapshot().state.cenyan;
  let nextSample = 0;
  while (elapsed < 6500) {
    await delay(tickMs);
    const clock = performance.now();
    elapsed = clock - first;
    if (elapsed < 1050)
      world.setMovement({ type: "move", dx: 1, dy: 0 }, clock);
    else if (elapsed >= 2350 && elapsed < 3200)
      world.setMovement({ type: "move", dx: 0, dy: 1 }, clock);
    else world.setMovement({ type: "move", dx: 0, dy: 0 }, clock);
    world.tick(clock, clock - previousTick);
    dialogue.tick(clock);
    samples.push(performance.now() - clock);
    previousTick = clock;
    const { state, cenyan } = world.snapshot();
    assert.equal(state.cenyan.plan?.steps[0].type, "follow");
    assert.ok(isPassable(state.cenyan.x, state.cenyan.y, false));
    const travelled = distance(state.cenyan, previous);
    assert.ok(travelled <= speed / 20 + 0.001);
    movement += travelled;
    if (elapsed >= 2350) movementAfterStop += travelled;
    if (elapsed > 1200 && elapsed < 2300 && cenyan.activity === "waiting")
      stopped = true;
    previous = state.cenyan;
    minGap = Math.min(minGap, distance(state.cenyan, state.player));
    maximumPending = Math.max(maximumPending, dialogue.load.pending);
    maximumQueue = Math.max(maximumQueue, dialogue.load.queued);
    if (elapsed >= nextSample) {
      trajectory.push({
        elapsedMs: elapsed,
        player: state.player,
        cenyan: { x: state.cenyan.x, y: state.cenyan.y },
        activity: cenyan.activity,
        calls: dialogue.status.sharedUsage?.requests,
      });
      nextSample += 500;
    }
  }
  assert.equal(requests, 1);
  assert.equal(autonomy, 0);
  assert.equal(dialogue.status.sharedUsage?.requests, 1);
  assert.equal(storageIssue, undefined);
  assert.ok(stopped && movement > 55 && movementAfterStop > 20);
  assert.ok(minGap >= 8);
  assert.ok(samples.length >= 80);
  const sorted = [...samples].sort((a, b) => a - b);
  assert.ok(
    sorted[Math.ceil(sorted.length * 0.95) - 1] < tickMs,
    "P95 rule tick must fit the 50 ms step",
  );
  passed = true;
} catch (error) {
  issue = error instanceof Error ? error.message : String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  world.flush();
  await dialogue.close();
  store.close();
  const sorted = samples.sort((a, b) => a - b);
  const report = {
    status: passed ? "PASS" : "FAIL",
    issue,
    pid: process.pid,
    elapsedMs: elapsed,
    totalMs: performance.now() - begin,
    requests,
    autonomy,
    maximumPending,
    maximumQueue,
    movement,
    movementAfterStop,
    stopped,
    minGap,
    tick: {
      count: sorted.length,
      meanMs: sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxMs: sorted.at(-1),
    },
    trajectory,
  };
  writeFileSync(
    join(output, "phase31-follow-ticks.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report.status, report.elapsedMs, "ms", report.tick, {
    requests,
    autonomy,
    movement,
    movementAfterStop,
  });
  rmSync(directory, { recursive: true, force: true });
}
