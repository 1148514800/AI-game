import { randomUUID } from "node:crypto";
import {
  cenyanId,
  destinations,
  goalName,
  legacyGoalTag,
  type PlanDecision,
  type GoalTag,
  type GiftDecision,
  type MaterialAmount,
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
  type Material,
  type Point,
  type Target,
} from "../shared/world.js";
import { canApproach, findPath } from "./path.js";
import { freshState, SaveFile } from "./save.js";

const leaseMs = 420;
const followMs = 60_000;
const followGap = 22;
const giftMs = 90_000;
type Contributor = "player" | "cenyan";
const materials = ["wood", "stone"] as const;
const bridge = valley.bridge;
const resident = residents.get(cenyanId)!;
const otherResidents = valley.residents.filter((npc) => npc.id !== cenyanId);
const known = new Map<string, Target>(
  destinations.map((target) => [target.id, target]),
);

function goalTopic(goal: string, tag?: GoalTag) {
  const topic = tag ?? legacyGoalTag(goal) ?? goal;
  return topic === "repair-bridge" ? bridge.id : topic;
}

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
  private routeTarget?: Point;
  private refreshPathAt = 0;
  private displayUntil = 0;
  private recentMemory: Memory[];
  private event: { serial: number; trigger: string; topic?: string } = {
    serial: 0,
    trigger: "first-active",
  };

  constructor(private readonly save: SaveFile) {
    this.state = structuredClone(save.initial);
    this.recentMemory = save.memories();
    // A restarted service cannot resume a delivery of the old model reply.
    if (this.state.gift?.from === "player")
      this.discardPlayerGift(this.state.gift.id);
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

  publicBridge() {
    const value = this.state.bridge;
    return {
      discovered: value.discovered,
      wood: value.wood,
      stone: value.stone,
      woodRequired: bridge.required.wood,
      stoneRequired: bridge.required.stone,
      progressPercent: Math.floor((value.progressMs * 100) / bridge.workMs),
      repaired: value.repaired,
      missing: {
        wood: bridge.required.wood - value.wood,
        stone: bridge.required.stone - value.stone,
      },
      contributions: this.state.contributions,
      sharedWorkMs: this.state.sharedWorkMs,
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
        goalTag: cenyan.goalTag,
        active: cenyan.plan,
        pending: cenyan.pending,
        decision: cenyan.decision,
        recentResults: cenyan.results.length
          ? cenyan.results
          : cenyan.last
            ? [cenyan.last]
            : [],
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
      gift:
        this.state.gift && this.state.gift.expiresAt > now
          ? this.state.gift
          : null,
      memory: this.save.memories(
        topic ?? goalTopic(cenyan.goal, cenyan.goalTag),
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
    if (this.state.cenyan.plan) return false;
    return this.recordActionReply(id, claim, decision, now) === "accepted";
  }

  private activatePlan(
    next: SaveState,
    plan: NonNullable<SaveState["cenyan"]["pending"]>,
    now: number,
    records: Memory[],
  ) {
    const actor = next.cenyan;
    if (actor.goal !== plan.goal)
      records.push(
        this.memory(
          plan.id,
          goalTopic(plan.goal, plan.goalTag),
          "改为目标：" + goalName(plan.goal),
          now,
        ),
      );
    actor.goal = plan.goal;
    if (plan.goalTag) actor.goalTag = plan.goalTag;
    else delete actor.goalTag;
    actor.plan = { id: plan.id, steps: plan.steps, index: 0 };
  }

  private updateResult(
    actor: SaveState["cenyan"],
    result: NonNullable<SaveState["cenyan"]["last"]>,
  ) {
    actor.last = result;
    actor.results = [result, ...actor.results].slice(0, 3);
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
          : goalTopic(this.state.cenyan.goal, this.state.cenyan.goalTag);
  }

  recordActionReply(
    id: string,
    claim: string | undefined,
    reply: ActionReply,
    now = Date.now(),
  ) {
    const receipt = `plan:${id}`;
    if (this.save.hasReceipt(receipt)) return "rejected";
    const next = structuredClone(this.state);
    const actor = next.cenyan;
    const policy = reply.plan_policy ?? (reply.plan ? "replace" : "reject");
    const goalTag = reply.goal_tag ?? legacyGoalTag(reply.goal);
    const records = claim ? this.exchange(id, claim, reply.speech, now) : [];
    let status: PlanDecision["status"] =
      policy === "continue" ? "continued" : "rejected";
    const permittedPlan =
      reply.plan &&
      (claim !== undefined ||
        !reply.plan.some((step) => step.type === "follow"));
    if (
      reply.plan &&
      permittedPlan &&
      (policy === "replace" || policy === "defer")
    ) {
      const proposed = {
        id,
        goal: reply.goal,
        ...(goalTag && { goalTag }),
        steps: reply.plan,
      };
      if (policy === "defer" && actor.plan) {
        if (!actor.pending) {
          actor.pending = proposed;
          actor.generation++;
          status = "deferred";
        }
      } else {
        const previous = actor.plan;
        if (previous)
          this.updateResult(actor, {
            id: `npc:${previous.id}:${previous.index}`,
            type: previous.steps[previous.index].type,
            status: "cancelled",
            code: "PLAN_REPLACED",
            text: "当前行动已被新计划替换，已完成的成果保留。",
          });
        actor.pending = null;
        actor.generation++;
        this.activatePlan(next, proposed, now, records);
        status = "accepted";
      }
    }
    actor.decision = {
      id,
      policy,
      goal: reply.goal,
      speech: reply.speech,
      status,
      ...(goalTag && { goalTag }),
      ...(reply.plan && { steps: reply.plan }),
    };
    this.commit(next, receipt, records);
    if (status === "accepted") {
      this.haltCenyan();
      this.trigger("goal-changed");
    }
    return status;
  }

  proposePlayerGift(id: string, amount: MaterialAmount, now = Date.now()) {
    const receipt = `gift-offer:${id}`;
    if (this.save.hasReceipt(receipt))
      return this.giftResult(id, false, "DUPLICATE", "这次赠送提议已处理。");
    const next = structuredClone(this.state);
    const result = this.offerGift(next, id, "player", amount, now);
    if (result.ok) this.commit(next, receipt, [], result);
    return result;
  }

  discardPlayerGift(id: string) {
    if (this.state.gift?.id !== id || this.state.gift.from !== "player") return;
    const next = structuredClone(this.state);
    next.gift = null;
    const text = "旅人的赠送提议已取消，材料留在原背包。";
    this.updateResult(next.cenyan, {
      id: `gift-cancel:${id}`,
      type: "give_item",
      status: "cancelled",
      code: "GIFT_CANCELLED",
      text,
    });
    this.commit(next, undefined, [
      this.memory(`gift:${id}`, bridge.id, text, Date.now()),
    ]);
  }

  private giftResult(
    id: string,
    ok: boolean,
    code: string,
    text: string,
  ): Result {
    return { type: "result", id, ok, code, text, target: cenyanId };
  }

  private offerGift(
    next: SaveState,
    id: string,
    from: Contributor,
    amount: MaterialAmount,
    now: number,
  ): Result {
    const result = (ok: boolean, code: string, text: string) => ({
      ...this.giftResult(id, ok, code, text),
      offerId: id,
      actor: from,
    });
    if (!this.canTalkToCenyan())
      return result(false, "TOO_FAR", "请走近后再提议赠送。");
    if (next.gift && next.gift.expiresAt > now)
      return result(false, "GIFT_BUSY", "请先处理现有的赠送提议。");
    const source = from === "player" ? next.inventory : next.cenyan.bag;
    if (source[amount.item] < amount.qty)
      return result(
        false,
        "GIFT_NO_STOCK",
        "提议赠送的材料数量超过自己的持有量。",
      );
    next.gift = {
      item: amount.item,
      qty: amount.qty,
      id,
      from,
      expiresAt: now + giftMs,
    };
    return result(
      true,
      "GIFT_OFFERED",
      `已提议赠送${items[amount.item]} ×${amount.qty}，等待对方决定。`,
    );
  }

  resolveGift(
    id: string,
    offerId: string,
    receiver: Contributor,
    choice: "accept" | "reject",
    now = Date.now(),
    modelReply?: Pick<ActionReply, "goal" | "goal_tag" | "speech">,
  ): Result {
    const receipt =
      receiver === "player" ? id : `gift-response:${receiver}:${id}`;
    const previous = this.save.receipt(receipt);
    if (previous) return previous;
    const next = structuredClone(this.state);
    const offer = next.gift;
    const result = <Code extends string>(
      ok: boolean,
      code: Code,
      text: string,
    ) => ({
      ...this.giftResult(id, ok, code, text),
      code,
      offerId,
      actor: offer?.from,
    });
    if (!offer || offer.id !== offerId || offer.from === receiver)
      return result(false, "GIFT_UNKNOWN", "没有可由你处理的赠送提议。");
    if (offer.expiresAt > now && !this.canTalkToCenyan())
      return result(false, "TOO_FAR", "请走近后再处理赠送提议。");
    const { item, qty } = offer;
    const source = offer.from === "player" ? next.inventory : next.cenyan.bag;
    const destination =
      receiver === "player" ? next.inventory : next.cenyan.bag;
    const giverName = offer.from === "player" ? "旅人" : "岑砚";
    const receiverName = receiver === "player" ? "旅人" : "岑砚";
    let outcome: Result & { code: GiftDecision["code"] };
    if (offer.expiresAt <= now)
      outcome = result(false, "GIFT_EXPIRED", "赠送提议已过期。");
    else if (choice === "reject")
      outcome = result(
        true,
        "GIFT_REJECTED",
        `${receiverName}拒绝了${giverName}的赠送，材料留在原背包。`,
      );
    else if (source[item] < qty)
      outcome = result(false, "GIFT_NO_STOCK", "赠送者现在没有足够的材料。");
    else if (destination[item] + qty > inventoryLimit)
      outcome = result(
        false,
        "GIFT_CAPACITY",
        "接收方背包空间不足，材料留在原背包。",
      );
    else {
      source[item] -= qty;
      destination[item] += qty;
      outcome = result(
        true,
        "GIFT_TRANSFERRED",
        `${giverName}赠给${receiverName}${items[item]} ×${qty}。`,
      );
      outcome.materials = {
        wood: item === "wood" ? qty : 0,
        stone: item === "stone" ? qty : 0,
      };
    }
    next.gift = null;
    if (receiver === "cenyan" && modelReply) {
      const goalTag = modelReply.goal_tag ?? legacyGoalTag(modelReply.goal);
      next.cenyan.decision = {
        id,
        goal: modelReply.goal,
        ...(goalTag && { goalTag }),
        speech: modelReply.speech,
        giftResponse: { offer_id: offerId, decision: choice },
        status: outcome.ok ? "resolved" : "failed",
        code: outcome.code,
      };
    }
    this.updateResult(next.cenyan, {
      id: receipt,
      type: "give_item",
      status: outcome.ok ? "ok" : "failed",
      code: outcome.code,
      text: outcome.text,
      change: { ...outcome.materials, actor: offer.from },
    });
    this.commit(
      next,
      receipt,
      [this.memory(`gift:${offer.id}`, bridge.id, outcome.text, now)],
      outcome,
    );
    return outcome;
  }

  private cancelFollow(action: Action, now: number): Result {
    const plan = this.state.cenyan.plan;
    if (plan?.steps[plan.index].type !== "follow")
      return {
        type: "result",
        id: action.id,
        ok: false,
        code: "NOT_FOLLOWING",
        text: "岑砚现在没有在同行。",
      };
    const outcome: Result = {
      type: "result",
      id: action.id,
      ok: true,
      code: "FOLLOW_CANCELLED",
      text: "旅人结束了同行。",
    };
    this.finishStep(
      structuredClone(this.state),
      false,
      outcome.code,
      outcome.text,
      bridge.id,
      now,
      { receipt: action.id, result: outcome },
    );
    return outcome;
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
    if (holdCenyan) this.haltCenyan();
    else if (stepMs > 0) this.tickCenyan(clock, stepMs, now);
    if (stepMs > 0 && (this.working || this.actorWorking))
      this.advanceWork(stepMs, now);
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
    if (step.type === "follow") {
      this.followPlayer(clock, elapsed, now);
      return;
    }
    if (step.type === "give_item") {
      const next = structuredClone(this.state);
      const result = this.offerGift(next, randomUUID(), "cenyan", step, now);
      this.finishStep(
        next,
        result.ok,
        result.code,
        result.text,
        bridge.id,
        now,
      );
      return;
    }
    if (step.type === "move_to") {
      this.walkTo(known.get(step.target_id)!, clock, elapsed, now);
      return;
    }
    const target = known.get(step.target_id)!;
    if (distance(actor, target) > target.range) {
      this.finishStep(
        structuredClone(this.state),
        false,
        "TOO_FAR",
        "行动对象超出交互距离。",
        target.id,
        now,
      );
      return;
    }
    if (step.type === "work") {
      const failure = this.checkWork(this.state);
      if (failure) {
        this.finishStep(
          structuredClone(this.state),
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
      return;
    }
    const next = structuredClone(this.state);
    const result =
      step.type === "collect"
        ? this.collect(next, next.cenyan.bag, step.target_id, now)
        : this.deliver(next, "cenyan", step.item, step.qty);
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
      result.materials
        ? { change: { ...result.materials, actor: "cenyan" } }
        : undefined,
    );
  }

  private followPlayer(clock: number, elapsed: number, now: number) {
    const { player, cenyan: actor } = this.state;
    const plan = actor.plan!;
    const finish = (ok: boolean, code: string, text: string) =>
      this.finishStep(
        structuredClone(this.state),
        ok,
        code,
        text,
        bridge.id,
        now,
      );
    if (plan.remainingMs === undefined && !this.canTalkToCenyan()) {
      finish(false, "TOO_FAR", "开始同行前，请先走近岑砚。");
      return;
    }
    const actorAtBridge = distance(actor, bridge) <= bridge.range;
    const playerAtBridge = distance(player, bridge) <= bridge.range;
    if (actorAtBridge && playerAtBridge && this.canTalkToCenyan()) {
      finish(
        true,
        "FOLLOW_ARRIVED",
        plan.followed ? "岑砚和旅人同行抵达旧桥边。" : "岑砚和旅人已在旧桥边。",
      );
      return;
    }
    const remainingMs = (plan.remainingMs ?? followMs) - elapsed;
    if (remainingMs <= 0) {
      finish(false, "FOLLOW_TIMEOUT", "同行时间已到，岑砚停下了。");
      return;
    }
    const target =
      playerAtBridge &&
      !actorAtBridge &&
      distance(actor, player) <= bridge.range * 2
        ? bridge
        : {
            id: "player",
            name: "旅人",
            x: player.x,
            y: player.y,
            range: followGap,
          };
    const followed = this.walk(target, clock, elapsed, now, true);
    const current = this.state.cenyan;
    if (current.plan?.id === plan.id && current.plan.index === plan.index) {
      this.state = {
        ...this.state,
        cenyan: {
          ...current,
          plan: {
            ...plan,
            remainingMs,
            followed: plan.followed || followed,
          },
        },
      };
      this.dirty = true;
    }
  }

  private walkTo(target: Target, clock: number, elapsed: number, now: number) {
    if (distance(this.state.cenyan, target) <= target.range) {
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
    this.walk(target, clock, elapsed, now);
  }

  private walk(
    target: Target,
    clock: number,
    elapsed: number,
    now: number,
    following = false,
  ) {
    const actor = this.state.cenyan;
    if (distance(actor, target) <= target.range) {
      this.clearRoute();
      this.actorActivity = "waiting";
      return false;
    }
    if (clock < this.retryPathAt) return false;
    if (
      following &&
      clock >= this.refreshPathAt &&
      (!this.routeTarget ||
        distance(this.routeTarget, target) >= 10 ||
        !this.route?.length)
    ) {
      this.route = undefined;
      this.refreshPathAt = clock + 275;
    }
    const occupants = [this.state.player, ...otherResidents];
    if (!this.route) {
      const destination =
        following && target.id === "player" ? { ...target, range: 13 } : target;
      this.route = findPath(
        actor,
        destination,
        this.state.bridge.repaired,
        occupants,
      );
      this.routeTarget = { x: target.x, y: target.y };
    }
    if (following && this.route?.length === 0) {
      this.actorActivity = "waiting";
      return false;
    }
    let current: Point = actor;
    let direction = actor.facing;
    let budget = (speed * elapsed) / 1000;
    while (this.route?.length && budget > 0) {
      const point = this.route[0];
      const length = distance(current, point);
      if (length < 0.001) {
        this.route.shift();
        continue;
      }
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
        this.retryPathAt = clock + (following ? 500 : 750);
        break;
      }
      current = next;
      direction = facing(dx, dy);
      budget -= step;
      if (step === length) this.route.shift();
      if (following && distance(current, target) <= target.range) break;
    }
    if (current !== actor) {
      this.state = {
        ...this.state,
        cenyan: { ...actor, ...current, facing: direction },
      };
      this.dirty = true;
      this.actorActivity = "moving";
      this.blockedSince = undefined;
      return true;
    }
    if (this.blockedSince !== undefined && clock - this.blockedSince >= 3000) {
      this.finishStep(
        structuredClone(this.state),
        false,
        "NO_PATH",
        `无法走到${target.name}，路线受阻。`,
        following ? bridge.id : target.id,
        now,
      );
      return false;
    }
    this.actorActivity = "waiting";
    this.blockedSince ??= clock;
    this.retryPathAt = clock + 750;
    return false;
  }

  private clearRoute() {
    this.route = undefined;
    this.routeTarget = undefined;
    this.blockedSince = undefined;
    this.retryPathAt = 0;
    this.refreshPathAt = 0;
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
    details: {
      receipt?: string;
      change?: NonNullable<SaveState["cenyan"]["last"]>["change"];
      result?: Result;
      memories?: Memory[];
    } = {},
  ) {
    const actor = next.cenyan;
    const plan = actor.plan!;
    const type = plan.steps[plan.index].type;
    const event = `npc:${plan.id}:${plan.index}`;
    this.updateResult(actor, {
      id: event,
      type,
      status: ok ? "ok" : code === "FOLLOW_CANCELLED" ? "cancelled" : "failed",
      code,
      text,
      change: { target: topic, ...details.change },
    });
    const memoryEvent =
      code === "FOLLOW_ARRIVED" && plan.followed
        ? `cooperation:${event}`
        : event;
    const records = [
      this.memory(memoryEvent, topic, text, now),
      ...(details.memories ?? []),
    ];
    actor.generation++;
    if (actor.pending) {
      const pending = actor.pending;
      actor.pending = null;
      this.activatePlan(next, pending, now, records);
    } else {
      actor.plan =
        ok && plan.index + 1 < plan.steps.length
          ? { id: plan.id, steps: plan.steps, index: plan.index + 1 }
          : null;
    }
    this.commit(next, details.receipt ?? event, records, details.result);
    this.clearRoute();
    this.actorWorking = false;
    if (!this.displayUntil) this.actorActivity = "idle";
    if (!actor.plan || !ok)
      this.trigger(ok ? "plan-complete" : "step-failed", topic);
  }

  private advanceWork(elapsed: number, now: number) {
    const next = structuredClone(this.state);
    const player =
      this.working && distance(next.player, bridge) <= bridge.range;
    const cenyan =
      this.actorWorking && distance(next.cenyan, bridge) <= bridge.range;
    if (!player) this.working = false;
    if (!cenyan) this.actorWorking = false;
    const workers = Number(player) + Number(cenyan);
    if (!workers || next.bridge.repaired) return;
    const remaining = bridge.workMs - next.bridge.progressMs;
    const applied = Math.min(remaining, workers * elapsed);
    const share = applied / workers;
    if (player) next.contributions.player.workMs += share;
    if (cenyan) next.contributions.cenyan.workMs += share;
    if (player && cenyan) next.sharedWorkMs += share;
    next.bridge.progressMs += applied;
    next.bridge.repaired = applied === remaining;
    if (!next.bridge.repaired) {
      this.commit(next);
      return;
    }
    next.bridge.progressMs = bridge.workMs;
    const coWork = next.sharedWorkMs > 0;
    const total = next.contributions;
    const text = coWork
      ? `旅人与岑砚合力修通旧桥。实际施工：旅人 ${(total.player.workMs / 1000).toFixed(2)} 秒，岑砚 ${(total.cenyan.workMs / 1000).toFixed(2)} 秒。`
      : "公共告示：旧桥已修通。";
    const records = [
      this.memory(
        coWork
          ? `cooperation:bridge:${this.playerWorkEvent ?? randomUUID()}`
          : (this.playerWorkEvent ?? randomUUID()),
        bridge.id,
        text,
        now,
      ),
    ];
    if (cenyan)
      this.finishStep(
        next,
        true,
        "BRIDGE_REPAIRED",
        "岑砚完成施工，旧桥已修通。",
        bridge.id,
        now,
        {
          change: {
            actor: "cenyan",
            workMs: total.cenyan.workMs,
            sharedWorkMs: next.sharedWorkMs,
          },
          memories: records,
        },
      );
    else this.commit(next, undefined, records);
    this.working = false;
    this.playerWorkEvent = undefined;
    this.trigger("bridge-repaired", bridge.id);
  }

  private outcome(ok: boolean, code: string, text: string) {
    return { ok, code, text };
  }

  private collect(
    next: SaveState,
    bag: SaveState["cenyan"]["bag"],
    id: string,
    now: number,
  ): Pick<Result, "ok" | "code" | "text" | "materials"> {
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
    return {
      ...this.outcome(
        true,
        "COLLECTED",
        `从${resource.name}获得 ${items[resource.item]} ×${resource.yieldCount}，已放入背包。`,
      ),
      materials: {
        wood: resource.item === "wood" ? resource.yieldCount : 0,
        stone: resource.item === "stone" ? resource.yieldCount : 0,
      },
    };
  }

  private deliver(
    next: SaveState,
    who: Contributor,
    item?: Material,
    qty?: number,
  ): Pick<Result, "ok" | "code" | "text" | "materials"> {
    if (next.bridge.repaired)
      return this.outcome(false, "BRIDGE_DONE", "旧桥已经修好。");
    const missing = {
      wood: bridge.required.wood - next.bridge.wood,
      stone: bridge.required.stone - next.bridge.stone,
    };
    if (!missing.wood && !missing.stone)
      return this.outcome(false, "MATERIALS_READY", "材料已交齐，可以施工。");
    const bag = who === "player" ? next.inventory : next.cenyan.bag;
    const delivered = { wood: 0, stone: 0 };
    for (const material of item ? [item] : materials)
      delivered[material] = Math.min(
        missing[material],
        bag[material],
        qty ?? inventoryLimit,
      );
    if (!delivered.wood && !delivered.stone)
      return this.outcome(
        false,
        "MATERIALS_MISSING",
        `材料不足，没有可交付项。工程尚缺木材 ×${missing.wood}、石材 ×${missing.stone}。`,
      );
    for (const material of materials) {
      bag[material] -= delivered[material];
      next.bridge[material] += delivered[material];
      next.contributions[who][material] += delivered[material];
      missing[material] -= delivered[material];
    }
    next.bridge.discovered = true;
    const detail = materials
      .filter((m) => delivered[m])
      .map((m) => `${items[m]} ×${delivered[m]}`)
      .join("、");
    const gap =
      missing.wood || missing.stone
        ? `尚缺木材 ×${missing.wood}、石材 ×${missing.stone}。`
        : "材料已交齐，可以施工。";
    const clipped =
      qty !== undefined && item && delivered[item] < qty
        ? "超出的数量留在背包或未持有。"
        : "";
    return {
      ...this.outcome(
        true,
        "DELIVERED",
        `${who === "player" ? "旅人" : "岑砚"}交付${detail}。${clipped}${gap}`,
      ),
      materials: delivered,
    };
  }

  private checkWork(next: SaveState) {
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
    const previous = this.save.receipt(action.id);
    if (previous) return previous;
    if (this.save.hasReceipt(action.id))
      return reply(false, "DUPLICATE", "这次行动已处理。");
    if (action.target === cenyanId && action.verb === "stop-follow")
      return this.cancelFollow(action, now);
    if (
      action.target === cenyanId &&
      action.verb === "gift-response" &&
      action.offerId &&
      action.choice
    )
      return this.resolveGift(
        action.id,
        action.offerId,
        "player",
        action.choice,
        now,
      );
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
        const result = this.deliver(next, "player", action.item, action.qty);
        const outcome = {
          ...reply(result.ok, result.code, result.text),
          materials: result.materials,
          actor: "player" as const,
        };
        if (result.ok) {
          this.commit(
            next,
            action.id,
            [this.memory(action.id, bridge.id, result.text, now)],
            outcome,
          );
          this.trigger("bridge-materials", bridge.id);
        }
        return outcome;
      }
      if (next.bridge.repaired)
        return reply(false, "BRIDGE_DONE", "旧桥已经修好。");
      if (action.verb === "work") {
        const failure = this.checkWork(next);
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

  standPlayer() {
    this.intent = { dx: 0, dy: 0, expires: 0 };
    this.moving = false;
  }

  haltPlayer() {
    this.standPlayer();
    this.working = false;
    this.playerWorkEvent = undefined;
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

  private commit(
    next: SaveState,
    receipt?: string,
    memories: Memory[] = [],
    result?: Result,
  ) {
    this.save.write(next, receipt, memories, false, result);
    this.state = next;
    this.dirty = false;
    if (memories.length)
      this.recentMemory = [
        ...memories.slice().reverse(),
        ...this.recentMemory,
      ].slice(0, 6);
  }
}
