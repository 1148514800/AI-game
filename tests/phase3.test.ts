import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { WebSocket } from "ws";
import {
  actionReplySchema,
  decisionSchema,
  home,
  type Step,
} from "../src/shared/cenyan.js";
import type {
  Action,
  DialogueEvent,
  SaveState,
} from "../src/shared/protocol.js";
import {
  distance,
  isPassable,
  valley,
  type Point,
} from "../src/shared/world.js";
import { readDialogueConfig } from "../src/server/dialogue/config.js";
import { DialogueLedger } from "../src/server/dialogue/ledger.js";
import { mockPlan } from "../src/server/dialogue/planning.js";
import { DialogueSession } from "../src/server/dialogue/session.js";
import { findPath } from "../src/server/path.js";
import { SaveFile, freshState } from "../src/server/save.js";
import { World } from "../src/server/world.js";

const bridge = valley.bridge;
const node = valley.resources[2];
const point = { x: node.x + 20, y: node.y, facing: "left" } as const;
const mock = {
  LLM_MOCK_AUTONOMY_ENABLED: "true",
  LLM_MOCK_DELAY_MS: "15",
  LLM_ENABLED: "false",
};
const liveFixture = {
  LLM_ENABLED: "true",
  LLM_BASE_URL: "http://127.0.0.1:1/v1",
  LLM_API_KEY: "local-generation-test",
  LLM_MODEL: "local-fixture",
  LLM_MAX_TOTAL_USD: "1",
  LLM_INPUT_USD_PER_MILLION: "0",
  LLM_OUTPUT_USD_PER_MILLION: "0",
};
const socket = {} as WebSocket;

function disk(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "mistsea-phase3-unit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "world.sqlite");
}

function setup(t: TestContext, seed?: (state: SaveState) => void) {
  const path = disk(t);
  if (seed) {
    const file = new SaveFile(path);
    const state = freshState();
    seed(state);
    file.write(state);
    file.close();
  }
  const save = new SaveFile(path);
  t.after(() => save.close());
  const world = new World(save);
  let clock = 10_000;
  function tick(count = 1, holdCenyan = false) {
    for (let i = 0; i < count; i++) {
      clock += 50;
      world.tick(clock, 50, clock, holdCenyan);
    }
  }
  function accept(...plan: Step[]) {
    assert.ok(
      world.accept(
        randomUUID(),
        { goal: "repair-bridge", speech: "", plan },
        clock,
      ),
    );
  }
  return { path, save, world, tick, accept, now: () => clock };
}

const action = (verb: Action["verb"], target: string): Action => ({
  type: "action",
  id: randomUUID(),
  verb,
  target,
});

async function until(check: () => boolean) {
  for (let i = 0; i < 80; i++) {
    if (check()) return;
    await delay(5);
  }
  assert.fail("Result did not settle");
}

function session(
  world: World,
  env: NodeJS.ProcessEnv = mock,
  fixture?: () => string,
) {
  const state = { active: true };
  const events: DialogueEvent[] = [];
  const handler = new DialogueSession(
    ":memory:",
    () =>
      state.active && world.canTalkToCenyan()
        ? { near: true, bridge: world.publicBridge() }
        : undefined,
    (_socket, event) => events.push(event),
    env,
    () => world.haltPlayer(),
    {
      world,
      active: () => state.active,
      storageError: (error) => assert.fail(String(error)),
      mockDecision: fixture,
    },
  );
  function open() {
    handler.handle(socket, {
      type: "dialogue-open",
      id: randomUUID(),
      npc: "cenyan",
    });
    const event = events.at(-1);
    assert.ok(event?.event === "opened");
    return event.dialogId;
  }
  function ask(dialogId: string, text: string) {
    const id = randomUUID();
    handler.handle(socket, { type: "dialogue-send", id, dialogId, text });
    return id;
  }
  return { handler, state, events, open, ask };
}

test("planner schemas accept one through three steps and accept speech-only refusals", () => {
  const step = { type: "collect", target_id: node.id };
  const base = { goal: "stock-wood", speech: "先找木料。" };
  for (const count of [1, 2, 3])
    assert.ok(
      decisionSchema.safeParse({ ...base, plan: Array(count).fill(step) })
        .success,
    );
  assert.ok(actionReplySchema.safeParse(base).success);
  for (const count of [0, 4])
    assert.equal(
      decisionSchema.safeParse({ ...base, plan: Array(count).fill(step) })
        .success,
      false,
    );
});

test("planner schemas reject arbitrary locations, unknown IDs, tools, extras and out-of-range waits", () => {
  const base = { goal: "stock-wood", speech: "" };
  for (const step of [
    { type: "move_to", x: 5, y: 10, target_id: home.id },
    { type: "collect", target_id: bridge.id },
    { type: "work", target_id: node.id },
    { type: "move_to", target_id: "imaginary-place" },
    { type: "sql", query: "x" },
    { type: "wait", seconds: 31 },
    { type: "rest", seconds: 0.1 },
  ])
    assert.equal(
      decisionSchema.safeParse({ ...base, plan: [step] }).success,
      false,
    );
  assert.equal(
    decisionSchema.safeParse({
      ...base,
      plan: [{ type: "wait", seconds: 1 }],
      reasoning: "x",
    }).success,
    false,
  );
});

test("A* seeks a reachable interaction neighbor and routes to the east only after repairs", () => {
  const initial = freshState().cenyan;
  const path = findPath(initial, node, false);
  assert.ok(path?.length);
  assert.ok(distance(path.at(-1)!, node) <= node.range);
  let previous: Point = initial;
  for (const point of path) {
    assert.equal(distance(previous, point), 8);
    assert.ok(
      isPassable((point.x + previous.x) / 2, (point.y + previous.y) / 2, false),
    );
    assert.ok(isPassable(point.x, point.y, false));
    previous = point;
  }
  assert.equal(findPath(initial, valley.ruin, false), undefined);
  assert.ok(findPath(initial, valley.ruin, true)?.length);
});

test("Cenyan cannot pass through the player and can recover after the player moves", (t) => {
  const { world, tick, accept, now } = setup(t, (state) => {
    state.cenyan.x = 285;
    state.cenyan.y = 368;
    state.player = { x: 309, y: 368, facing: "down" };
  });
  accept({ type: "move_to", target_id: bridge.id });
  for (let i = 0; i < 70 && world.decisionState.executing; i++) {
    if (i < 12) world.setMovement({ type: "move", dx: 0, dy: 1 }, now());
    if (i === 12) world.setMovement({ type: "move", dx: 0, dy: 0 }, now());
    tick();
    const { cenyan, player } = world.snapshot().state;
    assert.ok(distance(cenyan, player) >= 8);
    assert.ok(isPassable(cenyan.x, cenyan.y, false));
  }
  assert.equal(world.snapshot().state.cenyan.last?.code, "ARRIVED");
});

test("runtime interaction range follows Cenyan and leaves the former workshop position", (t) => {
  const { world, tick, accept } = setup(t, (state) => {
    state.player = { x: home.x - 20, y: home.y + 16, facing: "down" };
  });
  assert.equal(world.canTalkToCenyan(), true);
  accept({ type: "move_to", target_id: node.id });
  tick(100);
  assert.equal(world.canTalkToCenyan(), false);
  assert.equal(world.perform(action("inspect", "cenyan")).code, "TOO_FAR");
});

test("a player harvest wins atomically, and Cenyan collects only once after real rule cooldown", (t) => {
  const { world, tick, accept, now } = setup(t, (state) => {
    Object.assign(state.cenyan, point);
    state.player = { ...point, y: point.y + 14 };
  });
  const request = action("collect", node.id);
  assert.equal(world.perform(request, now()).code, "COLLECTED");
  accept({ type: "collect", target_id: node.id });
  tick();
  assert.equal(world.snapshot().state.cenyan.last?.code, "COOLDOWN");
  tick(node.cooldownMs / 50);
  accept({ type: "collect", target_id: node.id });
  tick();
  assert.equal(
    world.perform(action("collect", node.id), now()).code,
    "COOLDOWN",
  );
  assert.equal(world.perform(request, now()).code, "DUPLICATE");
  assert.equal(world.snapshot().state.inventory.wood, 1);
  assert.equal(world.snapshot().state.cenyan.bag.wood, 1);
});

test("NPC delivery, shared work and progress survive interruption without double spending", (t) => {
  const { world, tick, accept, path, now } = setup(t, (state) => {
    Object.assign(state.cenyan, { x: bridge.x - 15, y: bridge.y });
    state.player = { x: bridge.x - 24, y: bridge.y + 10, facing: "right" };
    state.cenyan.bag = { wood: 6, stone: 2 };
  });
  accept(
    { type: "deliver", target_id: bridge.id },
    { type: "work", target_id: bridge.id },
  );
  tick(18);
  assert.equal(world.snapshot().state.bridge.wood, 6);
  assert.ok(world.snapshot().state.bridge.progressMs > 0);
  assert.equal(
    world.perform(action("work", bridge.id), now()).code,
    "WORK_STARTED",
  );
  const beforeShared = world.snapshot().state.bridge.progressMs;
  tick(1);
  assert.equal(world.snapshot().state.bridge.progressMs - beforeShared, 100);
  assert.equal(world.snapshot().state.sharedWorkMs, 50);
  world.halt();
  world.flush();
  const restored = new SaveFile(path);
  try {
    const resumed = new World(restored);
    assert.equal(resumed.snapshot().state.cenyan.plan?.index, 1);
    assert.deepEqual(resumed.snapshot().state.cenyan.bag, {
      wood: 0,
      stone: 0,
    });
    const progress = resumed.snapshot().state.bridge.progressMs;
    assert.ok(progress < bridge.workMs);
    for (let i = 0; i < bridge.workMs / 50 - 1; i++)
      resumed.tick(i * 50, 50, now());
    assert.equal(resumed.snapshot().state.bridge.repaired, true);
    assert.equal(resumed.snapshot().state.cenyan.plan, null);
    assert.equal(resumed.snapshot().state.inventory.wood, 0);
    assert.equal(
      restored
        .memories(bridge.id, 20)
        .filter((m) => m.content.startsWith("岑砚交付木材 ×6、石材 ×2")).length,
      1,
    );
  } finally {
    restored.close();
  }
});

test("isolated Mock choices repair a bridge from empty bags, then stock wood and rest at the workshop", (t) => {
  const { world, tick, now } = setup(t);
  const launch = world.snapshot().state.cenyan;
  let repaired = false;
  for (let i = 0; i < 50; i++) {
    assert.ok(
      world.accept(
        randomUUID(),
        mockPlan(world.perceive(undefined, now())),
        now(),
      ),
    );
    for (let step = 0; step < 1_000 && world.decisionState.executing; step++)
      tick();
    assert.equal(world.decisionState.executing, false, "plan terminates");
    const state = world.snapshot().state;
    if (!repaired && state.bridge.repaired) {
      assert.ok(distance(state.cenyan, launch) > 20);
      assert.equal(state.inventory.wood, 0);
      assert.equal(state.bridge.progressMs, bridge.workMs);
      repaired = true;
    }
    if (state.cenyan.last?.code === "RESTED") {
      assert.ok(repaired);
      assert.ok(state.cenyan.bag.wood >= 8);
      assert.ok(distance(state.cenyan, home) <= home.range);
      return;
    }
  }
  assert.fail("Cenyan did not finish the bridge and rest");
});

test("perception excludes far people, unknown resource availability and the player's private bag", (t) => {
  const { world } = setup(t, (state) => {
    state.inventory = { wood: 941, stone: 942, food: 943, toolbox: 944 };
    state.player = { x: 24, y: 32, facing: "left" };
  });
  const view = world.perceive();
  assert.equal(
    view.people.some((person) => person.id === valley.spawn.id),
    false,
  );
  assert.ok(view.resources.length < valley.resources.length);
  assert.doesNotMatch(JSON.stringify(view), /94[1-4]|inventory|cooldowns/);
});

test("factual failure persists beside claims and opinions, with stable reference and no invented completion", (t) => {
  const { world, tick, accept, path, now } = setup(t);
  world.rememberExchange(
    "exchange-1",
    "我说旧桥已经修好",
    "你说得有道理。",
    now(),
  );
  accept({ type: "work", target_id: bridge.id });
  tick();
  const reopened = new SaveFile(path);
  try {
    const memory = reopened.memories(bridge.id, 10);
    assert.ok(
      memory.some(
        (m) =>
          m.kind === "claim" &&
          m.source === "traveler" &&
          m.event === "exchange-1",
      ),
    );
    assert.ok(memory.some((m) => m.kind === "opinion" && m.actor === "cenyan"));
    assert.ok(
      memory.some(
        (m) =>
          m.kind === "fact" &&
          m.source === "rules" &&
          /超出交互距离/.test(m.content),
      ),
    );
    assert.ok(
      !memory.some((m) => m.kind === "fact" && /已修好/.test(m.content)),
    );
    assert.equal(reopened.initial.bridge.repaired, false);
    assert.deepEqual(reopened.memories(bridge.id, 10), memory);
  } finally {
    reopened.close();
  }
});

test("v1 migration backs up the old SQLite schema and receipts before adding the actor", (t) => {
  const path = disk(t);
  const {
    player,
    inventory,
    cooldowns,
    bridge,
    explored,
    contentVersion,
    worldId,
  } = freshState();
  const state = {
    player,
    inventory,
    cooldowns,
    bridge,
    explored,
    contentVersion,
    worldId,
  };
  state.inventory.wood = 3;
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE world(slot INTEGER PRIMARY KEY, revision INTEGER, payload TEXT); CREATE TABLE receipts(id TEXT PRIMARY KEY); PRAGMA user_version = 1",
  );
  db.prepare("INSERT INTO world VALUES (1, 10, ?)").run(
    JSON.stringify({ ...state, schemaVersion: 1 }),
  );
  db.prepare("INSERT INTO receipts VALUES (?)").run("prior-receipt");
  db.close();
  const migrated = new SaveFile(path);
  try {
    assert.equal(migrated.initial.schemaVersion, 5);
    assert.equal(migrated.initial.inventory.wood, 3);
    assert.deepEqual(migrated.initial.cenyan.bag, { wood: 0, stone: 0 });
    assert.ok(migrated.hasReceipt("prior-receipt"));
    const backup = new DatabaseSync(path + ".pre-phase4.sqlite", {
      readOnly: true,
    });
    try {
      assert.equal(
        backup.prepare("PRAGMA user_version").get()?.user_version,
        1,
      );
      assert.equal(
        backup.prepare("SELECT id FROM receipts").get()?.id,
        "prior-receipt",
      );
      assert.equal(
        backup.prepare("SELECT revision FROM world").get()?.revision,
        10,
      );
    } finally {
      backup.close();
    }
  } finally {
    migrated.close();
  }
});

test("only explicitly enabled active Mock autonomy requests a plan without dialogue", async (t) => {
  const { world } = setup(t);
  const enabled = session(world);
  const disabled = session(world, {
    ...mock,
    LLM_MOCK_AUTONOMY_ENABLED: "false",
  });
  t.after(async () => {
    await enabled.handler.close();
    await disabled.handler.close();
  });
  disabled.handler.tick(performance.now());
  assert.equal(disabled.handler.load.pending, 0);
  enabled.state.active = false;
  enabled.handler.tick(performance.now());
  assert.equal(enabled.handler.load.pending, 0);
  enabled.state.active = true;
  enabled.handler.tick(performance.now());
  assert.equal(enabled.handler.load.pending, 1);
  await until(() => world.decisionState.executing);
  for (let i = 0; i < 5; i++) enabled.handler.tick(performance.now());
  assert.equal(enabled.handler.status.trigger, "first-active");
  assert.equal(enabled.handler.load.pending, 0);
  assert.deepEqual(enabled.events, []);
});

test("invalid autonomous JSON backs off while ordinary simulation continues", async (t) => {
  const { world, tick, now } = setup(t);
  const game = session(world, mock, () => "{invalid");
  t.after(() => game.handler.close());
  game.handler.tick(performance.now());
  world.setMovement({ type: "move", dx: 1, dy: 0 }, now());
  tick(5);
  assert.ok(world.snapshot().state.player.x > valley.spawn.x + 10);
  await until(() => game.handler.status.result === "invalid");
  game.handler.tick(performance.now());
  assert.equal(game.handler.load.pending, 0);
  assert.equal(world.decisionState.executing, false);
});

test("unverified player action is cancelled on close, while an accepted action executes after close", async (t) => {
  const { world, tick } = setup(t, (state) => {
    state.player = { x: home.x, y: home.y + 12, facing: "up" };
  });
  const game = session(world);
  t.after(() => game.handler.close());
  const first = game.open();
  const cancelled = game.ask(first, "请你休息一下。");
  game.handler.handle(socket, { type: "dialogue-close", dialogId: first });
  await until(() => game.handler.load.pending === 0);
  assert.equal(world.decisionState.executing, false);
  assert.ok(
    !game.events.some((e) => e.event === "reply" && e.requestId === cancelled),
  );
  const second = game.open();
  const accepted = game.ask(second, "请你休息一下。");
  await until(() =>
    game.events.some(
      (e) =>
        e.event === "reply" &&
        e.requestId === accepted &&
        e.action === "accepted",
    ),
  );
  game.handler.handle(socket, { type: "dialogue-close", dialogId: second });
  tick(42);
  assert.equal(world.snapshot().state.cenyan.last?.code, "RESTED");
});

test("pause, disconnect and reset invalidate pending autonomy without blocking the next active generation", async (t) => {
  const { world } = setup(t);
  const game = session(world);
  t.after(() => game.handler.close());
  for (const reason of ["pause", "disconnect", "reset"]) {
    game.handler.tick(performance.now());
    assert.equal(game.handler.load.pending, 1);
    game.state.active = false;
    if (reason === "reset") {
      world.reset({ type: "reset", id: randomUUID(), confirm: true });
      game.handler.reset();
    } else game.handler.suspend(reason);
    await until(() => game.handler.load.pending === 0);
    assert.equal(world.decisionState.executing, false);
    game.handler.tick(performance.now());
    assert.equal(game.handler.load.pending, 0);
    game.state.active = true;
    game.handler.resume(performance.now());
  }
  game.handler.tick(performance.now());
  await until(() => world.decisionState.executing);
});

test("generation changes invalidate late proposals even when the newer plan completes first", async (t) => {
  const { world, accept, tick } = setup(t);
  const game = session(world);
  t.after(() => game.handler.close());
  game.handler.tick(performance.now());
  accept({ type: "rest", seconds: 1 });
  tick(20);
  await until(() => game.handler.load.pending === 0);
  assert.equal(game.handler.status.result, "cancelled");
  assert.equal(world.snapshot().state.cenyan.last?.code, "RESTED");
  assert.equal(world.decisionState.executing, false);
});

test("a late plan in Live dialogue for a natural request cannot cross a decision generation", async (t) => {
  const { world, accept, tick } = setup(t, (state) => {
    state.player = { x: home.x, y: home.y + 12, facing: "up" };
  });
  let respond!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  t.mock.method(globalThis, "fetch", () => response);
  const game = session(world, liveFixture);
  t.after(() => game.handler.close());
  const requestId = game.ask(game.open(), "劳驾到北坡捡点木头");
  accept({ type: "rest", seconds: 1 });
  tick(20);
  respond(
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              goal: "stock-wood",
              speech: "我去找木料。",
              plan: [{ type: "move_to", target_id: node.id }],
            }),
          },
        },
      ],
    }),
  );
  await until(() => game.handler.load.pending === 0);
  assert.equal(game.handler.status.result, "cancelled");
  assert.equal(world.snapshot().state.cenyan.last?.code, "RESTED");
  assert.equal(world.decisionState.executing, false);
  assert.ok(
    game.events.some(
      (e) =>
        e.event === "error" && e.requestId === requestId && e.code === "stale",
    ),
  );
});

test("Live dialogue holds a walking actor and accepts only complete valid plans", async (t) => {
  const { world, tick, now } = setup(t, (state) => {
    state.player = { x: home.x, y: home.y + 12, facing: "up" };
  });
  const decision = {
    goal: "stock-wood",
    speech: "我去找木料。",
    plan: [{ type: "move_to", target_id: node.id }],
  };
  const replies = [
    JSON.stringify(decision),
    JSON.stringify({
      ...decision,
      plan: [{ type: "work", target_id: node.id }],
    }),
    JSON.stringify(decision).slice(0, -1),
    "雾很重，走路当心。",
  ];
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ choices: [{ message: { content: replies.shift() } }] }),
  );
  const game = session(world, liveFixture);
  t.after(() => game.handler.close());
  const first = game.open();
  const accepted = game.ask(first, "劳驾到北坡捡点木头");
  await until(() => world.decisionState.executing);
  game.handler.handle(socket, { type: "dialogue-close", dialogId: first });
  tick(1, game.handler.holdsCenyan);
  assert.equal(world.cenyanActivity, "moving");
  const before = world.snapshot().state;
  const dialog = game.open();
  for (const text of ["非法计划测试", "截断计划测试"]) {
    const id = game.ask(dialog, text);
    await until(() =>
      game.events.some(
        (e) =>
          e.event === "error" && e.requestId === id && e.code === "invalid",
      ),
    );
  }
  const chat = game.ask(dialog, "今天雾大吗？");
  world.setMovement({ type: "move", dx: 1, dy: 0 }, now());
  tick(1, game.handler.holdsCenyan);
  world.setMovement({ type: "move", dx: 0, dy: 0 }, now());
  tick(25, game.handler.holdsCenyan);
  assert.equal(world.cenyanActivity, "idle");
  const held = world.snapshot().state;
  assert.deepEqual(held.cenyan, before.cenyan);
  assert.equal(held.cenyan.plan?.id, accepted);
  assert.ok(held.player.x > before.player.x);
  await until(() =>
    game.events.some(
      (e) =>
        e.event === "reply" &&
        e.requestId === chat &&
        e.text === "雾很重，走路当心。" &&
        e.action === undefined,
    ),
  );
  game.handler.handle(socket, { type: "dialogue-close", dialogId: dialog });
  tick(1, game.handler.holdsCenyan);
  assert.equal(world.cenyanActivity, "moving");
  assert.ok(distance(world.snapshot().state.cenyan, held.cenyan) > 0);
});

test("dialogue preempts in-flight autonomy with one queued request and both share the lock", async (t) => {
  const { world } = setup(t, (state) => {
    state.player = { x: home.x, y: home.y + 12, facing: "up" };
  });
  const game = session(world);
  t.after(() => game.handler.close());
  game.handler.tick(performance.now());
  assert.equal(game.handler.load.pending, 1);
  const dialog = game.open();
  const reply = game.ask(dialog, "你最近忙什么？");
  const busy = game.ask(dialog, "并发请求");
  assert.deepEqual(game.handler.load, { pending: 1, queued: 1 });
  await until(() =>
    game.events.some((e) => e.event === "reply" && e.requestId === reply),
  );
  assert.ok(
    game.events.some(
      (e) => e.event === "error" && e.requestId === busy && e.code === "busy",
    ),
  );
  assert.equal(world.decisionState.executing, false);
});

test("autonomy sublimits reserve room for dialogue and use the same durable request and token pool", (t) => {
  const path = disk(t);
  const config = readDialogueConfig({
    ...mock,
    LLM_MAX_REQUESTS_PER_MINUTE: "2",
    LLM_MAX_TOTAL_REQUESTS: "3",
    LLM_MAX_TOTAL_TOKENS: "2000",
    LLM_MAX_OUTPUT_TOKENS: "100",
  });
  const ledger = new DialogueLedger(path);
  const now = Date.now();
  assert.equal(ledger.reserve(config, "auto", 200, now, "autonomy"), "ok");
  assert.equal(ledger.reserve(config, "auto2", 200, now, "autonomy"), "budget");
  assert.equal(ledger.reserve(config, "dialogue", 200, now), "ok");
  ledger.close();
  const reopened = new DialogueLedger(path);
  try {
    assert.equal(
      reopened.reserve(config, "again", 200, now + 60001, "autonomy"),
      "budget",
    );
    assert.equal(reopened.reserve(config, "dialogue2", 200, now + 60001), "ok");
    assert.equal(
      reopened.reserve(config, "dialogue3", 1, now + 120001),
      "budget",
    );
  } finally {
    reopened.close();
  }
});
