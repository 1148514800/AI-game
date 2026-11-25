/**
 * Launch from the repository root with:
 * node --import tsx scripts/soak-phase3.mjs --duration 1800
 *
 * The soak drives the real local WS protocol, server timer, SQLite, shared
 * model gateway and executor. All model responses are deterministic Mock.
 */
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { WebSocket } from "ws";
import { valley } from "../src/shared/world.ts";
import { createApp } from "../src/server/app.ts";

const { values } = parseArgs({
  options: {
    duration: { type: "string" },
    smoke: { type: "boolean" },
  },
});
const smoke = values.smoke === true;
const duration = Number(values.duration ?? (smoke ? "12" : "1800"));
if (!Number.isSafeInteger(duration) || duration < (smoke ? 10 : 1800))
  throw Error(
    "Acceptance requires --duration >=1800. Use --smoke --duration >=10 for a short run.",
  );

const evidenceRoot = resolve("evidence/phase3");
mkdirSync(evidenceRoot, { recursive: true });
const evidence = mkdtempSync(
  join(evidenceRoot, smoke ? "soak-smoke-" : "soak-"),
);
const dir = mkdtempSync(join(tmpdir(), "mistsea-phase3-soak-"));
const path = join(dir, "world.sqlite");
const logPath = join(evidence, "trajectory.jsonl");
const stop = new AbortController();
const counters = {
  collections: 0,
  recoveredHarvests: 0,
  cooldownFailures: 0,
  deliveries: 0,
  bridges: 0,
  rests: 0,
  completedCycles: 0,
  modelRecovery: 0,
  motionSamples: 0,
};
const startedAt = new Date().toISOString();
const boot = performance.now();
let activeStart;
let lastSample = boot;
let maxPending = 0;
let maxQueued = 0;
let ticks = [];
let gaps = [];
let cycles = 0;
let stage = 0;
let firstDecisionBeforeDialogue = false;
let dialogue;
let dialogueRequest;
let firstReapedUntil;
let sawCooldown = false;
let sawRegrowth = false;
let sawBridge = false;
let sawRest = false;
let countedCycle = false;
let invalidAt;
let reset;
let latest;
let signature = "";
let settlement = "FAIL";
let exitCode = 1;
let reason = "did not finish";
let socket;
let ledger;
let app;

function record(event, data = {}) {
  const row = JSON.stringify({
    event,
    pid: process.pid,
    at: new Date().toISOString(),
    elapsedSec: (performance.now() - (activeStart ?? boot)) / 1000,
    ...data,
  });
  appendFileSync(logPath, row + "\n");
  console.log(row);
}

const node = valley.resources[2];
const moveToNode = { type: "move_to", target_id: node.id };
const collectNode = { type: "collect", target_id: node.id };

function fixture() {
  // Each isolated journey demonstrates format failure, a real conflicting
  // harvest during cooldown, then actual resource regrowth on the same node.
  switch (stage++) {
    case 0:
      return "{ intentionally invalid Mock response";
    case 1:
      return JSON.stringify({
        goal: "repair-bridge",
        speech: "",
        plan: [moveToNode, collectNode, collectNode],
      });
    case 2:
      return JSON.stringify({
        goal: "repair-bridge",
        speech: "",
        plan: [{ type: "wait", seconds: 23 }, moveToNode, collectNode],
      });
  }
}

function snap(message) {
  const previous = latest;
  latest = message;
  const { cenyan, bridge, cooldowns, inventory } = message.state;
  const { activity, model } = message.cenyan;
  if (inventory.wood || inventory.stone)
    throw Error("Stationary soak traveler acquired materials");
  if (
    previous &&
    (previous.state.cenyan.x !== cenyan.x ||
      previous.state.cenyan.y !== cenyan.y)
  )
    counters.motionSamples++;
  if (
    model?.trigger === "first-active" &&
    model.kind === "pending" &&
    !dialogueRequest
  )
    firstDecisionBeforeDialogue = true;
  if (model?.result === "invalid") invalidAt ??= message.now;
  if (
    invalidAt &&
    model?.result === "ok" &&
    model.trigger !== "dialogue" &&
    message.now - invalidAt >= 4800
  ) {
    counters.modelRecovery++;
    record("decided-after-format-backoff", {
      cycle: cycles + 1,
      waitMs: message.now - invalidAt,
    });
    invalidAt = undefined;
  }

  const renewedUntil = cooldowns[node.id];
  if (renewedUntil && renewedUntil !== previous?.state.cooldowns[node.id]) {
    if (!firstReapedUntil) firstReapedUntil = renewedUntil;
    else if (!sawRegrowth && message.now >= firstReapedUntil) {
      counters.recoveredHarvests++;
      sawRegrowth = true;
      record("regrown-resource-harvested", {
        resource: node.id,
        cycle: cycles + 1,
        previousCooldownUntil: firstReapedUntil,
      });
    }
  }
  const changed =
    cenyan.generation !== previous?.state.cenyan.generation ||
    cenyan.last?.code !== previous?.state.cenyan.last?.code;
  if (changed) {
    if (cenyan.last?.code === "COLLECTED") counters.collections++;
    if (cenyan.last?.code === "DELIVERED") counters.deliveries++;
    if (cenyan.last?.code === "COOLDOWN") {
      counters.cooldownFailures++;
      sawCooldown = true;
    }
    if (cenyan.last?.code === "RESTED") {
      counters.rests++;
      sawRest = true;
    }
  }
  if (bridge.repaired && !sawBridge) {
    if (
      bridge.progressMs !== valley.bridge.workMs ||
      bridge.wood !== 6 ||
      bridge.stone !== 2
    )
      throw Error("Bridge rules inconsistent");
    counters.bridges++;
    sawBridge = true;
  }
  const nextSignature = JSON.stringify([
    activity,
    cenyan.plan?.id,
    cenyan.plan?.index,
    cenyan.last?.code,
    model?.kind,
    model?.result,
  ]);
  if (nextSignature !== signature) {
    signature = nextSignature;
    record("state", {
      cycle: cycles + 1,
      activity,
      goal: cenyan.goal,
      position: [Math.round(cenyan.x), Math.round(cenyan.y)],
      direction: cenyan.facing,
      plan: cenyan.plan?.steps,
      step: cenyan.plan?.index,
      bag: cenyan.bag,
      result: cenyan.last?.code,
      model,
      bridge,
    });
  }
  if (!countedCycle && sawBridge && sawRest && sawCooldown && sawRegrowth) {
    counters.completedCycles++;
    countedCycle = true;
    if (!smoke) {
      reset = randomUUID();
      send({ type: "reset", id: reset, confirm: true });
    }
  }
}

function observe(raw) {
  const message = JSON.parse(raw.toString());
  if (message.type === "snapshot") snap(message);
  if (message.type === "result" && message.id === reset) {
    if (!message.ok)
      throw Error("Normal isolated journey reset failed: " + message.code);
    cycles++;
    stage = 0;
    reset = undefined;
    firstReapedUntil = undefined;
    invalidAt = undefined;
    sawBridge = sawRest = sawCooldown = sawRegrowth = countedCycle = false;
    record("journey-reset", { cycles });
  }
  if (message.type === "error") throw Error("Server error: " + message.code);
  if (message.type === "dialogue" && message.event === "opened") {
    dialogue = message.dialogId;
    dialogueRequest = randomUUID();
    send({
      type: "dialogue-send",
      id: dialogueRequest,
      dialogId: dialogue,
      text: "你最近在忙什么？",
    });
  }
  if (message.type === "dialogue" && message.event === "reply") {
    send({ type: "dialogue-close", dialogId: dialogue });
    record("mock-dialogue-completed");
  }
  if (message.type === "dialogue" && message.event === "error")
    throw Error("Mock dialogue failed: " + message.code);
}

function send(message) {
  socket.send(JSON.stringify(message));
}

async function ordinaryDialogue() {
  for (const [axis, threshold, sign] of [
    ["x", 247, 1],
    ["y", 321, -1],
  ]) {
    const deadline = performance.now() + 4000;
    const move = {
      type: "move",
      dx: axis === "x" ? sign : 0,
      dy: axis === "y" ? sign : 0,
    };
    while (!latest || (latest.state.player[axis] - threshold) * sign < 0) {
      if (performance.now() >= deadline)
        throw Error("Could not reach the workshop by normal WS input");
      send(move);
      await delay(35, undefined, { signal: stop.signal });
    }
    send({ type: "move", dx: 0, dy: 0 });
  }
  send({ type: "dialogue-open", id: randomUUID(), npc: "cenyan" });
}

function modelTotals() {
  if (!ledger) return [];
  return ledger
    .prepare(
      `
    SELECT mode, purpose, status, count(*) AS calls, sum(charged_tokens) AS chargedTokens,
           sum(charged_nano) AS chargedNanoUsd
    FROM calls GROUP BY mode, purpose, status ORDER BY mode, purpose, status
  `,
    )
    .all();
}

function distribution(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.ceil(sorted.length * p) - 1];
  return {
    count: sorted.length,
    mean: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1),
  };
}

function metrics() {
  record("metrics", {
    counters: { ...counters },
    tickCallbackMs: distribution(ticks),
    tickIntervalMs: distribution(gaps),
    maxPending,
    maxQueued,
    rssBytes: process.memoryUsage().rss,
    ledger: modelTotals(),
  });
  ticks = [];
  gaps = [];
  lastSample = performance.now();
}

function onSignal(signal) {
  stop.abort(Error(signal));
}
const terminate = () => onSignal("SIGTERM");
const interrupt = () => onSignal("SIGINT");
process.once("SIGTERM", terminate);
process.once("SIGINT", interrupt);

record("start", {
  startedAt,
  durationSec: duration,
  mode: smoke ? "SHORT SMOKE · Mock" : "ACCEPTANCE · Mock",
  evidence,
  isolatedSave: path,
});
try {
  app = createApp({
    savePath: path,
    dialogueEnv: {
      LLM_ENABLED: "false",
      LLM_AUTONOMY_ENABLED: "false",
      LLM_MOCK_AUTONOMY_ENABLED: "true",
      LLM_MOCK_DELAY_MS: "350",
      LLM_MAX_REQUESTS_PER_MINUTE: "30",
      LLM_AUTONOMY_REQUESTS_PER_MINUTE: "25",
      LLM_MAX_REQUESTS_PER_SESSION: "600",
      LLM_AUTONOMY_REQUESTS_PER_SESSION: "500",
      LLM_MAX_TOTAL_REQUESTS: "1500",
      LLM_AUTONOMY_MAX_TOTAL_REQUESTS: "1200",
      LLM_MAX_TOTAL_TOKENS: "12000000",
    },
    mockDecision: fixture,
    observeTick({ elapsedMs, durationMs, pending, queued }) {
      ticks.push(durationMs);
      gaps.push(elapsedMs);
      maxPending = Math.max(maxPending, pending);
      maxQueued = Math.max(maxQueued, queued);
    },
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  ledger = new DatabaseSync(path + ".llm.sqlite", { readOnly: true });
  socket = new WebSocket(address.replace("http:", "ws:") + "/ws");
  socket.on("close", () =>
    stop.abort(Error("Player WS disconnected during soak")),
  );
  socket.on("message", (raw) => {
    try {
      observe(raw);
    } catch (error) {
      stop.abort(error);
    }
  });
  socket.on("error", (error) => stop.abort(error));
  await once(socket, "open");
  activeStart = lastSample = performance.now();
  record("active", { address, activeAt: new Date().toISOString() });
  await ordinaryDialogue();
  while (performance.now() - activeStart < duration * 1000) {
    if (performance.now() - lastSample >= 60_000) metrics();
    await delay(
      Math.min(
        1000,
        Math.max(1, duration * 1000 - (performance.now() - activeStart)),
      ),
      undefined,
      { signal: stop.signal },
    );
  }
  stop.signal.throwIfAborted();
  metrics();
  const totals = modelTotals();
  if (
    !firstDecisionBeforeDialogue ||
    !totals.some((row) => row.purpose === "dialogue" && row.status === "ok") ||
    totals.some((row) => row.mode !== "mock") ||
    maxPending !== 1 ||
    maxQueued > 1 ||
    !counters.motionSamples ||
    !counters.modelRecovery
  )
    throw Error(
      "Missing autonomous start, failure recovery, shared ledger or bounded model concurrency evidence",
    );
  if (
    !smoke &&
    (performance.now() - activeStart < 1800_000 ||
      counters.completedCycles < 2 ||
      counters.deliveries < 2 ||
      counters.bridges < 2 ||
      counters.rests < 2 ||
      counters.recoveredHarvests < 2 ||
      counters.cooldownFailures < 2)
  )
    throw Error(
      "Missing real elapsed time or repeated harvest/cooldown/work/rest cycles",
    );
  settlement = smoke ? "SMOKE PASS (not acceptance)" : "PASS";
  reason = undefined;
  exitCode = 0;
} catch (error) {
  reason = stop.signal.reason?.message ?? error.message;
} finally {
  const activeElapsedSec =
    activeStart === undefined ? 0 : (performance.now() - activeStart) / 1000;
  socket?.terminate();
  try {
    await app?.close();
  } catch (error) {
    exitCode = 1;
    settlement = "FAIL";
    reason = "Service shutdown: " + error.message;
  }
  let totals = [];
  try {
    totals = modelTotals();
  } catch (error) {
    exitCode = 1;
    settlement = "FAIL";
    reason = "Ledger summary: " + error.message;
  } finally {
    ledger?.close();
  }
  rmSync(dir, { recursive: true, force: true });
  process.off("SIGTERM", terminate);
  process.off("SIGINT", interrupt);
  const summary = {
    startedAt,
    endedAt: new Date().toISOString(),
    pid: process.pid,
    durationSec: duration,
    activeElapsedSec,
    elapsedSec: (performance.now() - boot) / 1000,
    smoke,
    result: settlement,
    exitCode,
    reason,
    counters,
    maxPending,
    maxQueued,
    ledger: totals,
    trajectory: logPath,
  };
  writeFileSync(
    join(evidence, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  record("end", summary);
  process.exitCode = exitCode;
}
