import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import {
  clientMessage,
  type Action,
  type SaveState,
} from "../src/shared/protocol.js";
import {
  distance,
  isPassable,
  mapWidth,
  mapHeight,
  speed,
  tickMs,
  valley,
  nearbyTarget,
  type Point,
  type Target,
} from "../src/shared/world.js";
import { SaveFile, freshState } from "../src/server/save.js";
import { World } from "../src/server/world.js";
import { createApp } from "../src/server/app.js";
import { route } from "./paths.js";

function files(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "mistsea-rules-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "valley.sqlite");
}

function setup(t: TestContext, arrange?: (state: SaveState) => void) {
  const path = files(t);
  if (arrange) {
    const initial = freshState();
    arrange(initial);
    const save = new SaveFile(path);
    save.write(initial);
    save.close();
  }
  const save = new SaveFile(path);
  t.after(() => save.close());
  return { world: new World(save), save, path };
}

function action(verb: Action["verb"], target: string): Action {
  return { type: "action", verb, target, id: randomUUID() };
}

function bridgePosition(state: SaveState) {
  state.player = { x: 443, y: 368, facing: "right" };
}

function centerWest(state: SaveState) {
  state.player = { x: 417, y: 370, facing: "right" };
}

function reachable(repaired: boolean) {
  const step = 8;
  const offset = 4;
  const cols = mapWidth / step;
  const rows = mapHeight / step;
  const start =
    Math.floor(valley.spawn.y / step) * cols +
    Math.floor(valley.spawn.x / step);
  const queue = [start];
  const visited = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const column = current % cols;
    const row = Math.floor(current / cols);
    for (const [x, y] of [
      [column - 1, row],
      [column + 1, row],
      [column, row - 1],
      [column, row + 1],
    ]) {
      const index = y * cols + x;
      if (x < 0 || x >= cols || y < 0 || y >= rows || visited.has(index))
        continue;
      if (
        !isPassable(x * step + offset, y * step + offset, repaired) ||
        !isPassable(
          ((x + column) * step) / 2 + offset,
          ((y + row) * step) / 2 + offset,
          repaired,
        )
      )
        continue;
      visited.add(index);
      queue.push(index);
    }
  }
  return queue.map((index) => ({
    x: (index % cols) * step + offset,
    y: Math.floor(index / cols) * step + offset,
  }));
}

test("strict input accepts intent only and requires explicit reset confirmation", () => {
  assert.ok(clientMessage.safeParse({ type: "move", dx: -1, dy: 1 }).success);
  assert.ok(
    clientMessage.safeParse(action("inspect", valley.bridge.id)).success,
  );
  for (const payload of [
    { type: "move", dx: 2, dy: 0 },
    { type: "move", dx: 1, dy: 0, x: 600, y: 368 },
    { type: "move", dx: 1, dy: 0, elapsed: 10000 },
    { ...action("deliver", valley.bridge.id), wood: 6 },
    { ...action("work", valley.bridge.id), workMs: 14000 },
    { ...action("inspect", valley.ruin.id), target: "../other" },
    { type: "reset", id: randomUUID(), confirm: false },
    { type: "reset", id: randomUUID() },
    { type: "pause", paused: 1 },
  ])
    assert.equal(clientMessage.safeParse(payload).success, false);
});

test("runtime assets exactly match the CC0 manifest and every map reference", () => {
  const manifest = JSON.parse(readFileSync("assets/manifest.json", "utf8"));
  const tracked = manifest.assets
    .map((asset: { outputPath: string }) => asset.outputPath)
    .sort();
  const actual = readdirSync("public/assets", {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  assert.deepEqual(tracked, actual);
  assert.match(
    readFileSync(manifest.licenseFile, "utf8"),
    /^CC0 1.0 Universal/,
  );
  const ids = new Set<string>();
  for (const asset of manifest.assets) {
    assert.equal(asset.license, "CC0-1.0");
    assert.equal(ids.has(asset.assetId), false);
    ids.add(asset.assetId);
    assert.match(asset.originalSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      createHash("sha256").update(readFileSync(asset.outputPath)).digest("hex"),
      asset.sha256,
    );
  }
  const required = [
    ...valley.props.map((p) => p.asset),
    ...valley.resources.flatMap((p) => [p.asset, p.spent]),
    ...valley.residents.flatMap((p) => [`${p.asset}-idle`, `${p.asset}-face`]),
    "player-idle",
    "player-walk",
    "player-face",
    "valley-ground",
    "valley-river",
    "bridge-broken",
    "bridge-open",
    "wood",
    "stone",
    "food",
    "toolbox",
    "arrow",
    "letter",
  ];
  for (const image of required) assert.ok(ids.has(`${image}.png`), image);
  for (const audio of ["village.ogg", "alert.wav"])
    assert.ok(ids.has(audio), audio);
});

test("map dimensions, terrain frames, unique stable IDs and spawn match data", () => {
  assert.equal(valley.width, 48);
  assert.equal(valley.height, 48);
  assert.equal(valley.tileSize, 16);
  for (const [layer, min, max] of [
    [valley.ground, 0, 17],
    [valley.river, -1, 13],
  ] as const) {
    assert.equal(layer.length, valley.height);
    for (const row of layer) {
      assert.equal(row.length, valley.width);
      assert.ok(
        row.every(
          (value) => Number.isInteger(value) && value >= min && value <= max,
        ),
      );
    }
  }
  const ids = [
    valley.spawn,
    valley.bridge,
    valley.ruin,
    ...valley.residents,
    ...valley.resources,
    ...valley.props,
  ].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(isPassable(valley.spawn.x, valley.spawn.y, false));
  const animation = JSON.parse(readFileSync("data/animations.json", "utf8"));
  assert.deepEqual(animation.walk.framesByDirection.right, [3, 7, 11, 15]);
  assert.deepEqual(animation.walk.framesByDirection.up, [1, 5, 9, 13]);
});

test("west bank resources are reachable and the only route east is the repaired crossing", () => {
  assert.ok(
    valley.river.every((row) => row.filter((tile) => tile >= 0).length === 5),
  );
  const old = reachable(false);
  for (const target of [
    ...valley.resources,
    ...valley.residents,
    valley.bridge,
  ]) {
    assert.ok(
      old.some((p) => distance(target, p) <= target.range - 6),
      target.id,
    );
  }
  assert.equal(
    old.some((p) => p.x > 550),
    false,
  );
  assert.ok(
    reachable(true).some(
      (p) => distance(valley.ruin, p) <= valley.ruin.range - 6,
    ),
  );
  assert.equal(isPassable(500, 350, true), false);
  assert.equal(isPassable(500, 368, false), false);
  assert.equal(isPassable(500, 368, true), true);
  assert.equal(isPassable(247, 267, true), false);
  assert.equal(isPassable(mapWidth + 1, 368, true), false);
});

test("server ticks enforce normalized speed, expiring input and no message-driven movement", (t) => {
  const { world } = setup(t);
  const before = world.snapshot().state.player;
  const move = { type: "move", dx: 1, dy: 1 } as const;
  for (let i = 0; i < 100; i++) world.setMovement(move, i);
  assert.deepEqual(world.snapshot().state.player, before);
  world.tick(120, 4000);
  const after = world.snapshot().state.player;
  assert.ok(
    Math.abs(distance(before, after) - (speed * tickMs) / 1000) < 0.001,
  );
  world.tick(600, tickMs);
  assert.deepEqual(world.snapshot().state.player, after);
});

test("wall, tree, rock, closed river and bounds use the same foot collision", (t) => {
  const { world } = setup(t, centerWest);
  for (let time = 0; time < 2500; time += tickMs) {
    world.setMovement({ type: "move", dx: 1, dy: 0 }, time);
    world.tick(time, tickMs);
  }
  assert.ok(
    world.snapshot().state.player.x >= 451 &&
      world.snapshot().state.player.x < 461,
  );
  for (const id of ["house-carpenter", "landmark-tree-00", "boulders-00"]) {
    const prop = valley.props.find((entry) => entry.id === id)!;
    assert.ok(prop.solid);
    assert.equal(
      isPassable(prop.solid.x + 4, prop.solid.y + 4, false),
      false,
      id,
    );
  }
});

test("distant, wrong-target, unknown and insufficient actions do not touch storage", (t) => {
  const { world } = setup(t, centerWest);
  assert.equal(
    world.perform(action("inspect", valley.ruin.id)).code,
    "TOO_FAR",
  );
  assert.equal(
    world.perform(action("collect", valley.bridge.id)).code,
    "INVALID_ACTION",
  );
  assert.equal(
    world.perform(action("inspect", "missing")).code,
    "UNKNOWN_TARGET",
  );
  const before = world.snapshot().state;
  assert.equal(
    world.perform(action("deliver", valley.bridge.id)).code,
    "MATERIALS_MISSING",
  );
  assert.equal(
    world.perform(action("work", valley.bridge.id)).code,
    "MATERIALS_MISSING",
  );
  assert.deepEqual(world.snapshot().state, before);
});

test("collection is durable, cooldown prevents rush and duplicate id remains rejected after restart", (t) => {
  const node = valley.resources[0];
  const { world, path } = setup(t, (state) => {
    state.player = { x: node.x, y: node.y + 17, facing: "up" };
  });
  const pickup = action("collect", node.id);
  const now = 10000;
  assert.equal(world.perform(pickup, now).code, "COLLECTED");
  assert.equal(
    world.perform(action("collect", node.id), now + 30).code,
    "COOLDOWN",
  );
  const restored = new SaveFile(path);
  try {
    const restarted = new World(restored);
    assert.equal(restarted.snapshot().state.inventory.wood, 1);
    assert.equal(
      restarted.snapshot().state.cooldowns[node.id],
      now + node.cooldownMs,
    );
    assert.equal(
      restarted.perform(pickup, now + node.cooldownMs).code,
      "DUPLICATE",
    );
    assert.equal(
      restarted.perform(action("collect", node.id), now + node.cooldownMs).code,
      "COLLECTED",
    );
    assert.equal(restarted.snapshot().state.inventory.wood, 2);
  } finally {
    restored.close();
  }
});

test("delivery is atomic and timed work can pause and resume without counting offline time", (t) => {
  const { world, path } = setup(t, (state) => {
    bridgePosition(state);
    state.inventory.wood = 7;
    state.inventory.stone = 2;
  });
  const deliver = action("deliver", valley.bridge.id);
  const delivered = world.perform(deliver);
  assert.equal(delivered.code, "DELIVERED");
  assert.deepEqual(world.perform(deliver), delivered);
  assert.equal(
    world.perform(action("deliver", valley.bridge.id)).code,
    "MATERIALS_READY",
  );
  assert.deepEqual(world.snapshot().state.inventory, {
    wood: 1,
    stone: 0,
    food: 0,
    toolbox: 0,
  });
  const work = action("work", valley.bridge.id);
  assert.equal(world.perform(work).code, "WORK_STARTED");
  assert.equal(
    world.perform(action("work", valley.bridge.id)).code,
    "ALREADY_WORKING",
  );
  assert.equal(world.snapshot().state.bridge.progressMs, 0);
  world.tick(50, 80000);
  world.halt();
  world.tick(150, 80000);
  assert.equal(world.snapshot().state.bridge.progressMs, tickMs);
  const reopened = new SaveFile(path);
  try {
    const continued = new World(reopened);
    assert.equal(continued.snapshot().working, false);
    assert.equal(continued.snapshot().state.bridge.progressMs, tickMs);
    assert.equal(continued.perform(work).code, "DUPLICATE");
    assert.equal(
      continued.perform(action("work", valley.bridge.id)).code,
      "WORK_STARTED",
    );
    for (let ms = 2 * tickMs; ms <= valley.bridge.workMs; ms += tickMs)
      continued.tick(ms, tickMs);
    assert.equal(continued.snapshot().state.bridge.repaired, true);
    assert.equal(continued.snapshot().working, false);
    assert.equal(
      continued.perform(action("work", valley.bridge.id)).code,
      "BRIDGE_DONE",
    );
  } finally {
    reopened.close();
  }
});

test("checked reset is durable and a repeated reset cannot wipe subsequent progress", (t) => {
  const { world, path } = setup(t, (state) => {
    bridgePosition(state);
    state.inventory.wood = 1;
  });
  const reset = { type: "reset", id: randomUUID(), confirm: true } as const;
  assert.equal(world.reset(reset).code, "RESET");
  const origin = world.snapshot().state;
  assert.deepEqual(origin, freshState());
  world.setMovement({ type: "move", dx: 1, dy: 0 }, 100);
  world.tick(150, 50);
  world.flush();
  assert.equal(world.reset(reset).code, "DUPLICATE");
  const restored = new SaveFile(path);
  assert.ok(restored.initial.player.x > origin.player.x);
  restored.close();
});

test("conflicting save revision leaves the winning storage and losing world untouched", (t) => {
  const { world, path } = setup(t, bridgePosition);
  const winningSave = new SaveFile(path);
  try {
    const first = new World(winningSave);
    first.perform(action("inspect", valley.bridge.id));
    const before = world.snapshot().state;
    assert.throws(
      () => world.perform(action("inspect", valley.bridge.id)),
      /另一个服务/,
    );
    assert.deepEqual(world.snapshot().state, before);
    const restored = new SaveFile(path);
    assert.equal(restored.initial.bridge.discovered, true);
    restored.close();
  } finally {
    winningSave.close();
  }
});

test("bad SQLite and incompatible state produce a health error without replacing the original", async (t) => {
  const path = files(t);
  const invalid = Buffer.from("not SQLite; preserve original");
  writeFileSync(path, invalid);
  const app = createApp({ savePath: path });
  try {
    const response = await app.inject("/health");
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().status, "save_error");
    assert.deepEqual(readFileSync(path), invalid);
  } finally {
    await app.close();
  }

  const unrecognized = join(path, "..", "unrecognized.sqlite");
  const save = new SaveFile(unrecognized);
  save.close();
  const db = new DatabaseSync(unrecognized);
  db.prepare("UPDATE world SET payload = ?").run(
    JSON.stringify({ ...freshState(), contentVersion: 900 }),
  );
  db.close();
  const original = readFileSync(unrecognized);
  assert.throws(() => new SaveFile(unrecognized));
  assert.deepEqual(readFileSync(unrecognized), original);
});

test("healthy Fastify opens a versioned local save without API keys", async () => {
  const app = createApp({ savePath: ":memory:" });
  try {
    const response = await app.inject("/health");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      phase: 5,
      schemaVersion: 5,
      contentVersion: valley.contentVersion,
      status: "ok",
    });
  } finally {
    await app.close();
  }
});

test("fresh rules-only journey follows walkable paths, collects six wood and two stone, and reaches the beacon", (t) => {
  const { world, path } = setup(t);
  let clock = 0;
  function walk(goal: (p: Point) => boolean, repaired = false) {
    for (const waypoint of route(
      world.snapshot().state.player,
      goal,
      repaired,
      Object.values(world.snapshot().state.actors),
    )) {
      const sign = Math.sign(
        waypoint[waypoint.axis] - world.snapshot().state.player[waypoint.axis],
      ) as -1 | 0 | 1;
      const dx = waypoint.axis === "x" ? sign : 0;
      const dy = waypoint.axis === "y" ? sign : 0;
      let remaining = 240;
      while (
        (world.snapshot().state.player[waypoint.axis] -
          waypoint[waypoint.axis]) *
          sign <
        -1.7
      ) {
        assert.ok(
          remaining-- > 0,
          `Could not walk to ${JSON.stringify(waypoint)}`,
        );
        clock += tickMs;
        world.setMovement({ type: "move", dx, dy }, clock);
        world.tick(clock, tickMs);
      }
    }
    world.halt();
  }
  function approach(target: Target, repaired = false) {
    walk(
      (point) =>
        distance(point, target) <= target.range - 8 &&
        nearbyTarget(point)?.id === target.id,
      repaired,
    );
    assert.equal(nearbyTarget(world.snapshot().state.player)?.id, target.id);
  }
  for (const resident of valley.residents) {
    approach(resident);
    assert.equal(world.perform(action("inspect", resident.id)).code, "INTRO");
  }
  approach(valley.bridge);
  assert.equal(
    world.perform(action("inspect", valley.bridge.id)).code,
    "BRIDGE",
  );
  walk((p) => p.x > 432 && p.x < 453 && Math.abs(p.y - 368) <= 4.1);
  for (let i = 0; i < 45; i++) {
    clock += tickMs;
    world.setMovement({ type: "move", dx: 1, dy: 0 }, clock);
    world.tick(clock, tickMs);
  }
  assert.ok(world.snapshot().state.player.x < 461);
  world.halt();
  for (const node of valley.resources.slice(0, 8)) {
    approach(node);
    assert.equal(
      world.perform(action("collect", node.id), Date.now()).code,
      "COLLECTED",
    );
  }
  assert.deepEqual(world.snapshot().state.inventory, {
    wood: 6,
    stone: 2,
    food: 0,
    toolbox: 0,
  });
  approach(valley.bridge);
  assert.equal(
    world.perform(action("deliver", valley.bridge.id)).code,
    "DELIVERED",
  );
  assert.equal(
    world.perform(action("work", valley.bridge.id)).code,
    "WORK_STARTED",
  );
  for (let i = 0; i < valley.bridge.workMs; i += tickMs) {
    clock += tickMs;
    world.tick(clock, tickMs);
  }
  assert.equal(world.snapshot().state.bridge.repaired, true);
  approach(valley.ruin, true);
  assert.ok(world.snapshot().state.player.x > 600);
  assert.equal(world.perform(action("inspect", valley.ruin.id)).code, "RUIN");
  const restored = new SaveFile(path);
  try {
    assert.deepEqual(restored.initial, world.snapshot().state);
  } finally {
    restored.close();
  }
});
