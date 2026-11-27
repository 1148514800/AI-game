import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cenyanId, legacyGoalTag, type Memory } from "../shared/cenyan.js";
import {
  legacySaveSchema,
  saveSchema,
  schemaVersion,
  v2SaveSchema,
  v3SaveSchema,
  type Result,
  type SaveState,
} from "../shared/protocol.js";
import { npcIds, type NpcId } from "../shared/social.js";
import { isPassable, residents, resources, valley } from "../shared/world.js";

function freshActor(id: NpcId): SaveState["cenyan"] {
  const home = residents.get(id)!;
  const goal = {
    cenyan: "stock-wood",
    ahe: "为聚落储备物资",
    luozhou: "repair-bridge",
  }[id];
  return {
    id,
    relations: {},
    x: home.x,
    y: home.y,
    facing: home.facing,
    bag: { wood: 0, stone: 0 },
    goal,
    goalTag: legacyGoalTag(goal),
    generation: 0,
    plan: null,
    pending: null,
    decision: null,
    results: [],
    last: null,
  };
}

export function freshState(): SaveState {
  const cenyan = freshActor("cenyan");
  return {
    schemaVersion,
    contentVersion: valley.contentVersion,
    worldId: valley.id,
    player: { x: valley.spawn.x, y: valley.spawn.y, facing: "down" },
    inventory: { wood: 0, stone: 0, food: 0, toolbox: 0 },
    cooldowns: {},
    bridge: {
      discovered: false,
      wood: 0,
      stone: 0,
      progressMs: 0,
      repaired: false,
    },
    explored: false,
    gift: null,
    sharedWorkMs: 0,
    contributions: {
      player: emptyContribution(),
      cenyan: emptyContribution(),
      ahe: emptyContribution(),
      luozhou: emptyContribution(),
      legacy: emptyContribution(),
    },
    actors: { cenyan, ahe: freshActor("ahe"), luozhou: freshActor("luozhou") },
    cenyan,
    workPairs: [],
    talkCooldowns: {},
    deals: [],
    pledges: [],
    events: [],
  };
}

const emptyContribution = () => ({ wood: 0, stone: 0, workMs: 0 });

function decode(payload: string, version: number): SaveState {
  const raw: unknown = JSON.parse(payload);
  let save: SaveState;
  if (version === schemaVersion) {
    const current = saveSchema.parse(raw);
    save = { ...current, cenyan: current.actors.cenyan };
  } else {
    const fresh = freshState();
    const v3 = version === 3 ? v3SaveSchema.parse(raw) : undefined;
    const old =
      v3 ??
      (version === 2
        ? v2SaveSchema.parse(raw)
        : { ...legacySaveSchema.parse(raw), cenyan: fresh.cenyan });
    if (
      v3 &&
      v3.sharedWorkMs >
        Math.min(
          v3.contributions.player.workMs,
          v3.contributions.cenyan.workMs,
        ) +
          0.001
    )
      throw Error("旧档重叠工时超出参与者工时");
    const cenyan = {
      ...old.cenyan,
      goalTag: old.cenyan.goalTag ?? legacyGoalTag(old.cenyan.goal),
    };
    save = {
      ...fresh,
      ...old,
      schemaVersion,
      cenyan,
      actors: { ...fresh.actors, cenyan },
      gift: v3?.gift ?? null,
      sharedWorkMs: v3?.sharedWorkMs ?? 0,
      workPairs: v3?.sharedWorkMs ? ["cenyan:player"] : [],
      contributions: {
        ...fresh.contributions,
        ...(v3?.contributions ?? {
          legacy: {
            wood: old.bridge.wood,
            stone: old.bridge.stone,
            workMs: old.bridge.progressMs,
          },
        }),
      },
    };
  }
  const bridge = save.bridge;
  const full =
    bridge.wood === valley.bridge.required.wood &&
    bridge.stone === valley.bridge.required.stone;
  const contributions = Object.values(save.contributions);
  const total = (key: "wood" | "stone" | "workMs") =>
    contributions.reduce((sum, entry) => sum + entry[key], 0);
  const agreements = [...save.deals, ...save.pledges];
  const agreementIds = new Set(agreements.map((entry) => entry.id));
  if (
    agreementIds.size !== agreements.length ||
    agreements.some((entry) => entry.from === entry.to) ||
    new Set(save.workPairs).size !== save.workPairs.length ||
    !isPassable(save.player.x, save.player.y, bridge.repaired) ||
    npcIds.some((id) => {
      const actor = save.actors[id];
      return (
        actor.id !== id ||
        !isPassable(actor.x, actor.y, bridge.repaired) ||
        (actor.plan && actor.plan.index >= actor.plan.steps.length) ||
        (actor.pending !== null && actor.plan === null)
      );
    }) ||
    total("wood") !== bridge.wood ||
    total("stone") !== bridge.stone ||
    Math.abs(total("workMs") - bridge.progressMs) > 0.001 ||
    save.sharedWorkMs > bridge.progressMs / 2 + 0.001 ||
    Object.keys(save.cooldowns).some((id) => !resources.has(id)) ||
    (!bridge.discovered && (bridge.wood !== 0 || bridge.stone !== 0)) ||
    (!full && bridge.progressMs !== 0) ||
    bridge.repaired !== (bridge.progressMs === valley.bridge.workMs) ||
    (save.explored && !bridge.repaired)
  ) {
    throw Error("存档内容与地图或工程规则不一致");
  }
  return save;
}

function encode(state: SaveState) {
  const { cenyan: _projection, ...stored } = state;
  return JSON.stringify(stored);
}

const memoryTable = `
  CREATE TABLE cenyan_memory (
    id TEXT PRIMARY KEY, actor TEXT NOT NULL, at INTEGER NOT NULL,
    kind TEXT NOT NULL, source TEXT NOT NULL, event TEXT NOT NULL,
    topic TEXT NOT NULL, content TEXT NOT NULL
  ) STRICT;
  CREATE INDEX memory_actor_at ON cenyan_memory(actor, at);
  CREATE INDEX memory_actor_topic_at ON cenyan_memory(actor, topic, at);
`;

export class SaveFile {
  readonly initial: SaveState;
  private readonly db: DatabaseSync;
  private revision: number;

  constructor(path: string) {
    const existing = path !== ":memory:" && existsSync(path);
    if (existing && statSync(path).size === 0)
      throw Error("现有 SQLite 存档为空");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA busy_timeout = 1500");
      if (!existing) {
        this.transaction(() => {
          this.db.exec(`
          CREATE TABLE world (
            slot INTEGER PRIMARY KEY CHECK(slot = 1),
            revision INTEGER NOT NULL,
            payload TEXT NOT NULL
          ) STRICT;
          CREATE TABLE receipts (id TEXT PRIMARY KEY, result TEXT) STRICT;
          ${memoryTable}
          PRAGMA user_version = ${schemaVersion};
          `);
          this.db
            .prepare("INSERT INTO world VALUES (1, 0, ?)")
            .run(encode(freshState()));
        });
      }
      const integrity = this.db
        .prepare("PRAGMA quick_check")
        .get()?.quick_check;
      if (integrity !== "ok") throw Error("SQLite 完整性检查失败");
      const version = this.db
        .prepare("PRAGMA user_version")
        .get()?.user_version;
      if (
        version !== 1 &&
        version !== 2 &&
        version !== 3 &&
        version !== schemaVersion
      )
        throw Error("SQLite 存档版本不受支持");
      const row = this.db
        .prepare("SELECT revision, payload FROM world WHERE slot = 1")
        .get();
      if (
        !row ||
        typeof row.payload !== "string" ||
        typeof row.revision !== "number" ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 0
      )
        throw Error("找不到有效的单人存档");
      this.db.prepare("SELECT id FROM receipts LIMIT 1").get();
      this.initial = decode(row.payload, version);
      this.revision = row.revision;
      if (version !== schemaVersion) {
        // VACUUM INTO includes any committed WAL pages. A previous backup is
        // retained, including when a migration was interrupted after backup.
        const base = path + ".pre-phase4.sqlite";
        let backupPath = base;
        for (let suffix = 1; existsSync(backupPath); suffix++)
          backupPath = base + "." + suffix;
        this.db.prepare("VACUUM INTO ?").run(backupPath);
        this.transaction(() => {
          if (version === 1) this.db.exec(memoryTable);
          if (version < 3)
            this.db.exec("ALTER TABLE receipts ADD COLUMN result TEXT");
          this.update(this.initial);
          this.db.exec(`PRAGMA user_version = ${schemaVersion}`);
        });
        this.revision++;
      }
      this.db.prepare("SELECT id FROM cenyan_memory LIMIT 1").get();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  hasReceipt(id: string) {
    return Boolean(
      this.db.prepare("SELECT 1 FROM receipts WHERE id = ?").get(id),
    );
  }

  receipt(id: string): Result | undefined {
    const row = this.db
      .prepare("SELECT result FROM receipts WHERE id = ?")
      .get(id);
    return typeof row?.result === "string"
      ? (JSON.parse(row.result) as Result)
      : undefined;
  }

  memories(topic?: string, limit = 6, actor: NpcId = cenyanId): Memory[] {
    const latest = this.db
      .prepare(
        "SELECT * FROM cenyan_memory WHERE actor = ? ORDER BY at DESC, rowid DESC LIMIT ?",
      )
      .all(actor, limit) as Memory[];
    if (!topic) return latest;
    const byEvent = this.db.prepare(
      `SELECT * FROM cenyan_memory WHERE actor = ? AND kind = 'fact' AND event LIKE ?
       ORDER BY at DESC, rowid DESC LIMIT ?`,
    );
    const cooperation = byEvent.all(actor, "cooperation:%", 2) as Memory[];
    const gifts = byEvent.all(actor, "gift:%", 1) as Memory[];
    const related = this.db
      .prepare(
        `SELECT * FROM cenyan_memory WHERE actor = ? AND kind = 'fact' AND topic = ?
       ORDER BY at DESC, rowid DESC LIMIT 2`,
      )
      .all(actor, topic) as Memory[];
    return [
      ...new Map(
        [...cooperation, ...related, ...gifts, ...latest].map((item) => [
          item.id,
          item,
        ]),
      ).values(),
    ].slice(0, limit);
  }

  write(
    state: SaveState,
    receipt?: string,
    memories: Memory[] = [],
    reset = false,
    result?: Result,
    secondaryReceipt?: string,
  ) {
    this.transaction(() => {
      this.update(state);
      for (const id of [receipt, secondaryReceipt])
        if (id)
          this.db
            .prepare("INSERT INTO receipts (id, result) VALUES (?, ?)")
            .run(id, result ? JSON.stringify(result) : null);
      if (reset) this.db.exec("DELETE FROM cenyan_memory");
      if (memories.length) {
        const insert = this.db.prepare(
          "INSERT INTO cenyan_memory VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        );
        for (const m of memories)
          insert.run(
            m.id,
            m.actor,
            m.at,
            m.kind,
            m.source,
            m.event,
            m.topic,
            m.content,
          );
      }
    });
    this.revision++;
  }

  close() {
    this.db.close();
  }

  private update(state: SaveState) {
    const change = this.db
      .prepare(
        "UPDATE world SET revision = revision + 1, payload = ? WHERE slot = 1 AND revision = ?",
      )
      .run(encode(state), this.revision);
    if (change.changes !== 1) throw Error("存档已由另一个服务修改");
  }

  private transaction(operation: () => void) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      operation();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
