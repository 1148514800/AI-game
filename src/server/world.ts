import { randomUUID } from "node:crypto";
import {
  cenyanId,
  destinations,
  goals,
  type ActionReply,
  type CenyanStatus,
  type Decision,
  type Memory,
} from "../shared/cenyan.js";
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
  type Direction,
  type Point,
  type Target,
} from "../shared/world.js";
import type { PublicBridge } from "./dialogue/cenyan.js";
import { canApproach, findPath } from "./path.js";
import { freshState, SaveFile } from "./save.js";

const leaseMs = 420;
const bridge = valley.bridge;
const resident = residents.get(cenyanId)!;
const otherResidents = valley.residents.filter((npc) => npc.id !== cenyanId);
const known = new Map<string, Target>(
  destinations.map((target) => [target.id, target]),
);

function facing(dx: number, dy: number): Direction {
  return Math.abs(dx) >= Math.abs(dy)
    ? dx < 0
      ? "left"
      : "right"
    : dy < 0
      ? "up"
      : "down";
}

export class World {
  private state: SaveState;
  private intent = { dx: 0, dy: 0, expires: 0 };
  private working = false;
  private playerWorkEvent?: string;
  private moving = false;
  private dirty = false;
  private positionSavedAt = 0;
  private actorActivity: CenyanStatus["activity"] = "idle";
  private actorWorking = false;
  private route?: Point[];
  private blockedSince?: number;
  private retryPathAt = 0;
  private displayUntil = 0;
  private recentMemory: Memory[];
  private event: { serial: number; trigger: string; topic?: string } = {
    serial: 0,
    trigger: "first-active",
  };

  constructor(private readonly save: SaveFile) {
    this.state = structuredClone(save.initial);
    this.recentMemory = save.memories();
  }

  get activity() {
    return {
      moving: this.moving || this.actorActivity === "moving",
      working: this.working || this.actorWorking,
    };
  }

  get cenyanActivity() {
    return this.actorActivity;
  }

  get decisionState() {
    return {
      ...this.event,
      generation: this.state.cenyan.generation,
      executing: !!this.state.cenyan.plan,
    };
  }

  private trigger(trigger: string, topic?: string) {
    this.event = { serial: this.event.serial + 1, trigger, topic };
  }

  canTalkToCenyan() {
    return distance(this.state.player, this.state.cenyan) <= resident.range;
  }

  publicBridge(): PublicBridge {
    const value = this.state.bridge;
    return {
      discovered: value.discovered,
      wood: value.wood,
      stone: value.stone,
      woodRequired: bridge.required.wood,
      stoneRequired: bridge.required.stone,
      progressPercent: Math.floor((value.progressMs * 100) / bridge.workMs),
      repaired: value.repaired,
    };
  }

  perceive(topic?: string, now = Date.now()) {
    const { cenyan, player, cooldowns } = this.state;
    const near = (point: Point) => distance(cenyan, point) <= 120;
    return {
      self: {
        id: cenyan.id,
        x: Math.round(cenyan.x),
        y: Math.round(cenyan.y),
        facing: cenyan.facing,
        bag: { ...cenyan.bag },
        goal: cenyan.goal,
        step: cenyan.plan?.steps[cenyan.plan.index],
      },
      people: [
        ...otherResidents,
        { ...player, id: valley.spawn.id, name: valley.spawn.name },
      ]
        .filter(near)
        .map(({ id, name, x, y }) => ({
          id,
          name,
          x: Math.round(x),
          y: Math.round(y),
        })),
      resources: valley.resources.filter(near).map(({ id, item, x, y }) => ({
        id,
        item,
        x,
        y,
        available: (cooldowns[id] ?? 0) <= now,
      })),
      bridge: this.publicBridge(),
      memory: this.save.memories(
        topic ?? (cenyan.goal === "repair-bridge" ? bridge.id : cenyan.goal),
        5,
      ),
    };
  }

  snapshot(now = Date.now(), paused = false): Snapshot {
    return {
      type: "snapshot",
      now,
      state: structuredClone(this.state),
      moving: this.moving,
      working: this.working,
      cenyan: {
        activity: paused ? "paused" : this.actorActivity,
        memory: this.recentMemory,
      },
    };
  }

  accept(
    id: string,
    decision: Decision,
    now = Date.now(),
    claim?: string,
  ): boolean {
    const receipt = `plan:${id}`;
    if (this.state.cenyan.plan || this.save.hasReceipt(receipt)) return false;
    const next = structuredClone(this.state);
    const actor = next.cenyan;
    const changed = actor.goal !== decision.goal;
    actor.goal = decision.goal;
    actor.generation++;
    actor.plan = { id, steps: decision.plan, index: 0 };
    actor.last = { code: "PLAN_ACCEPTED", text: "已接受计划，准备执行。" };
    const records: Memory[] = [];
    if (changed)
      records.push(
        this.memory(
          id,
          decision.goal,
          "改为目标：" + goals[decision.goal],
          now,
        ),
      );
    if (claim) records.push(...this.exchange(id, claim, decision.speech, now));
    this.commit(next, receipt, records);
    this.clearRoute();
    if (changed) this.trigger("goal-changed");
    return true;
  }

  private exchange(
    id: string,
    claim: string,
    speech: string,
    now: number,
  ): Memory[] {
    const entries = [
      this.memory(id, this.topic(claim), claim, now, "claim", "traveler"),
    ];
    if (speech)
      entries.push(
        this.memory(id, this.topic(claim), speech, now, "opinion", "cenyan"),
      );
    return entries;
  }

  rememberExchange(
    id: string,
    claim: string,
    speech: string,
    now = Date.now(),
  ) {
    if (!/桥|材料|屋顶|木|石|遗迹|答应|计划|工坊/.test(claim)) return;
    this.commit(this.state, undefined, this.exchange(id, claim, speech, now));
  }

  topic(text: string) {
    return /桥|施工|渡口/.test(text)
      ? bridge.id
      : /木|屋顶/.test(text)
        ? "stock-wood"
        : /遗迹/.test(text)
          ? valley.ruin.id
          : this.state.cenyan.goal;
  }

  recordActionReply(id: string, claim: string, reply: ActionReply) {
    if (reply.plan) {
      if (this.accept(id, { ...reply, plan: reply.plan }, Date.now(), claim))
        return "accepted";
      this.rememberExchange(id, claim, reply.speech);
      return "deferred";
    }
    this.rememberExchange(id, claim, reply.speech);
    return "rejected";
  }

  setMovement(
    { dx, dy }: Extract<ClientMessage, { type: "move" }>,
    clock: number,
  ) {
    this.intent = { dx, dy, expires: clock + leaseMs };
    if (dx || dy) {
      this.working = false;
      this.playerWorkEvent = undefined;
    }
  }

  tick(clock: number, elapsed: number, now = Date.now(), holdCenyan = false) {
    const stepMs = Math.min(tickMs, Math.max(0, elapsed));
    const { dx, dy } =
      this.intent.expires > clock ? this.intent : { dx: 0, dy: 0 };
    const player = this.state.player;
    this.moving = false;
    if (dx || dy) {
      const step = (speed * stepMs) / 1000 / Math.hypot(dx, dy);
      const clear = (from: Point, to: Point) =>
        isPassable(to.x, to.y, this.state.bridge.repaired) &&
        canApproach(from, to, this.state.cenyan);
      const x = clear(player, { x: player.x + dx * step, y: player.y })
        ? player.x + dx * step
        : player.x;
      const y = clear({ x, y: player.y }, { x, y: player.y + dy * step })
        ? player.y + dy * step
        : player.y;
      const direction = facing(dx, dy);
      this.moving = x !== player.x || y !== player.y;
      if (this.moving || player.facing !== direction) {
        this.state = { ...this.state, player: { x, y, facing: direction } };
        this.dirty = true;
      }
    }
    if (this.working && stepMs > 0) this.advanceWork("player", stepMs, now);
    if (holdCenyan) this.haltCenyan();
    else if (stepMs > 0) this.tickCenyan(clock, stepMs, now);
    if (this.dirty && clock - this.positionSavedAt >= 5000) {
      this.flush();
      this.positionSavedAt = clock;
    }
  }

  private tickCenyan(clock: number, elapsed: number, now: number) {
    if (clock < this.displayUntil) return;
    this.displayUntil = 0;
    const actor = this.state.cenyan;
    const plan = actor.plan;
    const step = plan?.steps[plan.index];
    if (!plan || !step) {
      this.actorActivity = "idle";
      return;
    }
    if (step.type === "wait" || step.type === "rest") {
      this.actorActivity = step.type === "wait" ? "waiting" : "resting";
      const remainingMs = Math.max(
        0,
        (plan.remainingMs ?? step.seconds * 1000) - elapsed,
      );
      if (remainingMs > 0) {
        this.state = {
          ...this.state,
          cenyan: { ...actor, plan: { ...plan, remainingMs } },
        };
        this.dirty = true;
      } else {
        this.finishStep(
          structuredClone(this.state),
          true,
          step.type === "wait" ? "WAITED" : "RESTED",
          step.type === "wait" ? "等待结束。" : "休息结束。",
          actor.goal,
          now,
        );
      }
      return;
    }
    if (step.type === "move_to") {
      this.walkTo(known.get(step.target_id)!, clock, elapsed, now);
      return;
    }
    const target = known.get(step.target_id)!;
    const next = structuredClone(this.state);
    const receipt = `npc:${plan.id}:${plan.index}`;
    if (distance(actor, target) > target.range) {
      this.finishStep(
        next,
        false,
        "TOO_FAR",
        "行动对象超出交互距离。",
        target.id,
        now,
      );
      return;
    }
    if (step.type === "work") {
      const failure = this.checkWork(next, "cenyan");
      if (failure) {
        this.finishStep(
          next,
          false,
          failure.code,
          failure.text,
          target.id,
          now,
        );
        return;
      }
      this.actorWorking = true;
      this.actorActivity = "working";
      this.advanceWork("cenyan", elapsed, now);
      return;
    }
    const result =
      step.type === "collect"
        ? this.collect(next, next.cenyan.bag, step.target_id, now)
        : this.deliver(next, next.cenyan.bag);
    if (result.ok) {
      this.actorActivity =
        step.type === "collect" ? "collecting" : "delivering";
      this.displayUntil = clock + 450;
    }
    this.finishStep(
      next,
      result.ok,
      result.code,
      result.text,
      target.id,
      now,
      result.ok ? receipt : undefined,
    );
  }

  private walkTo(target: Target, clock: number, elapsed: number, now: number) {
    const actor = this.state.cenyan;
    if (distance(actor, target) <= target.range) {
      this.finishStep(
        structuredClone(this.state),
        true,
        "ARRIVED",
        `抵达${target.name}附近。`,
        target.id,
        now,
      );
      return;
    }
    const occupants = [this.state.player, ...otherResidents];
    if (clock < this.retryPathAt) return;
    this.route ??= findPath(
      actor,
      target,
      this.state.bridge.repaired,
      occupants,
    );
    let current: Point = actor;
    let direction = actor.facing;
    let budget = (speed * elapsed) / 1000;
    while (this.route?.length && budget > 0) {
      const point = this.route[0];
      const length = distance(current, point);
      const step = Math.min(length, budget);
      const dx = point.x - current.x;
      const dy = point.y - current.y;
      const next = {
        x: current.x + (dx / length) * step,
        y: current.y + (dy / length) * step,
      };
      if (
        !isPassable(next.x, next.y, this.state.bridge.repaired) ||
        occupants.some((other) => !canApproach(current, next, other))
      ) {
        this.route = undefined;
        break;
      }
      current = next;
      direction = facing(dx, dy);
      budget -= step;
      if (step === length) this.route.shift();
    }
    if (current !== actor) {
      this.state = {
        ...this.state,
        cenyan: { ...actor, ...current, facing: direction },
      };
      this.dirty = true;
      this.actorActivity = "moving";
      this.blockedSince = undefined;
    } else if (
      this.blockedSince !== undefined &&
      clock - this.blockedSince >= 3000
    ) {
      this.finishStep(
        structuredClone(this.state),
        false,
        "NO_PATH",
        `无法走到${target.name}，路线受阻。`,
        target.id,
        now,
      );
    } else {
      this.actorActivity = "waiting";
      this.blockedSince ??= clock;
      this.retryPathAt = clock + 750;
    }
  }

  private clearRoute() {
    this.route = undefined;
    this.blockedSince = undefined;
    this.retryPathAt = 0;
  }

  private memory(
    event: string,
    topic: string,
    content: string,
    at: number,
    kind: Memory["kind"] = "fact",
    source: Memory["source"] = "rules",
  ): Memory {
    return {
      id: randomUUID(),
      actor: cenyanId,
      at,
      kind,
      source,
      event,
      topic,
      content: content.slice(0, 240),
    };
  }

  private finishStep(
    next: SaveState,
    ok: boolean,
    code: string,
    text: string,
    topic: string,
    now: number,
    receipt?: string,
  ) {
    const actor = next.cenyan;
    const plan = actor.plan!;
    const event = `npc:${plan.id}:${plan.index}`;
    actor.last = { code, text };
    actor.plan =
      ok && plan.index + 1 < plan.steps.length
        ? { id: plan.id, steps: plan.steps, index: plan.index + 1 }
        : null;
    const records = [this.memory(event, topic, text, now)];
    if (code === "DELIVERED")
      records.push(
        this.memory(event, bridge.id, "公共告示：旧桥材料已交齐。", now),
      );
    if (code === "BRIDGE_REPAIRED")
      records.push(
        this.memory(event, bridge.id, "公共告示：旧桥已修通。", now),
      );
    this.commit(next, receipt, records);
    this.clearRoute();
    this.actorWorking = false;
    if (!this.displayUntil) this.actorActivity = "idle";
    if (!actor.plan) this.trigger(ok ? "plan-complete" : "step-failed", topic);
  }

  private advanceWork(who: "player" | "cenyan", elapsed: number, now: number) {
    const next = structuredClone(this.state);
    next.bridge.progressMs = Math.min(
      bridge.workMs,
      next.bridge.progressMs + elapsed,
    );
    next.bridge.repaired = next.bridge.progressMs === bridge.workMs;
    if (!next.bridge.repaired) {
      this.commit(next);
      return;
    }
    if (who === "cenyan") {
      const plan = next.cenyan.plan!;
      this.finishStep(
        next,
        true,
        "BRIDGE_REPAIRED",
        "岑砚已完成铺设，旧桥可通行。",
        bridge.id,
        now,
        `npc:${plan.id}:${plan.index}`,
      );
      this.trigger("bridge-repaired", bridge.id);
    } else {
      this.commit(next, undefined, [
        this.memory(
          this.playerWorkEvent ?? randomUUID(),
          bridge.id,
          "公共告示：旧桥已修通。",
          now,
        ),
      ]);
      this.working = false;
      this.playerWorkEvent = undefined;
      this.trigger("bridge-repaired", bridge.id);
    }
  }

  private outcome(ok: boolean, code: string, text: string) {
    return { ok, code, text };
  }

  private collect(
    next: SaveState,
    bag: SaveState["cenyan"]["bag"],
    id: string,
    now: number,
  ) {
    const resource = resources.get(id)!;
    const remaining = (next.cooldowns[id] ?? 0) - now;
    if (remaining > 0)
      return this.outcome(
        false,
        "COOLDOWN",
        `采集点还需 ${Math.ceil(remaining / 1000)} 秒恢复。`,
      );
    if (bag[resource.item] + resource.yieldCount > inventoryLimit)
      return this.outcome(false, "BAG_FULL", "背包里这一类材料已满。");
    bag[resource.item] += resource.yieldCount;
    next.cooldowns[id] = now + resource.cooldownMs;
    return this.outcome(
      true,
      "COLLECTED",
      `从${resource.name}获得 ${items[resource.item]} ×${resource.yieldCount}，已放入背包。`,
    );
  }

  private deliver(next: SaveState, bag: SaveState["cenyan"]["bag"]) {
    if (next.bridge.repaired)
      return this.outcome(false, "BRIDGE_DONE", "旧桥已经修好。");
    const wood = bridge.required.wood - next.bridge.wood;
    const stone = bridge.required.stone - next.bridge.stone;
    if (!wood && !stone)
      return this.outcome(false, "MATERIALS_READY", "材料已交齐，可以施工。");
    if (bag.wood < wood || bag.stone < stone)
      return this.outcome(
        false,
        "MATERIALS_MISSING",
        `材料不足。还需要木材 ×${wood}、石材 ×${stone}。`,
      );
    bag.wood -= wood;
    bag.stone -= stone;
    next.bridge.wood += wood;
    next.bridge.stone += stone;
    next.bridge.discovered = true;
    return this.outcome(
      true,
      "DELIVERED",
      "材料已放到工地。留在桥边开始施工。",
    );
  }

  private checkWork(next: SaveState, who: "player" | "cenyan") {
    if (next.bridge.repaired)
      return this.outcome(false, "BRIDGE_DONE", "旧桥已经修好。");
    if (
      next.bridge.wood !== bridge.required.wood ||
      next.bridge.stone !== bridge.required.stone
    )
      return this.outcome(
        false,
        "MATERIALS_MISSING",
        "先把木材和石材交到工地。",
      );
    if (who === "player" ? this.actorWorking : this.working)
      return this.outcome(false, "WORK_OCCUPIED", "有人正在桥边施工。");
  }

  perform(action: Action, now = Date.now()): Result {
    const reply = (ok: boolean, code: string, text: string): Result => ({
      type: "result",
      id: action.id,
      target: action.target,
      ok,
      code,
      text,
    });
    if (this.save.hasReceipt(action.id))
      return reply(false, "DUPLICATE", "这次行动已处理。");
    const other = residents.get(action.target);
    const resource = resources.get(action.target);
    const target =
      action.target === cenyanId
        ? { ...resident, ...this.state.cenyan }
        : (other ??
          resource ??
          [bridge, valley.ruin].find((entry) => entry.id === action.target));
    if (!target) return reply(false, "UNKNOWN_TARGET", "找不到这个交互对象。");
    if (distance(this.state.player, target) > target.range)
      return reply(false, "TOO_FAR", "再走近一些就能交互。");
    const next = structuredClone(this.state);
    if (other && action.verb === "inspect")
      return reply(true, "INTRO", other.intro);
    if (resource && action.verb === "collect") {
      const result = this.collect(next, next.inventory, resource.id, now);
      if (result.ok) this.commit(next, action.id);
      return reply(result.ok, result.code, result.text);
    }
    if (target.id === bridge.id) {
      if (action.verb === "inspect") {
        if (!next.bridge.discovered) {
          next.bridge.discovered = true;
          this.commit(next, action.id);
        }
        return reply(
          true,
          "BRIDGE",
          next.bridge.repaired
            ? "桥面已经整固，可以去东岸了。"
            : `旧桥需要木材 ${bridge.required.wood}、石材 ${bridge.required.stone}。交齐材料后就能施工。`,
        );
      }
      if (action.verb === "deliver") {
        const result = this.deliver(next, next.inventory);
        if (result.ok) {
          this.commit(next, action.id, [
            this.memory(
              action.id,
              bridge.id,
              "公共告示：旧桥材料已交齐。",
              now,
            ),
          ]);
          this.trigger("bridge-materials", bridge.id);
        }
        return reply(result.ok, result.code, result.text);
      }
      if (next.bridge.repaired)
        return reply(false, "BRIDGE_DONE", "旧桥已经修好。");
      if (action.verb === "work") {
        const failure = this.checkWork(next, "player");
        if (failure) return reply(false, failure.code, failure.text);
        if (this.working)
          return reply(false, "ALREADY_WORKING", "正在施工，请留在桥边。");
        if (this.moving) return reply(false, "MOVING", "站稳后再开始施工。");
        this.commit(next, action.id);
        this.haltPlayer();
        this.working = true;
        this.playerWorkEvent = action.id;
        return reply(
          true,
          "WORK_STARTED",
          "正在铺设桥板。移动会暂停施工，已完成的进度会保留。",
        );
      }
      if (action.verb === "stop") {
        if (!this.working)
          return reply(false, "NOT_WORKING", "现在没有进行中的施工。");
        this.commit(next, action.id);
        this.working = false;
        this.playerWorkEvent = undefined;
        return reply(true, "WORK_STOPPED", "已暂停施工，进度已保存。");
      }
    }
    if (target.id === valley.ruin.id && action.verb === "inspect") {
      if (!next.bridge.repaired)
        return reply(false, "BRIDGE_CLOSED", "先修好旧桥。");
      if (!next.explored) {
        next.explored = true;
        this.commit(next, action.id);
      }
      return reply(true, "RUIN", valley.ruin.clue);
    }
    return reply(false, "INVALID_ACTION", "这里无法执行该行动。");
  }

  reset(action: Extract<ClientMessage, { type: "reset" }>): Result {
    if (this.save.hasReceipt(action.id))
      return {
        type: "result",
        id: action.id,
        ok: false,
        code: "DUPLICATE",
        text: "这次重开已处理。",
      };
    const next = freshState();
    this.save.write(next, action.id, [], true);
    this.state = next;
    this.recentMemory = [];
    this.dirty = false;
    this.halt();
    this.trigger("first-active");
    return {
      type: "result",
      id: action.id,
      ok: true,
      code: "RESET",
      text: "新的旅程开始了。",
    };
  }

  haltPlayer() {
    this.intent = { dx: 0, dy: 0, expires: 0 };
    this.working = false;
    this.playerWorkEvent = undefined;
    this.moving = false;
  }

  halt() {
    this.haltPlayer();
    this.haltCenyan();
  }

  private haltCenyan() {
    this.actorWorking = false;
    this.actorActivity = "idle";
    this.displayUntil = 0;
    this.clearRoute();
  }

  flush() {
    if (this.dirty) this.commit(this.state);
  }

  private commit(next: SaveState, receipt?: string, memories: Memory[] = []) {
    this.save.write(next, receipt, memories);
    this.state = next;
    this.dirty = false;
    if (memories.length)
      this.recentMemory = [
        ...memories.slice().reverse(),
        ...this.recentMemory,
      ].slice(0, 6);
  }
}
