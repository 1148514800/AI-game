import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { WebSocket } from "ws";
import {
  actionReplySchema,
  capabilities,
  decisionSchema,
  legacyGoalTag,
  home,
  stepSchema,
  type Step,
} from "../src/shared/cenyan.js";
import {
  clientMessage,
  type Action,
  type DialogueEvent,
  type SaveState,
} from "../src/shared/protocol.js";
import {
  distance,
  inventoryLimit,
  isPassable,
  speed,
  valley,
} from "../src/shared/world.js";
import { SaveFile, freshState } from "../src/server/save.js";
import { World } from "../src/server/world.js";
import { DialogueSession } from "../src/server/dialogue/session.js";
import { buildMessages } from "../src/server/dialogue/cenyan.js";
import { contextBytes } from "../src/server/dialogue/config.js";
import {
  autonomyMessages,
  dialoguePlanInstructions,
  jsonDialogueInstructions,
  perceptionText,
} from "../src/server/dialogue/planning.js";
import { findKeyboardRoute, route } from "./paths.js";

const { bridge } = valley;
const action = (
  verb: Action["verb"],
  target = bridge.id,
  fields: Partial<Action> = {},
): Action => ({ type: "action", id: randomUUID(), verb, target, ...fields });
const plan = (...steps: Step[]) => ({
  goal: "一道修桥",
  speech: "我来帮忙。",
  plan: steps,
});
const atBridge = (state: SaveState) => {
  state.player = { x: 438, y: 368, facing: "right" };
  Object.assign(state.cenyan, { x: 421, y: 370 });
};

function disk(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "mistsea-phase31-unit-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, "valley.sqlite");
}
function setup(t: TestContext, edit: (state: SaveState) => void = () => {}) {
  const path = disk(t);
  const save = new SaveFile(path);
  const fresh = structuredClone(save.initial);
  edit(fresh);
  save.write(fresh);
  save.close();
  const store = new SaveFile(path);
  t.after(() => store.close());
  const world = new World(store);
  let clock = 0;
  return {
    path,
    world,
    store,
    tick(count = 1, beforeTick?: (clock: number) => void) {
      for (let index = 0; index < count; index++) {
        clock += 50;
        beforeTick?.(clock);
        world.tick(clock, 50, 1_000_000 + clock);
      }
    },
    state: () => world.snapshot().state,
  };
}

test("the B quarry approach has a legal keyboard route despite the coarse-grid miss", (t) => {
  // The first player position is from the native failure, rounded as in the DOM.
  // The second is nearby but too close to a rock for the extra test clearance.
  const players = [
    { x: 337.4662, y: 471.6158 },
    { x: 335.5, y: 471.8 },
  ];
  const cenyan = { x: 338.2776, y: 494.0182 };
  const reached = (point: { x: number; y: number }) =>
    distance(point, { x: 399, y: 449 }) <= 14;
  assert.equal(
    findKeyboardRoute(
      players[0],
      (point) => distance(point, valley.ruin) < valley.ruin.range,
      false,
      [cenyan],
    ),
    undefined,
  );
  for (const player of players) {
    assert.throws(() => route(player, reached, false), /No walkable route/);
    const steps = findKeyboardRoute(player, reached, false, [cenyan]);
    assert.ok(steps?.length);

    const { world, state, tick } = setup(t, (s) => {
      Object.assign(s.player, player);
      Object.assign(s.cenyan, cenyan);
    });
    assert.ok(
      world.accept(
        randomUUID(),
        plan({ type: "follow", target_id: "player" }),
        1_000_000,
        "我们一起去桥边吧。",
      ),
    );
    for (const step of steps) {
      const { axis } = step;
      const sign = step[axis] > state().player[axis] ? 1 : -1;
      for (
        let i = 0;
        i < 40 && (step[axis] - state().player[axis]) * sign > 1.7;
        i++
      ) {
        tick(1, (clock) =>
          world.setMovement(
            {
              type: "move",
              dx: axis === "x" ? sign : 0,
              dy: axis === "y" ? sign : 0,
            },
            clock,
          ),
        );
        const { player: current, cenyan: follower } = state();
        assert.ok(isPassable(current.x, current.y, false));
        assert.ok(isPassable(follower.x, follower.y, false));
        assert.ok(distance(current, follower) >= 8);
      }
      tick(1, (clock) =>
        world.setMovement({ type: "move", dx: 0, dy: 0 }, clock),
      );
    }
    assert.ok(reached(state().player));
    assert.ok(distance(state().cenyan, cenyan) > 10);
    assert.equal(state().cenyan.plan?.steps[0].type, "follow");
  }
});

test("Phase3.1 step and client schemas only admit material pairs, valid targets and coherent policies", () => {
  assert.deepEqual(Object.keys(capabilities), [
    "move_to",
    "follow",
    "collect",
    "give_item",
    "deliver",
    "work",
    "wait",
    "rest",
  ]);
  assert.ok(
    stepSchema.safeParse({ type: "follow", target_id: "player" }).success,
  );
  assert.ok(
    stepSchema.safeParse({
      type: "deliver",
      target_id: bridge.id,
      item: "stone",
      qty: 2,
    }).success,
  );
  for (const step of [
    { type: "follow", target_id: "cenyan" },
    { type: "give_item", target_id: "player", item: "food", qty: 1 },
    { type: "give_item", target_id: "player", item: "wood", qty: -1 },
    { type: "deliver", target_id: bridge.id, qty: 1 },
    { type: "deliver", target_id: bridge.id, item: "wood", qty: 0 },
  ])
    assert.equal(stepSchema.safeParse(step).success, false);
  assert.equal(
    clientMessage.safeParse(action("deliver", bridge.id, { item: "wood" }))
      .success,
    false,
  );
  assert.equal(
    clientMessage.safeParse(action("work", bridge.id, { item: "wood", qty: 1 }))
      .success,
    false,
  );
  assert.equal(
    clientMessage.safeParse(
      action("gift-response", "cenyan", { choice: "accept" }),
    ).success,
    false,
  );
  assert.equal(
    actionReplySchema.safeParse({
      ...plan({ type: "wait", seconds: 1 }),
      plan_policy: "reject",
    }).success,
    false,
  );
  assert.equal(
    actionReplySchema.safeParse({
      goal: "帮忙",
      speech: "好。",
      plan_policy: "defer",
    }).success,
    false,
  );
  assert.ok(
    actionReplySchema.safeParse({
      goal: "帮忙",
      speech: "稍等。",
      plan_policy: "continue",
    }).success,
  );
});

test("partial deliver, concurrent same-tick entrants and replay preserve each contributor and truncate", (t) => {
  const { world, path, state, tick } = setup(t, (s) => {
    atBridge(s);
    s.inventory.wood = 4;
    s.cenyan.bag = { wood: 5, stone: 2 };
  });
  const first = action("deliver", bridge.id, { item: "wood", qty: 2 });
  const receipt = world.perform(first);
  assert.deepEqual(receipt.materials, { wood: 2, stone: 0 });
  assert.deepEqual(world.perceive().bridge.missing, { wood: 4, stone: 2 });
  assert.equal(world.perform(action("work")).code, "MATERIALS_MISSING");
  assert.equal(
    world.accept(
      randomUUID(),
      plan({ type: "deliver", target_id: bridge.id, item: "wood", qty: 5 }),
    ),
    true,
  );
  assert.deepEqual(world.perform(action("deliver")).materials, {
    wood: 2,
    stone: 0,
  });
  tick();
  assert.equal(state().cenyan.bag.wood, 3);
  assert.deepEqual(state().cenyan.last?.change, {
    wood: 2,
    stone: 0,
    actor: "cenyan",
    target: bridge.id,
  });
  assert.equal(
    world.accept(randomUUID(), plan({ type: "deliver", target_id: bridge.id })),
    true,
  );
  tick(11);
  assert.deepEqual(state().contributions.player, {
    wood: 4,
    stone: 0,
    workMs: 0,
  });
  assert.deepEqual(state().contributions.cenyan, {
    wood: 2,
    stone: 2,
    workMs: 0,
  });
  assert.equal(state().inventory.wood, 0);
  assert.deepEqual(world.perceive().bridge.missing, { wood: 0, stone: 0 });
  const reopened = new SaveFile(path);
  try {
    const resumed = new World(reopened);
    assert.deepEqual(resumed.perform(first), receipt);
    assert.deepEqual(resumed.snapshot().state, state());
  } finally {
    reopened.close();
  }
});

test("gifts are two-party, replayable and conserved in both directions", (t) => {
  const { world, state, tick, store } = setup(t, (s) => {
    atBridge(s);
    s.inventory.wood = 3;
    s.cenyan.bag.stone = 2;
  });
  const offer = randomUUID();
  assert.equal(
    world.proposePlayerGift(offer, { item: "wood", qty: 2 }).code,
    "GIFT_OFFERED",
  );
  assert.equal(state().inventory.wood, 3);
  assert.equal(
    world.perform(
      action("gift-response", "cenyan", { offerId: offer, choice: "accept" }),
    ).code,
    "GIFT_UNKNOWN",
  );
  assert.equal(
    world.resolveGift(offer, offer, "cenyan", "reject").code,
    "GIFT_REJECTED",
  );
  assert.equal(state().inventory.wood, 3);
  assert.equal(state().cenyan.bag.wood, 0);
  const second = randomUUID();
  world.proposePlayerGift(second, { item: "wood", qty: 1 });
  const moved = world.resolveGift(second, second, "cenyan", "accept");
  assert.equal(moved.code, "GIFT_TRANSFERRED");
  assert.deepEqual(
    world.resolveGift(second, second, "cenyan", "reject"),
    moved,
  );
  assert.equal(state().inventory.wood, 2);
  assert.equal(state().cenyan.bag.wood, 1);
  for (const choice of ["reject", "accept"] as const) {
    assert.ok(
      world.accept(
        randomUUID(),
        plan({ type: "give_item", target_id: "player", item: "stone", qty: 1 }),
      ),
    );
    tick();
    const incoming = state().gift!;
    assert.equal(incoming.from, "cenyan");
    assert.equal(state().inventory.stone, 0);
    assert.equal(state().cenyan.bag.stone, 2);
    const response = action("gift-response", "cenyan", {
      offerId: incoming.id,
      choice,
    });
    const result = world.perform(response, 1_000_200);
    assert.equal(
      result.code,
      choice === "reject" ? "GIFT_REJECTED" : "GIFT_TRANSFERRED",
    );
    assert.deepEqual(world.perform(response, 1_000_201), result);
  }
  assert.equal(state().inventory.stone, 1);
  assert.equal(state().cenyan.bag.stone, 1);
  assert.equal(
    store.memories(undefined, 20).filter((m) => m.event.startsWith("gift:"))
      .length,
    4,
  );
});

test("expiry, no stock, capacity and distance reject gifts atomically", (t) => {
  const { world, state, tick } = setup(t, (s) => {
    atBridge(s);
    s.inventory.stone = inventoryLimit;
    s.cenyan.bag.stone = 2;
  });
  assert.equal(
    world.proposePlayerGift(randomUUID(), { item: "wood", qty: 1 }, 1000).code,
    "GIFT_NO_STOCK",
  );
  const first = randomUUID();
  assert.ok(world.proposePlayerGift(first, { item: "stone", qty: 1 }, 1000).ok);
  assert.equal(
    world.resolveGift(first, first, "cenyan", "accept", 91_000).code,
    "GIFT_EXPIRED",
  );
  assert.ok(
    world.accept(
      randomUUID(),
      plan({ type: "give_item", target_id: "player", item: "stone", qty: 1 }),
    ),
  );
  tick();
  const offer = state().gift!;
  tick(10, (clock) => world.setMovement({ type: "move", dx: 0, dy: 1 }, clock));
  const reply = action("gift-response", "cenyan", {
    offerId: offer.id,
    choice: "accept",
  });
  assert.equal(world.perform(reply, 1_000_600).code, "TOO_FAR");
  assert.equal(state().gift?.id, offer.id);
  tick(10, (clock) =>
    world.setMovement({ type: "move", dx: 0, dy: -1 }, clock),
  );
  assert.equal(world.perform(reply, 1_001_200).code, "GIFT_CAPACITY");
  assert.equal(state().inventory.stone, inventoryLimit);
  assert.equal(state().cenyan.bag.stone, 2);
  assert.equal(state().gift, null);
});

test("pending survives restart, is promoted at step boundary and validates the world again", (t) => {
  const node = valley.resources[0];
  const { world, state, tick, path } = setup(t, (s) => {
    s.player = { x: node.x - 12, y: node.y + 18, facing: "left" };
    Object.assign(s.cenyan, { x: node.x + 12, y: node.y + 18 });
  });
  const base = randomUUID();
  const pending = randomUUID();
  assert.ok(
    world.accept(
      base,
      plan({ type: "wait", seconds: 1 }, { type: "rest", seconds: 1 }),
    ),
  );
  assert.equal(
    world.recordActionReply(pending, "接下来采木", {
      ...plan({ type: "collect", target_id: node.id }),
      goal: "到林地补一份工坊木料",
      goal_tag: "stock-wood",
      plan_policy: "defer",
    }),
    "deferred",
  );
  for (const policy of ["continue", "reject"] as const) {
    world.recordActionReply(randomUUID(), "不用改", {
      goal: "其他事",
      speech: "保留原安排。",
      plan_policy: policy,
    });
    assert.equal(state().cenyan.pending?.id, pending);
    assert.equal(state().cenyan.plan?.id, base);
  }
  assert.equal(
    world.recordActionReply(randomUUID(), "另排一件", {
      ...plan({ type: "rest", seconds: 1 }),
      plan_policy: "defer",
    }),
    "rejected",
  );
  tick(5);
  world.flush();
  const reopened = new SaveFile(path);
  try {
    const loaded = new World(reopened);
    assert.equal(loaded.snapshot().state.cenyan.plan?.id, base);
    assert.equal(loaded.snapshot().state.cenyan.pending?.id, pending);
    assert.equal(loaded.snapshot().state.cenyan.pending?.goalTag, "stock-wood");
    assert.ok(loaded.perform(action("collect", node.id), 1_000_250).ok);
    for (let i = 0; i < 15; i++) loaded.tick(i * 50, 50, 1_000_250 + i * 50);
    const promoted = loaded.snapshot().state.cenyan;
    assert.deepEqual(promoted.plan, {
      id: pending,
      index: 0,
      steps: [{ type: "collect", target_id: node.id }],
    });
    assert.equal(promoted.pending, null);
    assert.equal(promoted.goal, "到林地补一份工坊木料");
    assert.equal(promoted.goalTag, "stock-wood");
    loaded.tick(750, 50, 1_001_000);
    const next = loaded.snapshot().state.cenyan;
    assert.equal(next.pending, null);
    assert.equal(next.plan, null);
    assert.equal(next.last?.code, "COOLDOWN");
    assert.equal(next.last?.status, "failed");
    assert.equal(next.last?.type, "collect");
    assert.equal(next.bag.wood, 0);
    assert.ok(
      loaded
        .perceive()
        .self.recentResults.some((result) => result.code === "WAITED"),
    );
  } finally {
    reopened.close();
  }
});

test("replace preserves completed material and cancels the current step and prior pending", (t) => {
  const { world, state, tick } = setup(t, (s) => {
    atBridge(s);
    s.cenyan.bag.wood = 1;
  });
  assert.ok(
    world.accept(
      randomUUID(),
      plan(
        { type: "deliver", target_id: bridge.id },
        { type: "wait", seconds: 20 },
      ),
    ),
  );
  tick(12);
  world.recordActionReply(randomUUID(), "稍后休息", {
    ...plan({ type: "rest", seconds: 1 }),
    plan_policy: "defer",
  });
  const generation = state().cenyan.generation;
  assert.equal(
    world.recordActionReply(randomUUID(), "现在去工坊", {
      ...plan({ type: "move_to", target_id: home.id }),
      goal: "回去检查工坊",
      plan_policy: "replace",
    }),
    "accepted",
  );
  assert.equal(state().bridge.wood, 1);
  assert.equal(state().cenyan.bag.wood, 0);
  assert.equal(state().cenyan.pending, null);
  assert.equal(state().cenyan.last?.code, "PLAN_REPLACED");
  assert.ok(state().cenyan.generation > generation);
  assert.equal(state().cenyan.goal, "回去检查工坊");
});

test("shared work credits each tick once and the finished fact enters reopened model context", async (t) => {
  const { world, state, tick, path } = setup(t, (s) => {
    atBridge(s);
    s.inventory.wood = 6;
    s.inventory.stone = 2;
  });
  world.perform(action("deliver"));
  world.accept(randomUUID(), plan({ type: "work", target_id: bridge.id }));
  assert.ok(world.perform(action("work")).ok);
  tick(20);
  assert.equal(state().bridge.progressMs, 2000);
  assert.equal(state().contributions.player.workMs, 1000);
  assert.equal(state().contributions.cenyan.workMs, 1000);
  assert.equal(state().sharedWorkMs, 1000);
  assert.ok(world.perform(action("stop")).ok);
  tick(240);
  assert.equal(state().bridge.progressMs, bridge.workMs);
  assert.equal(state().contributions.player.workMs, 1000);
  assert.equal(state().contributions.cenyan.workMs, 13_000);
  assert.equal(state().cenyan.plan, null);
  tick(5);
  const restarted = new SaveFile(path);
  try {
    assert.equal(
      restarted
        .memories(undefined, 20)
        .filter((m) => m.event.startsWith("cooperation:bridge:")).length,
      1,
    );
    const restoredWorld = new World(restarted);
    assert.match(restoredWorld.perceive().memory[0].content, /合力修通/);
    const owner = {} as WebSocket;
    const events: DialogueEvent[] = [];
    let systemContext = "";
    const session = new DialogueSession(
      ":memory:",
      () => ({
        near: restoredWorld.canTalkToCenyan(),
        bridge: restoredWorld.publicBridge(),
      }),
      (_, event) => events.push(event),
      { LLM_ENABLED: "false", LLM_MOCK_DELAY_MS: "10" },
      undefined,
      {
        world: restoredWorld,
        active: () => true,
        storageError: (error) => assert.fail(String(error)),
        mockDialogue: (_, _text, messages) => {
          systemContext = messages[0].content;
          return "我记得我们一起铺过桥板。";
        },
      },
    );
    try {
      session.handle(owner, {
        type: "dialogue-open",
        id: randomUUID(),
        npc: "cenyan",
      });
      const opened = events.find((event) => event.event === "opened");
      assert.ok(opened);
      session.handle(owner, {
        type: "dialogue-send",
        id: randomUUID(),
        dialogId: opened.dialogId,
        text: "记得我们怎样修桥吗？",
      });
      const deadline = performance.now() + 1000;
      while (
        !events.some((event) => event.event === "reply") &&
        performance.now() < deadline
      )
        await delay(10);
      assert.ok(events.some((event) => event.event === "reply"));
      assert.match(systemContext, /旅人与岑砚合力修通旧桥/);
      assert.match(systemContext, /施工：旅人 1.00 秒，岑砚 13.00 秒/);
    } finally {
      await session.close();
    }
  } finally {
    restarted.close();
  }
});

test("follow tracks motion with speed and spacing, idles in range, resumes and can be cancelled", (t) => {
  const { world, state, tick } = setup(t, (s) => {
    s.player = { x: 237, y: 354, facing: "right" };
    Object.assign(s.cenyan, { x: 220, y: 354 });
  });
  const steps = plan({ type: "follow", target_id: "player" });
  assert.equal(world.accept(randomUUID(), steps), false);
  assert.ok(world.accept(randomUUID(), steps, 1_000_000, "一起去桥边"));
  tick(5);
  const start = state().cenyan;
  assert.equal(world.cenyanActivity, "waiting");
  let previous = start;
  tick(15, (clock) => {
    const moved = state().cenyan;
    assert.ok(distance(previous, moved) <= speed / 20 + 0.01);
    assert.ok(distance(state().player, moved) >= 8);
    assert.ok(isPassable(moved.x, moved.y, false));
    world.setMovement({ type: "move", dx: 1, dy: 0 }, clock);
    previous = moved;
  });
  assert.ok(distance(start, state().cenyan) > 20);
  world.setMovement({ type: "move", dx: 0, dy: 0 }, 1000);
  tick(15);
  assert.equal(world.cenyanActivity, "waiting");
  const resting = state().cenyan;
  tick(12, (clock) => world.setMovement({ type: "move", dx: 0, dy: 1 }, clock));
  assert.ok(distance(resting, state().cenyan) > 5);
  const stop = action("stop-follow", "cenyan");
  assert.equal(world.perform(stop).code, "FOLLOW_CANCELLED");
  assert.equal(world.perform(stop).code, "FOLLOW_CANCELLED");
  assert.equal(state().cenyan.plan, null);
});

test("continued absence of a route ends a restored follow without crossing a broken bridge", (t) => {
  const { world, state, tick } = setup(t, (s) => {
    s.player = { x: 560, y: 368, facing: "left" };
    Object.assign(s.cenyan, { x: 435, y: 368 });
    s.cenyan.plan = {
      id: randomUUID(),
      index: 0,
      steps: [{ type: "follow", target_id: "player" }],
      remainingMs: 12_000,
    };
  });
  tick(80);
  assert.equal(state().cenyan.last?.code, "NO_PATH");
  assert.equal(state().cenyan.plan, null);
  assert.ok(state().cenyan.x < bridge.left);
  assert.equal(world.perceive().self.recentResults[0].status, "failed");
});

test("v2 backup and transactional migration preserve old activity, unidentified contributions, receipts and memories", (t) => {
  const path = disk(t);
  const {
    gift: _gift,
    contributions: _contribution,
    sharedWorkMs: _shared,
    cenyan,
    ...previous
  } = freshState();
  const {
    pending: _pending,
    decision: _decision,
    results: _results,
    goalTag: _goalTag,
    ...actor
  } = cenyan;
  previous.bridge = {
    discovered: true,
    wood: 6,
    stone: 2,
    repaired: false,
    progressMs: 150,
  };
  actor.goal = "repair-bridge";
  actor.plan = {
    id: randomUUID(),
    steps: [{ type: "work", target_id: bridge.id }],
    index: 0,
  };
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE world(slot INTEGER PRIMARY KEY, revision INTEGER, payload TEXT);
    CREATE TABLE receipts(id TEXT PRIMARY KEY);
    CREATE TABLE cenyan_memory(id TEXT PRIMARY KEY, actor TEXT, at INTEGER, kind TEXT, source TEXT, event TEXT, topic TEXT, content TEXT);
    INSERT INTO receipts VALUES ('v2-receipt');
    INSERT INTO cenyan_memory VALUES ('m','cenyan',1,'fact','rules','e','old-river-bridge','旧档事实');
    PRAGMA user_version = 2;
  `);
  db.prepare("INSERT INTO world VALUES (1, 5, ?)").run(
    JSON.stringify({ ...previous, schemaVersion: 2, cenyan: actor }),
  );
  db.close();
  const save = new SaveFile(path);
  try {
    assert.deepEqual(save.initial.contributions.legacy, {
      wood: 6,
      stone: 2,
      workMs: 150,
    });
    assert.equal(save.initial.schemaVersion, 3);
    assert.deepEqual(save.initial.cenyan.plan, actor.plan);
    assert.equal(save.initial.cenyan.pending, null);
    assert.equal(save.initial.cenyan.goal, "repair-bridge");
    assert.equal(save.initial.cenyan.goalTag, "repair-bridge");
    assert.ok(save.hasReceipt("v2-receipt"));
    assert.equal(save.memories()[0].content, "旧档事实");
    const backup = path + ".pre-phase3_1.sqlite";
    assert.ok(existsSync(backup));
    const original = new DatabaseSync(backup, { readOnly: true });
    try {
      assert.equal(
        original.prepare("PRAGMA user_version").get()?.user_version,
        2,
      );
      assert.equal(
        original.prepare("SELECT revision FROM world").get()?.revision,
        5,
      );
    } finally {
      original.close();
    }
  } finally {
    save.close();
  }
});

test("an offered gift is unreserved and fails if the giver spends it first", (t) => {
  const { world, state, tick } = setup(t, (s) => {
    atBridge(s);
    s.cenyan.bag.wood = 1;
  });
  const steps = plan(
    { type: "give_item", target_id: "player", item: "wood", qty: 1 },
    { type: "deliver", target_id: bridge.id },
  );
  assert.ok(world.accept(randomUUID(), steps));
  tick();
  const offer = state().gift!;
  assert.equal(state().cenyan.bag.wood, 1);
  tick();
  assert.equal(state().cenyan.bag.wood, 0);
  assert.equal(
    world.perform(
      action("gift-response", "cenyan", {
        offerId: offer.id,
        choice: "accept",
      }),
      1_000_200,
    ).code,
    "GIFT_NO_STOCK",
  );
  assert.equal(state().inventory.wood, 0);
  assert.equal(state().contributions.cenyan.wood, 1);
});

test("replacing NPC work leaves the player working at the original rate", (t) => {
  const { world, state, tick } = setup(t, (s) => {
    atBridge(s);
    Object.assign(s.inventory, { wood: 6, stone: 2 });
  });
  world.perform(action("deliver"));
  world.accept(randomUUID(), plan({ type: "work", target_id: bridge.id }));
  assert.ok(world.perform(action("work")).ok);
  tick(4);
  assert.equal(state().sharedWorkMs, 200);
  world.standPlayer();
  world.recordActionReply(randomUUID(), "去歇一会", {
    ...plan({ type: "rest", seconds: 5 }),
    plan_policy: "replace",
  });
  tick(2);
  assert.equal(state().contributions.player.workMs, 300);
  assert.equal(state().contributions.cenyan.workMs, 200);
  assert.equal(state().bridge.progressMs, 500);
  assert.equal(world.snapshot().working, true);
});

test("two save connections cannot both commit the last material", (t) => {
  const { world, path, state } = setup(t, (s) => {
    atBridge(s);
    s.inventory.wood = 4;
  });
  assert.ok(
    world.perform(action("deliver", bridge.id, { item: "wood", qty: 2 })).ok,
  );
  const competing = new SaveFile(path);
  try {
    const second = new World(competing);
    const before = state();
    const last = action("deliver", bridge.id, { item: "wood", qty: 10 });
    const receipt = second.perform(last);
    assert.deepEqual(receipt.materials, { wood: 2, stone: 0 });
    assert.deepEqual(world.perform(last), receipt);
    assert.throws(() => world.perform(action("deliver")), /另一个服务/);
    assert.deepEqual(state(), before);
    const reopened = new SaveFile(path);
    try {
      assert.deepEqual(reopened.initial, second.snapshot().state);
    } finally {
      reopened.close();
    }
  } finally {
    competing.close();
  }
});

test("model-facing JSON examples match strict action, policy and gift schemas", () => {
  for (const [name, definition] of Object.entries(capabilities)) {
    for (const example of definition.examples) {
      const json = JSON.stringify(example);
      assert.equal(example.type, name);
      assert.ok(dialoguePlanInstructions.includes(json));
      assert.ok(definition.schema.safeParse(JSON.parse(json)).success);
      assert.ok(stepSchema.safeParse(JSON.parse(json)).success);
      assert.equal(
        stepSchema.safeParse({ ...example, actor: "player" }).success,
        false,
      );
    }
  }
  const examples = dialoguePlanInstructions
    .split("\n")
    .filter((line) => line.includes("示例 {"))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
  assert.equal(examples.length, 5);
  for (const example of examples)
    assert.ok(actionReplySchema.safeParse(example).success);
  assert.equal(
    actionReplySchema.safeParse({
      ...examples[0],
      gift_response: examples[4].gift_response,
    }).success,
    false,
  );
  assert.equal(
    actionReplySchema.safeParse({ ...examples[4], plan_policy: "reject" })
      .success,
    false,
  );
  assert.equal(
    actionReplySchema.safeParse({ ...examples[0], goal_tag: "other" }).success,
    false,
  );
  for (const goal of ["stock-wood", "repair-bridge", "rest"])
    assert.equal(legacyGoalTag(goal), goal);
  assert.equal(legacyGoalTag("搬材料到桥边"), undefined);
});

test("bounded model context retains steps, replies and facts with long Chinese input", (t) => {
  const { world } = setup(t);
  const view = world.perceive();
  const fullText = "雾".repeat(240);
  const goal = "桥".repeat(80);
  const steps = Array.from({ length: 3 }, (): Step => ({
    type: "deliver",
    target_id: bridge.id,
    item: "wood",
    qty: inventoryLimit,
  }));
  view.self.goal = goal;
  view.self.active = { id: randomUUID(), index: 1, steps };
  view.self.pending = {
    id: randomUUID(),
    steps,
    goal,
    goalTag: "repair-bridge",
  };
  view.self.recentResults = Array.from({ length: 3 }, () => ({
    type: "deliver",
    status: "failed",
    code: "MATERIALS_MISSING",
    text: "尚缺木材。" + fullText.slice(0, 234),
    change: {
      actor: "cenyan",
      target: bridge.id,
      wood: 6,
      stone: 2,
      workMs: 1250,
      sharedWorkMs: 500,
    },
  }));
  view.gift = {
    id: randomUUID(),
    from: "player",
    item: "stone",
    qty: inventoryLimit,
    expiresAt: Date.now() + 90_000,
  };
  view.resources = valley.resources.map(({ id, item, x, y }) => ({
    id,
    item,
    x,
    y,
    available: true,
  }));
  view.memory = Array.from({ length: 5 }, (): (typeof view.memory)[number] => ({
    id: randomUUID(),
    actor: "cenyan",
    at: 1,
    kind: "fact",
    source: "rules",
    event: randomUUID(),
    topic: bridge.id,
    content: "旅人与岑砚合力修通旧桥。" + fullText.slice(0, 227),
  }));
  const incoming = "雾".repeat(480);
  const contextual = perceptionText(view);
  const chat = buildMessages(
    view.bridge,
    [],
    incoming,
    jsonDialogueInstructions +
      "\n" +
      dialoguePlanInstructions +
      "\n" +
      contextual,
  );
  assert.ok(chat.reservedInputTokens <= contextBytes);
  assert.ok(chat.messages.at(-1)!.content.endsWith(incoming));
  assert.match(contextual, /"pending":\{"id":/);
  assert.match(contextual, /MATERIALS_MISSING.*尚缺木材/);
  assert.match(contextual, /旅人与岑砚合力修通旧桥/);
  const automatic = autonomyMessages(view, "first-active");
  const json = automatic.messages[0].content
    .split("\n")
    .find((line) => line.startsWith("自主计划示例 "))!
    .slice("自主计划示例 ".length);
  assert.ok(decisionSchema.safeParse(JSON.parse(json)).success);
  assert.ok(automatic.reservedInputTokens <= contextBytes);
});

const dummyProvider = {
  LLM_ENABLED: "true",
  LLM_BASE_URL: "http://127.0.0.1:9/v1",
  LLM_API_KEY: "phase31-redaction-dummy",
  LLM_MODEL: "in-process-http-stub",
  LLM_INPUT_USD_PER_MILLION: "0",
  LLM_OUTPUT_USD_PER_MILLION: "0",
  LLM_MAX_TOTAL_USD: "1",
};

function testDialogue(world: World) {
  const owner = {} as WebSocket;
  const messages: DialogueEvent[] = [];
  const session = new DialogueSession(
    ":memory:",
    () => ({ near: world.canTalkToCenyan(), bridge: world.publicBridge() }),
    (_, event) => messages.push(event),
    dummyProvider,
    undefined,
    {
      world,
      active: () => true,
      storageError: (error) => assert.fail(String(error)),
    },
  );
  function open() {
    session.handle(owner, {
      type: "dialogue-open",
      npc: "cenyan",
      id: randomUUID(),
    });
    const event = messages.at(-1);
    assert.equal(event?.event, "opened");
    return event!.event === "opened"
      ? event!.dialogId
      : assert.fail("dialogue did not open");
  }
  async function settled() {
    const until = performance.now() + 1000;
    while (session.load.pending && performance.now() < until) await delay(10);
    assert.equal(session.load.pending, 0);
  }
  return { session, owner, open, messages, settled };
}

test("an accepting provider reply cannot transfer gifts across a closed session or a newer action generation", async (t) => {
  const { world, path, state } = setup(t, (s) => {
    atBridge(s);
    s.inventory.wood = 2;
  });
  let respond!: (response: Response) => void;
  t.mock.method(
    globalThis,
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const { session, owner, messages, open, settled } = testDialogue(world);
  try {
    for (const invalidation of [
      "close",
      "pause",
      "generation",
      "none",
    ] as const) {
      const dialogId = open();
      const id = randomUUID();
      session.handle(owner, {
        type: "dialogue-gift",
        id,
        dialogId,
        gift: { item: "wood", qty: 1 },
      });
      assert.equal(state().gift?.id, id);
      assert.equal(state().inventory.wood, 2);
      if (invalidation === "close")
        session.handle(owner, { type: "dialogue-close", dialogId });
      if (invalidation === "pause") session.suspend("旅程已暂停。");
      if (invalidation === "generation")
        world.recordActionReply(randomUUID(), "改为休息", {
          ...plan({ type: "rest", seconds: 1 }),
          plan_policy: "replace",
        });
      if (invalidation === "close" || invalidation === "pause")
        assert.equal(state().gift, null);
      respond(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  goal: "收下一份木料",
                  goal_tag: "stock-wood",
                  speech: "我愿意收下。",
                  gift_response: { offer_id: id, decision: "accept" },
                }),
                reasoning_content: "PRIVATE_FIXTURE_REASONING",
              },
            },
          ],
        }),
      );
      await settled();
      const outcome = messages.find(
        (event) => event.event === "reply" && event.requestId === id,
      );
      if (invalidation !== "none") {
        assert.equal(outcome, undefined);
        assert.equal(state().gift, null);
        assert.equal(state().inventory.wood, 2);
        assert.equal(state().cenyan.bag.wood, 0);
        assert.equal(state().cenyan.last?.code, "GIFT_CANCELLED");
        continue;
      }
      assert.equal(
        outcome?.event === "reply" && outcome.gift?.code,
        "GIFT_TRANSFERRED",
      );
      assert.deepEqual(state().cenyan.decision, {
        id,
        goal: "收下一份木料",
        goalTag: "stock-wood",
        speech: "我愿意收下。",
        giftResponse: { offer_id: id, decision: "accept" },
        status: "resolved",
        code: "GIFT_TRANSFERRED",
      });
      assert.equal(state().inventory.wood, 1);
      assert.equal(state().cenyan.bag.wood, 1);
      assert.doesNotMatch(JSON.stringify(state()), /PRIVATE_FIXTURE_REASONING/);
      const reopened = new SaveFile(path);
      try {
        assert.deepEqual(
          reopened.initial.cenyan.decision,
          state().cenyan.decision,
        );
      } finally {
        reopened.close();
      }
    }
  } finally {
    await session.close();
  }
});

test("restart discards unconfirmed traveler consent and allows an explicit response to a saved Cenyan offer", (t) => {
  const { world, path, state } = setup(t, (s) => {
    atBridge(s);
    s.inventory.wood = 1;
    s.cenyan.bag.stone = 1;
  });
  const old = randomUUID();
  assert.ok(world.proposePlayerGift(old, { item: "wood", qty: 1 }).ok);
  const reopened = new SaveFile(path);
  try {
    const resumed = new World(reopened);
    const before = resumed.snapshot().state;
    assert.equal(before.gift, null);
    assert.equal(before.inventory.wood, 1);
    assert.equal(before.cenyan.bag.wood, 0);
    assert.equal(before.cenyan.last?.code, "GIFT_CANCELLED");
    assert.equal(
      resumed.resolveGift(old, old, "cenyan", "accept").code,
      "GIFT_UNKNOWN",
    );
    assert.equal(
      resumed.proposePlayerGift(old, { item: "wood", qty: 1 }).code,
      "DUPLICATE",
    );
    assert.ok(
      resumed.accept(
        randomUUID(),
        plan({ type: "give_item", target_id: "player", item: "stone", qty: 1 }),
      ),
    );
    resumed.tick(50, 50);
    const offer = resumed.snapshot().state.gift!;
    assert.equal(offer.from, "cenyan");
    assert.equal(state().inventory.stone, 0);
    const reopenedAgain = new SaveFile(path);
    try {
      const following = new World(reopenedAgain);
      assert.equal(following.snapshot().state.gift?.id, offer.id);
      const consent = action("gift-response", "cenyan", {
        offerId: offer.id,
        choice: "accept",
      });
      const accepted = following.perform(consent);
      assert.equal(accepted.code, "GIFT_TRANSFERRED");
      assert.deepEqual(following.perform(consent), accepted);
      assert.equal(following.snapshot().state.inventory.stone, 1);
      assert.equal(following.snapshot().state.cenyan.bag.stone, 0);
    } finally {
      reopenedAgain.close();
    }
  } finally {
    reopened.close();
  }
});

test("JSON-escaped credentials and private thought markup do not reach the structured decision", async (t) => {
  const { world, state } = setup(t, atBridge);
  const valid = JSON.stringify({
    goal: "稍作歇息",
    goal_tag: "rest",
    speech: "我歇一会。",
    plan_policy: "replace",
    plan: [{ type: "rest", seconds: 1 }],
  });
  const replies = [
    valid,
    valid.replace("我歇一会。", "\\u0070" + dummyProvider.LLM_API_KEY.slice(1)),
    valid.replace("我歇一会。", "\\u003cthink>不可见\\u003c/think>"),
  ];
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [
        {
          message: {
            content: replies.shift(),
            reasoning_content: "PRIVATE_REASONING",
          },
        },
      ],
    }),
  );
  const { session, owner, messages, open, settled } = testDialogue(world);
  try {
    const dialogId = open();
    const id = randomUUID();
    session.handle(owner, {
      type: "dialogue-send",
      id,
      dialogId,
      text: "歇一会儿吧。",
    });
    await settled();
    assert.deepEqual(state().cenyan.decision, {
      id,
      goal: "稍作歇息",
      goalTag: "rest",
      speech: "我歇一会。",
      policy: "replace",
      status: "accepted",
      steps: [{ type: "rest", seconds: 1 }],
    });
    for (const text of ["请继续说。", "接着说。"]) {
      const requestId = randomUUID();
      session.handle(owner, {
        type: "dialogue-send",
        id: requestId,
        dialogId,
        text,
      });
      await settled();
      assert.ok(
        messages.some(
          (event) =>
            event.event === "error" &&
            event.requestId === requestId &&
            event.code === "invalid",
        ),
      );
      assert.equal(state().cenyan.decision?.id, id);
    }
    assert.doesNotMatch(
      JSON.stringify({ messages, state: state() }),
      /phase31-redaction-dummy|PRIVATE_REASONING|不可见/,
    );
  } finally {
    await session.close();
  }
});
