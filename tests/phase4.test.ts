import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { WebSocket } from "ws";
import { stepSchema, type Step } from "../src/shared/cenyan.js";
import {
  clientMessage,
  type Action,
  type SaveState,
} from "../src/shared/protocol.js";
import {
  npcIds,
  type NpcId,
  type SocialCommand,
} from "../src/shared/social.js";
import { distance, isPassable, valley } from "../src/shared/world.js";
import { DialogueSession } from "../src/server/dialogue/session.js";
import {
  autonomyMessages,
  socialMessages,
} from "../src/server/dialogue/planning.js";
import { DialogueLedger } from "../src/server/dialogue/ledger.js";
import { readDialogueConfig } from "../src/server/dialogue/config.js";
import { freshState, SaveFile } from "../src/server/save.js";
import { World, type WorldObservation } from "../src/server/world.js";

const mock = {
  LLM_ENABLED: "false",
  LLM_MOCK_AUTONOMY_ENABLED: "true",
  LLM_MOCK_DELAY_MS: "7",
  LLM_MAX_REQUESTS_PER_MINUTE: "90",
  LLM_AUTONOMY_REQUESTS_PER_MINUTE: "60",
  LLM_AUTONOMY_REQUESTS_PER_SESSION: "90",
  LLM_MAX_REQUESTS_PER_SESSION: "120",
};

const { bridge } = valley;
const closePositions = (state: SaveState) => {
  Object.assign(state.player, { x: 438, y: 368 });
  Object.assign(state.actors.cenyan, { x: 421, y: 370 });
  Object.assign(state.actors.ahe, { x: 425, y: 381 });
  Object.assign(state.actors.luozhou, { x: 434, y: 354 });
};

function directory(t: TestContext) {
  const path = mkdtempSync(join(tmpdir(), "mistsea-phase4-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function worldFixture(
  t: TestContext,
  arrange?: (state: SaveState) => void,
  observe?: (event: WorldObservation) => void,
) {
  const path = join(directory(t), "valley.sqlite");
  const seed = new SaveFile(path);
  if (arrange) {
    const next = structuredClone(seed.initial);
    arrange(next);
    seed.write(next);
  }
  seed.close();
  const save = new SaveFile(path);
  t.after(() => save.close());
  const world = new World(save, observe);
  let clock = 0;
  const base = Date.now();
  return {
    path,
    world,
    save,
    tick(count = 1) {
      for (let index = 0; index < count; index++) {
        clock += 50;
        world.tick(clock, 50, base + clock);
      }
    },
  };
}

function task(world: World, npc: NpcId, ...steps: Step[]) {
  assert.equal(
    world.accept(
      randomUUID(),
      { goal: "按规则执行计划", speech: "", plan: steps },
      Date.now(),
      undefined,
      npc,
    ),
    true,
  );
}

function act(world: World, verb: Action["verb"], target: string) {
  return world.perform({ type: "action", id: randomUUID(), verb, target });
}

test("Phase 4 schema has finite conditions, legal actors and strictly scoped consent", () => {
  assert.ok(
    stepSchema.safeParse({
      type: "follow",
      target_id: "luozhou",
      destination_id: valley.ruin.id,
    }).success,
  );
  for (const step of [
    {
      type: "wait_until",
      condition: { kind: "materials-ready", code: "true" },
      seconds: 2,
    },
    {
      type: "wait_until",
      condition: { kind: "arrived", actor: "ghost", destination: bridge.id },
      seconds: 2,
    },
    { type: "wait_until", condition: { kind: "materials-ready" }, seconds: 61 },
    { type: "talk", target_id: "player", topic: "商量" },
    {
      type: "social",
      command: {
        kind: "pledge",
        target: "player",
        condition: { kind: "return", item: "wood", qty: 1 },
      },
    },
  ])
    assert.equal(stepSchema.safeParse(step).success, false);
  assert.equal(
    clientMessage.safeParse({
      type: "social",
      id: randomUUID(),
      actor: "ahe",
      command: { kind: "respond", offerId: randomUUID(), choice: "accept" },
    }).success,
    false,
  );
});

test("three actors compete for a resource once and keep their bags and private context separate", (t) => {
  const node = valley.resources[0];
  const spot = Array.from({ length: node.range }, (_, offset) => ({
    x: node.x,
    y: node.y + offset,
  })).find((point) => isPassable(point.x, point.y, false))!;
  const { world, tick, save } = worldFixture(t, (state) => {
    for (const id of npcIds) Object.assign(state.actors[id], spot);
    state.actors.luozhou.goal = "洛舟私有目标";
  });
  for (const id of npcIds)
    task(world, id, { type: "collect", target_id: node.id });
  tick();
  const { state } = world.snapshot();
  assert.equal(state.actors.cenyan.bag.wood, node.yieldCount);
  assert.equal(state.actors.ahe.bag.wood + state.actors.luozhou.bag.wood, 0);
  assert.equal(state.actors.ahe.last?.code, "COOLDOWN");
  assert.equal(state.actors.luozhou.last?.code, "COOLDOWN");
  world.rememberExchange(
    randomUUID(),
    "木料私事只和阿禾说",
    "好，我记住了。",
    Date.now(),
    "ahe",
  );
  const view = world.perceive(undefined, Date.now(), "cenyan", "ahe");
  assert.ok(view.people.some((entry) => entry.id === "luozhou"));
  assert.ok(!view.people.some((entry) => "bag" in entry || "goal" in entry));
  assert.doesNotMatch(JSON.stringify(view), /洛舟私有目标|木料私事只和阿禾说/);
  assert.ok(
    save.memories(undefined, 6, "ahe").some((entry) => entry.kind === "claim"),
  );
  assert.equal(
    world.perceive(undefined, Date.now(), "luozhou").self.goal,
    "按规则执行计划",
  );
});

test("material waits resume committed work; shared progress and each contribution commit once", (t) => {
  const { world, tick, path } = worldFixture(t, (state) => {
    closePositions(state);
    state.bridge.discovered = true;
    state.bridge.wood = 6;
    state.bridge.stone = 1;
    Object.assign(state.contributions.legacy, { wood: 6, stone: 1 });
    state.inventory.stone = 1;
  });
  for (const id of npcIds)
    task(
      world,
      id,
      {
        type: "wait_until",
        condition: { kind: "materials-ready" },
        seconds: 6,
      },
      { type: "work", target_id: bridge.id },
    );
  tick(10);
  assert.ok(npcIds.every((id) => world.actorActivity(id) === "waiting"));
  assert.equal(world.snapshot().state.bridge.progressMs, 0);
  assert.equal(act(world, "deliver", bridge.id).code, "DELIVERED");
  tick();
  assert.ok(
    npcIds.every(
      (id) => world.snapshot().state.actors[id].last?.code === "WAIT_READY",
    ),
  );
  assert.equal(act(world, "work", bridge.id).code, "WORK_STARTED");
  tick(75);
  const { state } = world.snapshot();
  assert.equal(state.bridge.repaired, true);
  assert.equal(state.bridge.progressMs, bridge.workMs);
  assert.equal(
    Object.values(state.contributions).reduce(
      (total, row) => total + row.workMs,
      0,
    ),
    bridge.workMs,
  );
  assert.ok(npcIds.every((id) => state.contributions[id].workMs > 0));
  assert.equal(state.workPairs.length, 6);
  assert.equal(
    state.events.filter((event) => event.kind === "cooperation").length,
    1,
  );
  const reopened = new SaveFile(path);
  try {
    assert.equal(reopened.initial.actors.ahe.relations.luozhou?.level, 1);
    assert.equal(reopened.initial.actors.cenyan.relations.player?.level, 1);
    assert.equal(reopened.initial.sharedWorkMs, state.sharedWorkMs);
    assert.ok(
      reopened
        .memories(undefined, 6, "luozhou")
        .some((entry) => entry.content.includes("合力修通")),
    );
  } finally {
    reopened.close();
  }
});

test("waiting cancels or expires without running the next step; follow cannot form a cycle", (t) => {
  const { world, tick } = worldFixture(t, closePositions);
  for (const id of ["ahe", "cenyan"] as const)
    task(
      world,
      id,
      {
        type: "wait_until",
        condition: { kind: "materials-ready" },
        seconds: 1,
      },
      { type: "work", target_id: bridge.id },
    );
  tick(2);
  assert.equal(act(world, "stop-wait", "cenyan").code, "WAIT_CANCELLED");
  tick(25);
  assert.equal(world.snapshot().state.actors.ahe.last?.code, "WAIT_TIMEOUT");
  assert.equal(world.snapshot().state.bridge.progressMs, 0);
  const reply = (leader: NpcId) => ({
    goal: "同行",
    speech: "我来。",
    plan: [
      {
        type: "follow" as const,
        target_id: leader,
        destination_id: valley.resources[0].id,
      },
    ],
  });
  assert.equal(
    world.recordActionReply(
      randomUUID(),
      "一起去林地",
      reply("ahe"),
      Date.now(),
      "cenyan",
      "ahe",
    ),
    "accepted",
  );
  assert.equal(
    world.recordActionReply(
      randomUUID(),
      "一起去林地",
      reply("cenyan"),
      Date.now(),
      "ahe",
      "cenyan",
    ),
    "rejected",
  );
});

test("exchange and loan require the right actor and preserve inventory across replay, expiry and restart", (t) => {
  const { world, path } = worldFixture(t, (state) => {
    closePositions(state);
    state.actors.ahe.bag.wood = 3;
    state.actors.luozhou.bag.stone = 3;
  });
  const command = (
    actor: NpcId,
    value: SocialCommand,
    id = randomUUID(),
    now = Date.now(),
  ) => world.applySocial(id, actor, value, now);
  const now = Date.now();
  const exchange = command("ahe", {
    kind: "offer",
    target: "luozhou",
    terms: {
      kind: "exchange",
      give: { item: "wood", qty: 2 },
      take: { item: "stone", qty: 1 },
    },
  });
  assert.ok(exchange.ok);
  const reply = {
    kind: "respond",
    offerId: exchange.offerId!,
    choice: "accept",
  } as const;
  assert.equal(command("cenyan", reply).code, "OFFER_UNKNOWN");
  assert.deepEqual(world.snapshot().state.actors.ahe.bag, {
    wood: 3,
    stone: 0,
  });
  const nonce = randomUUID();
  const done = command("luozhou", reply, nonce);
  assert.equal(done.code, "HANDOFF_DONE");
  assert.deepEqual(command("luozhou", reply, nonce), done);
  assert.deepEqual(world.snapshot().state.actors.luozhou.bag, {
    wood: 2,
    stone: 2,
  });

  const loan = command("luozhou", {
    kind: "offer",
    target: "ahe",
    terms: {
      kind: "loan",
      give: { item: "stone", qty: 1 },
    },
  });
  assert.equal(
    command("ahe", { ...reply, offerId: loan.offerId! }).code,
    "HANDOFF_DONE",
  );
  const obligation = world.snapshot().state.pledges.at(-1)!;
  assert.equal(obligation.status, "accepted");
  const reopened = new SaveFile(path);
  try {
    assert.equal(reopened.initial.pledges.at(-1)?.id, obligation.id);
    assert.deepEqual(reopened.initial.actors.ahe.bag, { wood: 1, stone: 2 });
  } finally {
    reopened.close();
  }
  assert.equal(
    command("luozhou", { kind: "return", offerId: obligation.id }).code,
    "OFFER_FORBIDDEN",
  );
  assert.equal(
    command("ahe", { kind: "cancel", offerId: obligation.id }).code,
    "OFFER_FORBIDDEN",
  );
  assert.equal(
    command("ahe", { kind: "return", offerId: obligation.id }).code,
    "LOAN_RETURNED",
  );
  const state = world.snapshot().state;
  assert.equal(state.pledges.at(-1)?.status, "fulfilled");
  assert.equal(state.actors.luozhou.relations.ahe?.level, 1);
  assert.deepEqual(state.actors.ahe.bag, { wood: 1, stone: 1 });
  assert.deepEqual(state.actors.luozhou.bag, { wood: 2, stone: 2 });

  const pledge = command("ahe", {
    kind: "pledge",
    target: "luozhou",
    condition: { kind: "work" },
  });
  assert.equal(
    command("luozhou", { ...reply, offerId: pledge.offerId!, choice: "reject" })
      .code,
    "OFFER_REJECTED",
  );
  assert.equal(world.snapshot().state.actors.luozhou.relations.ahe?.level, 1);
  const repeated = command(
    "ahe",
    { kind: "pledge", target: "luozhou", condition: { kind: "work" } },
    randomUUID(),
    now,
  );
  assert.equal(
    command(
      "luozhou",
      { ...reply, offerId: repeated.offerId! },
      randomUUID(),
      now + 1,
    ).code,
    "PLEDGE_ACCEPTED",
  );
  world.tick(50, 50, now + 310_000);
  assert.equal(world.snapshot().state.pledges.at(-1)?.status, "cancelled");
  assert.equal(world.snapshot().state.actors.luozhou.relations.ahe?.level, 0);
  assert.equal(world.snapshot().state.actors.ahe.relations.luozhou, undefined);
});

test("v3 migration backs up before preserving pending work, receipts, memory, and ledger", (t) => {
  const path = join(directory(t), "old.sqlite");
  const state = freshState();
  state.cenyan.bag.wood = 2;
  state.cenyan.plan = {
    id: randomUUID(),
    index: 0,
    steps: [{ type: "rest", seconds: 6 }],
    remainingMs: 1250,
  };
  state.cenyan.pending = {
    id: randomUUID(),
    goal: "准备屋顶木料",
    steps: [{ type: "rest", seconds: 3 }],
  };
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE world(slot INTEGER PRIMARY KEY, revision INTEGER, payload TEXT);
    CREATE TABLE receipts(id TEXT PRIMARY KEY, result TEXT);
    CREATE TABLE cenyan_memory(id TEXT PRIMARY KEY, actor TEXT, at INTEGER, kind TEXT, source TEXT, event TEXT, topic TEXT, content TEXT);
    INSERT INTO receipts VALUES ('legacy-gift', '{"code":"GIFT_TRANSFERRED"}');
    INSERT INTO cenyan_memory VALUES ('memo','cenyan',1,'fact','rules','event','bridge','旧档交接');
    PRAGMA user_version=3;
  `);
  const {
    player,
    inventory,
    bridge,
    cooldowns,
    worldId,
    contentVersion,
    cenyan,
    explored,
    gift,
    sharedWorkMs,
  } = state;
  db.prepare("INSERT INTO world VALUES (1, 0, ?)").run(
    JSON.stringify({
      player,
      inventory,
      bridge,
      cooldowns,
      worldId,
      contentVersion,
      cenyan,
      explored,
      gift,
      sharedWorkMs,
      schemaVersion: 3,
      contributions: {
        player: state.contributions.player,
        cenyan: state.contributions.cenyan,
        legacy: state.contributions.legacy,
      },
    }),
  );
  db.close();
  const ledgerPath = path + ".llm.sqlite";
  const ledgerDb = new DatabaseSync(ledgerPath);
  ledgerDb.exec(`
    CREATE TABLE calls(id TEXT PRIMARY KEY, at_ms INTEGER, npc TEXT, mode TEXT, model TEXT, status TEXT,
      elapsed_ms INTEGER, charged_tokens INTEGER, charged_nano INTEGER, estimated_nano INTEGER, usage TEXT, purpose TEXT);
    INSERT INTO calls VALUES ('old-call', 1, 'cenyan', 'mock', 'mock', 'ok', 2, 44, NULL, NULL, NULL, 'dialogue');
    PRAGMA user_version=2;
  `);
  ledgerDb.close();
  const migrated = new SaveFile(path);
  const ledger = new DialogueLedger(ledgerPath);
  try {
    assert.ok(existsSync(path + ".pre-phase4.sqlite"));
    assert.equal(migrated.initial.schemaVersion, 4);
    assert.deepEqual(migrated.initial.cenyan.plan, state.cenyan.plan);
    assert.deepEqual(
      migrated.initial.actors.cenyan.pending,
      state.cenyan.pending,
    );
    assert.equal(migrated.receipt("legacy-gift")?.code, "GIFT_TRANSFERRED");
    assert.equal(migrated.memories()[0].content, "旧档交接");
    assert.equal(migrated.memories(undefined, 6, "ahe").length, 0);
    assert.deepEqual(migrated.initial.actors.ahe.bag, { wood: 0, stone: 0 });
    assert.equal(ledger.summary("mock").tokens, 44);
    assert.equal(ledger.summary("mock").requests, 1);
  } finally {
    migrated.close();
    ledger.close();
  }
});

test("Round-robin limits in-flight requests, prioritizes player requests and preserves the world when budget is empty", async (t) => {
  const { world } = worldFixture(t, closePositions);
  const ledger = join(directory(t), "budget.sqlite");
  const config = readDialogueConfig({ ...mock, LLM_MAX_TOTAL_REQUESTS: "4" });
  let active = true;
  const owner = {} as WebSocket;
  const messages: import("../src/shared/protocol.js").DialogueEvent[] = [];
  const session = new DialogueSession(
    ledger,
    () => (active ? { near: true, bridge: world.publicBridge() } : undefined),
    (_socket, message) => messages.push(message),
    { ...mock, LLM_MAX_TOTAL_REQUESTS: "4", LLM_MOCK_DELAY_MS: "35" },
    undefined,
    {
      world,
      active: () => active,
      actors: npcIds,
      storageError: (error) => {
        throw error;
      },
    },
  );
  try {
    session.tick(performance.now());
    session.tick(performance.now());
    session.tick(performance.now());
    assert.deepEqual(session.pendingActors, ["cenyan", "ahe"]);
    const open = randomUUID();
    session.handle(owner, { type: "dialogue-open", npc: "luozhou", id: open });
    const dialog = messages.find((entry) => entry.event === "opened")!;
    assert.equal(dialog.npc, "luozhou");
    session.handle(owner, {
      type: "dialogue-send",
      dialogId: dialog.dialogId,
      id: randomUUID(),
      text: "你最近在忙什么？",
    });
    assert.equal(session.load.queued, 1);
    for (let index = 0; index < 40 && session.load.pending; index++)
      await delay(10);
    assert.ok(
      messages.some(
        (entry) => entry.event === "reply" && entry.text.includes("航标"),
      ),
    );
    assert.ok(session.pendingActors.length <= 2);
    session.suspend("断线", false);
    active = false;
    session.tick(performance.now() + 120_000);
    assert.equal(session.load.pending, 0);
    const clock = performance.now();
    world.setMovement({ type: "move", dx: -1, dy: 0 }, clock);
    const previous = world.snapshot().state.player.x;
    world.tick(clock, 50);
    assert.ok(world.snapshot().state.player.x < previous);
  } finally {
    await session.close();
  }
  const reopened = new DialogueLedger(ledger);
  try {
    assert.equal(reopened.summary("mock").requests, 3);
    assert.equal(
      reopened.reserve(
        config,
        randomUUID(),
        4,
        Date.now(),
        "autonomy",
        "ahe",
        true,
      ),
      "budget",
    );
  } finally {
    reopened.close();
  }
});

test(
  "active Mock society gathers from empty bags, holds separate conversations and repairs the bridge",
  { timeout: 80_000 },
  async (t) => {
    const observations: WorldObservation[] = [];
    const { world } = worldFixture(t, undefined, (event) =>
      observations.push(event),
    );
    const session = new DialogueSession(
      ":memory:",
      () => undefined,
      () => {},
      mock,
      undefined,
      {
        world,
        active: () => true,
        actors: npcIds,
        storageError: (error) => {
          throw error;
        },
      },
    );
    const starting = world.snapshot().state;
    const timeLimit = performance.now() + 65_000;
    const returned = new Set<NpcId>();
    try {
      while (performance.now() < timeLimit && returned.size < 3) {
        const clock = performance.now();
        world.tick(clock, 50);
        session.tick(clock);
        const state = world.snapshot().state;
        for (const id of npcIds) {
          if (state.bridge.repaired && world.actorActivity(id) === "resting")
            returned.add(id);
          assert.ok(
            isPassable(
              state.actors[id].x,
              state.actors[id].y,
              state.bridge.repaired,
            ),
          );
        }
        assert.ok(session.load.pending <= 2);
        await delay(12);
      }
      const { state } = world.snapshot();
      const actionLog = observations.filter((event) => event.kind === "action");
      const summary = JSON.stringify({
        actors: state.actors,
        observations,
        contributions: state.contributions,
      });
      assert.equal(state.bridge.repaired, true, summary);
      assert.equal(returned.size, 3, summary);
      assert.deepEqual(state.inventory, starting.inventory);
      assert.deepEqual(state.contributions.player, {
        wood: 0,
        stone: 0,
        workMs: 0,
      });
      assert.ok(state.sharedWorkMs > 0, summary);
      for (const id of npcIds) {
        assert.ok(
          actionLog.some(
            (event) => event.actor === id && event.code === "COLLECTED",
          ),
          summary,
        );
        assert.ok(
          distance(starting.actors[id], state.actors[id]) > 1 ||
            returned.has(id),
        );
      }
      const speakers = new Map<string, Set<NpcId>>();
      for (const event of observations)
        if (event.kind === "speech") {
          const actors = speakers.get(event.session) ?? new Set();
          actors.add(event.actor);
          speakers.set(event.session, actors);
        }
      assert.ok(
        [...speakers.values()].filter((actors) => actors.size === 2).length >=
          2,
        summary,
      );
      assert.ok(
        world
          .perceive(undefined, Date.now(), "ahe")
          .memory.some((entry) => entry.actor === "ahe"),
      );
    } finally {
      await session.close();
    }
  },
);

test("same-plan gift wait binds its own offer and continues after an explicit response", (t) => {
  const { world, tick } = worldFixture(t, (state) => {
    closePositions(state);
    state.actors.ahe.bag.wood = 1;
  });
  task(
    world,
    "ahe",
    { type: "give_item", target_id: "player", item: "wood", qty: 1 },
    { type: "wait_until", condition: { kind: "gift-response" }, seconds: 10 },
    { type: "rest", seconds: 1 },
  );
  tick(2);
  assert.equal(world.actorActivity("ahe"), "waiting");
  const offer = world.snapshot().state.gift!;
  assert.equal(offer.from, "ahe");
  assert.equal(world.snapshot().state.inventory.wood, 0);
  const response = world.perform({
    type: "action",
    verb: "gift-response",
    id: randomUUID(),
    offerId: offer.id,
    choice: "accept",
    target: "ahe",
  });
  assert.equal(response.code, "GIFT_TRANSFERRED");
  assert.equal(response.target, "ahe");
  tick(2);
  assert.equal(world.actorActivity("ahe"), "resting");
  assert.equal(world.snapshot().state.inventory.wood, 1);
  assert.equal(world.snapshot().state.actors.ahe.bag.wood, 0);
});

test("a delivery pledge is fulfilled only after its accepted amount reaches the actual project", (t) => {
  const { world } = worldFixture(t, (state) => {
    closePositions(state);
    state.inventory.wood = 3;
    state.actors.ahe.bag.wood = 8;
    state.actors.luozhou.bag.stone = 4;
  });
  const projectForEveryResident = () => {
    const now = Date.now();
    const views = npcIds.map((npc) => world.perceive(bridge.id, now, npc));
    for (const view of views)
      assert.deepEqual(view.bridge, world.publicBridge(now));
    assert.deepEqual(
      views.map(({ self }) => self.bag.wood),
      [0, 8, 0],
    );
    assert.deepEqual(
      views.map(({ self }) => self.bag.stone),
      [0, 0, 4],
    );
    assert.deepEqual(views[2].social.pledges, []);
    return views;
  };
  const pledge = world.applySocial(randomUUID(), "player", {
    kind: "pledge",
    target: "ahe",
    condition: { kind: "deliver", item: "wood", qty: 2 },
  });
  assert.equal(pledge.code, "PLEDGE_PROPOSED");
  assert.equal(world.snapshot().state.pledges.at(-1)?.status, "proposed");
  assert.equal(projectForEveryResident()[0].bridge.committed.wood, 0);
  assert.equal(
    world.applySocial(randomUUID(), "ahe", {
      kind: "respond",
      offerId: pledge.offerId!,
      choice: "accept",
    }).code,
    "PLEDGE_ACCEPTED",
  );
  const [cenyan, , luozhou] = projectForEveryResident();
  assert.deepEqual(cenyan.bridge.missing, {
    wood: bridge.required.wood,
    stone: bridge.required.stone,
  });
  assert.deepEqual(cenyan.bridge.committed, { wood: 2, stone: 0 });
  assert.equal(cenyan.bridge.unassigned.wood, bridge.required.wood - 2);
  assert.equal(cenyan.bridge.materialsReady, false);
  for (const prompt of [
    autonomyMessages(luozhou, "bridge-materials"),
    socialMessages(luozhou, "cenyan", bridge.id, "还缺多少？", true),
  ]) {
    assert.match(prompt.messages[0].content, /工地实际还缺木材 6、石材 2/);
    assert.match(
      prompt.messages[0].content,
      /"committed":\{"wood":2,"stone":0\}/,
    );
    assert.equal(prompt.messages[0].content.includes(pledge.offerId!), false);
  }
  for (const expected of ["accepted", "fulfilled"]) {
    assert.equal(
      world.perform({
        type: "action",
        verb: "deliver",
        id: randomUUID(),
        target: bridge.id,
        item: "wood",
        qty: 1,
      }).code,
      "DELIVERED",
    );
    assert.equal(world.snapshot().state.pledges.at(-1)?.status, expected);
    const project = projectForEveryResident()[0].bridge;
    assert.equal(project.missing.wood, bridge.required.wood - project.wood);
    assert.equal(project.committed.wood, 2 - project.wood);
    assert.equal(project.unassigned.wood, bridge.required.wood - 2);
  }
  assert.equal(world.snapshot().state.actors.ahe.relations.player?.level, 1);
  assert.equal(world.snapshot().state.inventory.wood, 1);
});


