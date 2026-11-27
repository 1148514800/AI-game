import { monitorEventLoopDelay } from "node:perf_hooks";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import { createApp } from "../src/server/app.ts";
import { npcIds } from "../src/shared/social.ts";
import {
  clues,
  gameTime,
  inventoryLimit,
  isPassable,
  localProjects,
  valley,
} from "../src/shared/world.ts";

const option = process.argv.indexOf("--duration");
const seconds = option === -1 ? 1800 : Number(process.argv[option + 1]);
assert.ok(
  Number.isFinite(seconds) && seconds >= 1800,
  "--duration must be at least 1800 seconds.",
);
const outputRoot = resolve(process.env.MISTSEA_EVIDENCE ?? "evidence/phase5");
mkdirSync(outputRoot, { recursive: true });
const output = mkdtempSync(join(outputRoot, "soak-"));
const store = mkdtempSync(join(tmpdir(), "mistsea-phase4-soak-"));
const savePath = join(store, "valley.sqlite");
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
const tickTimes = [];
const tickIntervals = [];
const frameIntervals = [];
const frameWork = [];
const samples = [];
const developments = [];
const errors = [];
const actions = Object.fromEntries(
  npcIds.map((id) => [id, { ok: 0, failed: 0, codes: {} }]),
);
const speech = Object.fromEntries(npcIds.map((id) => [id, 0]));
const collected = { wood: 0, stone: 0, food: 0, toolbox: 0 };
const talks = new Map();
const finishedTalks = { ok: 0, failed: 0 };
let peakPending = 0;
let peakQueued = 0;
let snapshotCount = 0;
let persistedSnapshots = 0;
let latest;
let started;
let elapsedMs = 0;
let browser;
let cdp;
let app;
let page;
let startMemory;
let accounts = [];
let invariantFailure;
let picturedNight = false;
let status = "FAIL";
let commandError;
const endSignal = new AbortController();
const interrupt = () => endSignal.abort(Error("Soak interrupted"));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const mock = {
  LLM_ENABLED: "false",
  LLM_MOCK_AUTONOMY_ENABLED: "true",
  LLM_MOCK_DELAY_MS: "200",
  LLM_MAX_REQUESTS_PER_MINUTE: "60",
  LLM_AUTONOMY_REQUESTS_PER_MINUTE: "40",
  LLM_MAX_REQUESTS_PER_SESSION: "300",
  LLM_AUTONOMY_REQUESTS_PER_SESSION: "260",
  LLM_MAX_TOTAL_REQUESTS: "300",
  LLM_AUTONOMY_MAX_TOTAL_REQUESTS: "260",
  LLM_MAX_TOTAL_TOKENS: "2500000",
};

function distribution(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    count: sorted.length,
    mean: sorted.reduce((result, next) => result + next, 0) / sorted.length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}

function checkState({ state }) {
  const { bridge } = valley;
  const points = [state.player, ...Object.values(state.actors)];
  assert.ok(
    points.every(({ x, y }) => isPassable(x, y, state.bridge.repaired)),
  );
  const bags = [
    state.inventory,
    ...Object.values(state.actors).map((actor) => actor.bag),
  ];
  assert.ok(
    bags.every((bag) =>
      Object.values(bag).every(
        (value) =>
          Number.isInteger(value) && value >= 0 && value <= inventoryLimit,
      ),
    ),
  );
  const contribution = Object.values(state.contributions);
  for (const item of ["wood", "stone"]) {
    assert.equal(
      contribution.reduce((sum, entry) => sum + entry[item], 0),
      state.bridge[item],
    );
    assert.ok(state.bridge[item] <= bridge.required[item]);
  }
  const work = contribution.reduce((sum, entry) => sum + entry.workMs, 0);
  assert.ok(Math.abs(work - state.bridge.progressMs) < 0.001);
  assert.ok(state.sharedWorkMs <= state.bridge.progressMs / 2 + 0.001);
  assert.equal(
    state.bridge.repaired,
    state.bridge.progressMs === bridge.workMs,
  );
  assert.deepEqual(state.contributions.player, {
    wood: 0,
    stone: 0,
    workMs: 0,
  });
  assert.deepEqual(state.inventory, { wood: 0, stone: 0, food: 0, toolbox: 0 });
  for (const definition of localProjects) {
    const project = state.projects[definition.id];
    const credits = Object.values(project.contributions);
    for (const [item, required] of Object.entries(definition.required)) {
      assert.equal(
        credits.reduce((sum, entry) => sum + (entry[item] ?? 0), 0),
        project[item],
      );
      assert.ok(project[item] <= (definition.capacity?.[item] ?? required));
    }
    assert.ok(
      Math.abs(credits.reduce((sum, entry) => sum + entry.workMs, 0) -
        project.progressMs) < 0.001,
    );
    assert.equal(
      project.complete,
      project.progressMs === definition.workMs &&
        Object.entries(definition.required).every(([item, required]) => project[item] >= required),
    );
  }
}

function observeWorld(event) {
  if (event.kind === "action" && event.actor !== "player") {
    const counts = actions[event.actor];
    counts[event.ok ? "ok" : "failed"]++;
    counts.codes[event.code] = (counts.codes[event.code] ?? 0) + 1;
    if (event.code === "COLLECTED" && event.ok)
      for (const item of Object.keys(collected))
        collected[item] += event.materials?.[item] ?? 0;
    if (
      started !== undefined && event.ok &&
      ["DELIVERED", "PROJECT_COMPLETED", "BRIDGE_REPAIRED", "DISCOVERED", "CLUE_SHARED"].includes(event.code)
    )
      developments.push({
        elapsedMs: performance.now() - started,
        actor: event.actor,
        code: event.code,
        materials: event.materials,
      });
  }
  if (event.kind === "speech") {
    speech[event.actor]++;
    const session = talks.get(event.session) ?? [];
    session.push(event.actor);
    talks.set(event.session, session);
  }
  if (event.kind === "conversation")
    finishedTalks[event.ok ? "ok" : "failed"]++;
}

async function sample() {
  const frame = await page.evaluate(() => {
    const state = window.__mistseaPhase4Frames;
    return {
      intervals: state.intervals.splice(0),
      work: state.work.splice(0),
      visible: document.visibilityState,
    };
  });
  assert.equal(frame.visible, "visible");
  if (
    !picturedNight &&
    latest &&
    gameTime(latest.state.gameSeconds).period === "夜晚"
  ) {
    await page.screenshot({
      path: join(output, "soak-night.png"),
      fullPage: true,
    });
    picturedNight = true;
  }
  frameIntervals.push(...frame.intervals);
  frameWork.push(...frame.work);
  const heap = await cdp.send("Runtime.getHeapUsage");
  const counters = await cdp.send("Memory.getDOMCounters");
  const tasks = {};
  for (const name of process.getActiveResourcesInfo())
    tasks[name] = (tasks[name] ?? 0) + 1;
  samples.push({
    elapsedMs: performance.now() - started,
    serverAndRunnerMemory: process.memoryUsage(),
    serverTasks: tasks,
    clientHeap: heap,
    browserDocuments: counters.documents,
    browserNodes: counters.nodes,
    browserListeners: counters.jsEventListeners,
    snapshots: snapshotCount,
    gameSeconds: latest.state.gameSeconds,
    goals: Object.fromEntries(npcIds.map((id) => [id, latest.state.actors[id].goal])),
    activePlans: npcIds.filter((id) => latest?.state.actors[id].plan).length,
  });
  writeFileSync(
    join(output, "samples.json"),
    JSON.stringify(samples, undefined, 2),
  );
}

function ledgerReport() {
  const path = savePath + ".llm.sqlite";
  if (!existsSync(path)) return [];
  const ledger = new DatabaseSync(path, { readOnly: true });
  try {
    return ledger
      .prepare(
        `
      SELECT npc, purpose, intent, model, mode, status, COUNT(*) AS calls,
        SUM(charged_tokens) AS tokens FROM calls GROUP BY npc, purpose, intent, model, mode, status
    `,
      )
      .all();
  } finally {
    ledger.close();
  }
}

try {
  assert.ok(
    existsSync("release/client/index.html"),
    "Run npm run build before the browser soak.",
  );
  app = createApp({
    savePath,
    staticRoot: resolve("release/client"),
    dialogueEnv: mock,
    observeWorld,
    observeTick({
      elapsedMs: interval,
      durationMs,
      pending,
      pendingActors,
      queued,
    }) {
      if (started === undefined) return;
      tickTimes.push(durationMs);
      tickIntervals.push(interval);
      peakPending = Math.max(peakPending, pending);
      peakQueued = Math.max(peakQueued, queued);
      if (
        pending > 2 ||
        pendingActors.length !== new Set(pendingActors).size ||
        pending !== pendingActors.length
      )
        invariantFailure ??= "In-flight request limit violated";
    },
  });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  browser = await chromium.launch({
    chromiumSandbox: true,
    ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  cdp = await page.context().newCDPSession(page);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      try {
        const snapshot = JSON.parse(String(payload));
        if (snapshot.type !== "snapshot") return;
        latest = snapshot;
        snapshotCount++;
        checkState(snapshot);
      } catch (error) {
        invariantFailure ??= error.message;
      }
    }),
  );
  await page.addInitScript(() => {
    const state = (window.__mistseaPhase4Frames = { intervals: [], work: [] });
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      original((time) => {
        const start = performance.now();
        try {
          callback(time);
        } finally {
          state.work.push(performance.now() - start);
        }
      });
    let previous;
    function frame(now) {
      if (previous !== undefined) state.intervals.push(now - previous);
      previous = now;
      original(frame);
    }
    original(frame);
  });
  await page.goto(url);
  await expect(page.locator("#game")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => {
    window.__mistseaPhase4Frames.intervals.length = 0;
    window.__mistseaPhase4Frames.work.length = 0;
  });
  startMemory = process.memoryUsage();
  eventLoopDelay.enable();
  started = performance.now();
  while (performance.now() - started < seconds * 1000) {
    await delay(
      Math.min(
        15_000,
        Math.max(1, seconds * 1000 - (performance.now() - started)),
      ),
      undefined,
      { signal: endSignal.signal },
    );
    if (invariantFailure) throw Error(invariantFailure);
    await sample();
  }
  elapsedMs = performance.now() - started;
  await page.locator("#pause").click();
  await expect(page.locator("#pause")).toHaveText("继续");
  await expect
    .poll(() => npcIds.every((id) => latest.actors[id].activity === "paused"))
    .toBe(true);
  assert.ok(!invariantFailure, invariantFailure);
  assert.ok(elapsedMs >= 1_800_000);
  assert.ok(
    frameIntervals.length > 0 && frameWork.length > 0 && tickTimes.length > 0,
  );
  assert.deepEqual(errors, []);
  assert.ok(latest.state.bridge.repaired && latest.state.sharedWorkMs > 0);
  assert.ok(latest.state.projects["carpenter-roof"].complete);
  assert.ok(latest.state.projects["carpenter-roof"].contributions.cenyan.workMs > 0);
  assert.ok(latest.state.projects["valley-camp"].complete);
  assert.ok(latest.state.projects["valley-camp"].contributions.ahe.food >= 2);
  assert.equal(latest.state.discoveries.luozhou.length, clues.length);
  assert.ok(
    developments.some(({ actor, code }) => actor === "cenyan" && code === "PROJECT_COMPLETED"),
  );
  assert.equal(
    developments.filter(({ actor, code }) => actor === "luozhou" && code === "DISCOVERED").length,
    clues.length,
  );
  assert.ok(finishedTalks.ok >= 2);
  assert.ok(
    [...talks.values()].every(
      (actors) =>
        actors.length <= 4 &&
        actors.every((id, index) => index === 0 || id !== actors[index - 1]),
    ),
  );
  for (const npc of npcIds) {
    assert.ok(actions[npc].codes.COLLECTED > 0);
    assert.ok(actions[npc].codes.RESTED > 0);
    assert.ok(
      latest.state.contributions[npc].wood +
        latest.state.contributions[npc].stone >
        0,
    );
  }
  for (const material of Object.keys(collected)) {
    const bags = npcIds.reduce(
      (sum, id) => sum + (latest.state.actors[id].bag[material] ?? 0),
      0,
    );
    const delivered = Object.values(latest.state.projects).reduce(
      (sum, project) => sum + (project[material] ?? 0),
      0,
    );
    assert.equal(
      bags + delivered + (latest.state.bridge[material] ?? 0),
      collected[material],
    );
  }
  await page.screenshot({
    path: join(output, "soak-final.png"),
    fullPage: true,
  });
  await browser.close();
  browser = undefined;
  await app.close();
  app = undefined;
  accounts = ledgerReport();
  assert.ok(
    npcIds.every((npc) =>
      accounts.some((entry) => entry.npc === npc && entry.calls > 0),
    ),
  );
  assert.ok(
    accounts.every(
      (entry) => entry.mode === "mock" && entry.status !== "pending",
    ),
  );
  const db = new DatabaseSync(savePath, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    const state = JSON.parse(
      db.prepare("SELECT payload FROM world").get().payload,
    );
    checkState({ state });
    assert.deepEqual(state.contributions, latest.state.contributions);
    assert.deepEqual(state.projects, latest.state.projects);
    assert.deepEqual(state.discoveries, latest.state.discoveries);
    persistedSnapshots = db
      .prepare("SELECT revision FROM world")
      .get().revision;
  } finally {
    db.close();
  }
  status = "PASS";
} catch (error) {
  commandError = error.stack ?? String(error);
  console.error(commandError);
  process.exitCode = 1;
} finally {
  if (started !== undefined && !elapsedMs)
    elapsedMs = performance.now() - started;
  if (browser) await browser.close().catch(() => {});
  if (app) await app.close().catch(() => {});
  if (!accounts.length) accounts = ledgerReport();
  eventLoopDelay.disable();
  const frame = distribution(frameIntervals);
  const report = {
    status,
    commandError,
    requestedSeconds: seconds,
    elapsedMs,
    mockOnly: true,
    mockLimits: mock,
    snapshotCount,
    persistedRevisions: persistedSnapshots,
    peakPending,
    peakQueued,
    finishedTalks,
    speech,
    actions,
    accounts,
    collected,
    project: latest?.state.bridge,
    localProjects: latest?.state.projects,
    discoveries: latest?.state.discoveries,
    developments,
    gameSeconds: latest?.state.gameSeconds,
    contributions: latest?.state.contributions,
    eventLoopDelayMs: {
      p95: eventLoopDelay.percentile(95) / 1e6,
      max: eventLoopDelay.max / 1e6,
    },
    tickMs: distribution(tickTimes),
    tickIntervalMs: distribution(tickIntervals),
    clientFrameIntervalMs: frame,
    clientRafCallbackMs: distribution(frameWork),
    clientFps: frame && 1000 / frame.mean,
    startMemory,
    endMemory: process.memoryUsage(),
    samples: samples.length,
    errors,
  };
  if (samples.length)
    writeFileSync(
      join(output, "timings.json"),
      JSON.stringify({
        tickTimes,
        tickIntervals,
        frameIntervals,
        frameWork,
      }),
    );
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify(report, undefined, 2) + "\n",
  );
  rmSync(store, { recursive: true, force: true });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  console.log(`${status} ${elapsedMs.toFixed(0)} ms · ${output}`);
}
