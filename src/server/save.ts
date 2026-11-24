import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  saveSchema,
  schemaVersion,
  type SaveState,
} from "../shared/protocol.js";
import { isPassable, resources, valley } from "../shared/world.js";

export function freshState(): SaveState {
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
  };
}

function decode(payload: string): SaveState {
  const save = saveSchema.parse(JSON.parse(payload));
  const bridge = save.bridge;
  const full =
    bridge.wood === valley.bridge.required.wood &&
    bridge.stone === valley.bridge.required.stone;
  if (
    !isPassable(save.player.x, save.player.y, bridge.repaired) ||
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
          CREATE TABLE receipts (id TEXT PRIMARY KEY) STRICT;
          PRAGMA user_version = ${schemaVersion};
          `);
          this.db
            .prepare("INSERT INTO world VALUES (1, 0, ?)")
            .run(JSON.stringify(freshState()));
        });
      }
      const integrity = this.db
        .prepare("PRAGMA quick_check")
        .get()?.quick_check;
      if (integrity !== "ok") throw Error("SQLite 完整性检查失败");
      if (
        this.db.prepare("PRAGMA user_version").get()?.user_version !==
        schemaVersion
      ) {
        throw Error("SQLite 存档版本不受支持");
      }
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
      this.initial = decode(row.payload);
      this.revision = row.revision;
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

  write(state: SaveState, receipt?: string) {
    this.transaction(() => {
      const change = this.db
        .prepare(
          "UPDATE world SET revision = revision + 1, payload = ? WHERE slot = 1 AND revision = ?",
        )
        .run(JSON.stringify(state), this.revision);
      if (change.changes !== 1) throw Error("存档已由另一个服务修改");
      if (receipt)
        this.db.prepare("INSERT INTO receipts VALUES (?)").run(receipt);
    });
    this.revision++;
  }

  close() {
    this.db.close();
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
