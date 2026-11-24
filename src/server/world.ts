import type {
  ClientMessage,
  Action,
  Result,
  SaveState,
  Snapshot,
} from "../shared/protocol.js";
import {
  distance,
  inventoryLimit,
  isPassable,
  items,
  residents,
  resources,
  speed,
  tickMs,
  valley,
} from "../shared/world.js";
import { freshState, SaveFile } from "./save.js";

const leaseMs = 420;
const bridge = valley.bridge;

function reply(
  action: Action,
  ok: boolean,
  code: string,
  text: string,
): Result {
  return {
    type: "result",
    id: action.id,
    target: action.target,
    ok,
    code,
    text,
  };
}

export class World {
  private state: SaveState;
  private intent = { dx: 0, dy: 0, expires: 0 };
  private working = false;
  private moving = false;
  private dirty = false;
  private positionSavedAt = 0;

  constructor(private readonly save: SaveFile) {
    this.state = structuredClone(save.initial);
  }

  get activity() {
    return { moving: this.moving, working: this.working };
  }

  snapshot(now = Date.now()): Snapshot {
    return {
      type: "snapshot",
      now,
      state: structuredClone(this.state),
      moving: this.moving,
      working: this.working,
    };
  }

  setMovement(
    { dx, dy }: Extract<ClientMessage, { type: "move" }>,
    clock: number,
  ) {
    this.intent = { dx, dy, expires: clock + leaseMs };
    if (dx || dy) this.working = false;
  }

  tick(clock: number, elapsed: number) {
    const stepMs = Math.min(tickMs, Math.max(0, elapsed));
    const { dx, dy } =
      this.intent.expires > clock ? this.intent : { dx: 0, dy: 0 };
    const player = this.state.player;
    this.moving = false;
    if (dx || dy) {
      const step = (speed * stepMs) / 1000 / Math.hypot(dx, dy);
      const facing =
        Math.abs(dx) >= Math.abs(dy)
          ? dx < 0
            ? "left"
            : "right"
          : dy < 0
            ? "up"
            : "down";
      const x = isPassable(
        player.x + dx * step,
        player.y,
        this.state.bridge.repaired,
      )
        ? player.x + dx * step
        : player.x;
      const y = isPassable(x, player.y + dy * step, this.state.bridge.repaired)
        ? player.y + dy * step
        : player.y;
      this.moving = x !== player.x || y !== player.y;
      if (this.moving || player.facing !== facing) {
        this.state = { ...this.state, player: { x, y, facing } };
        this.dirty = true;
      }
    }
    if (this.working && stepMs > 0) {
      const progressMs = Math.min(
        bridge.workMs,
        this.state.bridge.progressMs + stepMs,
      );
      const repaired = progressMs === bridge.workMs;
      this.commit({
        ...this.state,
        bridge: { ...this.state.bridge, progressMs, repaired },
      });
      if (repaired) this.working = false;
    }
    if (this.dirty && clock - this.positionSavedAt >= 5000) {
      this.flush();
      this.positionSavedAt = clock;
    }
  }

  perform(action: Action, now = Date.now()): Result {
    if (this.save.hasReceipt(action.id)) {
      return reply(action, false, "DUPLICATE", "这次行动已处理。");
    }
    const resident = residents.get(action.target);
    const resource = resources.get(action.target);
    const target =
      resident ??
      resource ??
      [bridge, valley.ruin].find((entry) => entry.id === action.target);
    if (!target)
      return reply(action, false, "UNKNOWN_TARGET", "找不到这个交互对象。");
    if (distance(this.state.player, target) > target.range) {
      return reply(action, false, "TOO_FAR", "再走近一些就能交互。");
    }
    const next = structuredClone(this.state);
    if (resident && action.verb === "inspect")
      return reply(action, true, "INTRO", resident.intro);
    if (resource && action.verb === "collect") {
      const remaining = (next.cooldowns[resource.id] ?? 0) - now;
      if (remaining > 0)
        return reply(
          action,
          false,
          "COOLDOWN",
          `采集点还需 ${Math.ceil(remaining / 1000)} 秒恢复。`,
        );
      if (
        next.inventory[resource.item] + resource.yieldCount >
        inventoryLimit
      ) {
        return reply(action, false, "BAG_FULL", "背包里这一类材料已满。");
      }
      next.inventory[resource.item] += resource.yieldCount;
      next.cooldowns[resource.id] = now + resource.cooldownMs;
      this.commit(next, action.id);
      return reply(
        action,
        true,
        "COLLECTED",
        `获得 ${items[resource.item]} ×${resource.yieldCount}，已放入背包。`,
      );
    }
    if (target.id === bridge.id) return this.bridgeAction(action, next);
    if (target.id === valley.ruin.id && action.verb === "inspect") {
      if (!next.bridge.repaired)
        return reply(action, false, "BRIDGE_CLOSED", "先修好旧桥。");
      if (!next.explored) {
        next.explored = true;
        this.commit(next, action.id);
      }
      return reply(action, true, "RUIN", valley.ruin.clue);
    }
    return reply(action, false, "INVALID_ACTION", "这里无法执行该行动。");
  }

  reset(action: Extract<ClientMessage, { type: "reset" }>): Result {
    if (this.save.hasReceipt(action.id)) {
      return {
        type: "result",
        id: action.id,
        ok: false,
        code: "DUPLICATE",
        text: "这次重开已处理。",
      };
    }
    const state = freshState();
    this.save.write(state, action.id);
    this.state = state;
    this.dirty = false;
    this.halt();
    return {
      type: "result",
      id: action.id,
      ok: true,
      code: "RESET",
      text: "新的旅程开始了。",
    };
  }

  halt() {
    this.intent = { dx: 0, dy: 0, expires: 0 };
    this.working = false;
    this.moving = false;
  }

  flush() {
    if (this.dirty) this.commit(this.state);
  }

  private commit(next: SaveState, receipt?: string) {
    this.save.write(next, receipt);
    this.state = next;
    this.dirty = false;
  }

  private bridgeAction(action: Action, next: SaveState): Result {
    const built = next.bridge;
    const remainingWood = bridge.required.wood - built.wood;
    const remainingStone = bridge.required.stone - built.stone;
    if (action.verb === "inspect") {
      if (!built.discovered) {
        built.discovered = true;
        this.commit(next, action.id);
      }
      return reply(
        action,
        true,
        "BRIDGE",
        built.repaired
          ? "桥面已经整固，可以去东岸了。"
          : `旧桥需要木材 ${bridge.required.wood}、石材 ${bridge.required.stone}。交齐材料后就能施工。`,
      );
    }
    if (built.repaired)
      return reply(action, false, "BRIDGE_DONE", "旧桥已经修好。");
    if (action.verb === "deliver") {
      if (!remainingWood && !remainingStone)
        return reply(
          action,
          false,
          "MATERIALS_READY",
          "材料已交齐，可以施工。",
        );
      if (
        next.inventory.wood < remainingWood ||
        next.inventory.stone < remainingStone
      ) {
        return reply(
          action,
          false,
          "MATERIALS_MISSING",
          `材料不足。还需要木材 ×${remainingWood}、石材 ×${remainingStone}。`,
        );
      }
      next.inventory.wood -= remainingWood;
      next.inventory.stone -= remainingStone;
      built.wood += remainingWood;
      built.stone += remainingStone;
      built.discovered = true;
      this.commit(next, action.id);
      return reply(
        action,
        true,
        "DELIVERED",
        "材料已放到工地。留在桥边开始施工。",
      );
    }
    if (action.verb === "work") {
      if (remainingWood || remainingStone)
        return reply(
          action,
          false,
          "MATERIALS_MISSING",
          "先把木材和石材交到工地。",
        );
      if (this.working)
        return reply(
          action,
          false,
          "ALREADY_WORKING",
          "正在施工，请留在桥边。",
        );
      if (this.moving)
        return reply(action, false, "MOVING", "站稳后再开始施工。");
      this.commit(next, action.id);
      this.halt();
      this.working = true;
      return reply(
        action,
        true,
        "WORK_STARTED",
        "正在铺设桥板。移动会暂停施工，已完成的进度会保留。",
      );
    }
    if (action.verb === "stop") {
      if (!this.working)
        return reply(action, false, "NOT_WORKING", "现在没有进行中的施工。");
      this.commit(next, action.id);
      this.working = false;
      return reply(action, true, "WORK_STOPPED", "已暂停施工，进度已保存。");
    }
    return reply(action, false, "INVALID_ACTION", "这里无法执行该行动。");
  }
}
