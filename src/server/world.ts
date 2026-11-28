import {
  contribution,
  deliveryAmounts,
  distributeWork,
  materialText,
  projectMissing,
  transferToProject,
} from "./projects.js";
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
  type ActorStatus,
  type ActorState,
  type Decision,
  type Memory,
  type Step,
} from "../shared/cenyan.js";
import {
  actorName,
  agreementText,
  npcIds,
  npcSchema,
  type ActorId,
  type NpcId,
  type Conversation,
  type SpeechBubble,
  type SocialCommand,
  type PublicEvent,
} from "../shared/social.js";
import type {
  ClientMessage,
  Action,
  Result,
  SaveState,
  Snapshot,
} from "../shared/protocol.js";
import {
  clueTargets,
  localProjects,
  projects,
  gameTime,
  type Item,
  type Stock,
  type Project,
  distance,
  inventoryLimit,
  isPassable,
  items,
  residents,
  resourceNodes,
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
import {
  activeAgreement,
  adjustTrust,
  cancelAgreement,
  fulfillPledge,
  projectPledgeCanFinish,
  socialAction,
} from "./social.js";

const leaseMs = 420;
const followMs = 60_000;
const followGap = 22;
const giftMs = 90_000;
type Contributor = ActorId;
const materials = ["wood", "stone"] as const;

function bridgeMaterialStatus(current: SaveState["bridge"]) {
  const missing = {
    wood: bridge.required.wood - current.wood,
    stone: bridge.required.stone - current.stone,
  };
  return { missing, materialsReady: missing.wood === 0 && missing.stone === 0 };
}
const bridge = valley.bridge;
const talkMs = 35_000;
const pairCooldown = 180_000;
const pairKey = (a: ActorId, b: ActorId) => [a, b].sort().join(":");
const clueShareReceipt = (from: NpcId, to: ActorId, clue: string) =>
  `clue-share:${from}:${to}:${clue}`;
const giftTarget = (gift: NonNullable<SaveState["gift"]>): ActorId =>
  gift.to ?? (gift.from === "player" ? cenyanId : "player");
export type WorldObservation =
  | {
      kind: "action";
      actor: ActorId;
      code: string;
      ok: boolean;
      materials?: Partial<Stock>;
    }
  | { kind: "speech"; actor: NpcId; session: string }
  | { kind: "conversation"; session: string; ok: boolean };

type RunningConversation = Conversation & {
  retryAt?: number;
  expires: number;
  lines: number;
  last?: string;
};
type Runtime = {
  activity: ActorStatus["activity"];
  working: boolean;
  route?: Point[];
  blockedSince?: number;
  retryPathAt: number;
  routeTarget?: Point;
  refreshPathAt: number;
  displayUntil: number;
  recentMemory: Memory[];
  lastChatterAt?: number;
  event: { serial: number; trigger: string; topic?: string };
};

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
  private playerProject = bridge.id;
  private gameRemainder = 0;
  private moving = false;
  private dirty = false;
  private positionSavedAt = 0;
  private readonly runtime: Record<NpcId, Runtime>;
  private readonly conversations = new Map<string, RunningConversation>();
  private bubbles: SpeechBubble[] = [];
  private nextSocialExpiry = 0;
  private playerContact?: NpcId;

  constructor(
    private readonly save: SaveFile,
    private readonly observe?: (event: WorldObservation) => void,
  ) {
    this.state = structuredClone(save.initial);
    const runtime = (id: NpcId): Runtime => ({
      activity: "idle",
      working: false,
      retryPathAt: 0,
      refreshPathAt: 0,
      displayUntil: 0,
      recentMemory: save.memories(undefined, 6, id),
      event: { serial: 0, trigger: "first-active" },
    });
    this.runtime = {
      cenyan: runtime("cenyan"),
      ahe: runtime("ahe"),
      luozhou: runtime("luozhou"),
    };
    if (this.state.gift?.from === "player")
      this.discardPlayerGift(this.state.gift.id);
  }

  get activity() {
    return {
      moving:
        this.moving ||
        npcIds.some((id) => this.runtime[id].activity === "moving"),
      working: this.working || npcIds.some((id) => this.runtime[id].working),
    };
  }

  get cenyanActivity() {
    return this.actorActivity(cenyanId);
  }
  actorActivity(id: NpcId) {
    return this.runtime[id].activity;
  }
  get decisionState() {
    return this.actorDecision(cenyanId);
  }

  actorDecision(id: NpcId) {
    const actor = this.state.actors[id];
    return {
      ...this.runtime[id].event,
      generation: actor.generation,
      executing: !!actor.plan,
    };
  }

  private trigger(
    trigger: string,
    topic?: string,
    ids: readonly NpcId[] = npcIds,
  ) {
    for (const id of ids) {
      const runtime = this.runtime[id];
      runtime.event = { serial: runtime.event.serial + 1, trigger, topic };
    }
  }

  private position(id: ActorId, state = this.state) {
    return id === "player" ? state.player : state.actors[id];
  }

  near(a: ActorId, b: ActorId) {
    if (a === b) return false;
    const range = Math.min(
      residents.get(a)?.range ?? Infinity,
      residents.get(b)?.range ?? Infinity,
    );
    return distance(this.position(a), this.position(b)) <= range;
  }

  canTalkToCenyan() {
    return this.canTalkTo(cenyanId);
  }
  canTalkTo(id: NpcId) {
    return this.near("player", id);
  }

  private bag(state: SaveState, id: ActorId) {
    return id === "player" ? state.inventory : state.actors[id].bag;
  }

  publicBridge(now = Date.now()) {
    const value = this.state.bridge;
    const { missing, materialsReady } = bridgeMaterialStatus(value);
    const committed = { wood: 0, stone: 0 };
    for (const pledge of this.state.pledges) {
      if (
        pledge.condition.kind === "deliver" &&
        (pledge.condition.item === "wood" ||
          pledge.condition.item === "stone") &&
        (pledge.condition.project ?? bridge.id) === bridge.id &&
        pledge.status === "accepted" &&
        pledge.expiresAt > now
      )
        committed[pledge.condition.item] += Math.max(
          0,
          pledge.condition.qty - pledge.progress,
        );
    }
    return {
      discovered: value.discovered,
      wood: value.wood,
      stone: value.stone,
      woodRequired: bridge.required.wood,
      stoneRequired: bridge.required.stone,
      progressPercent: Math.floor((value.progressMs * 100) / bridge.workMs),
      repaired: value.repaired,
      missing,
      materialsReady,
      committed,
      unassigned: {
        wood: Math.max(0, missing.wood - committed.wood),
        stone: Math.max(0, missing.stone - committed.stone),
      },
      contributions: this.state.contributions,
      sharedWorkMs: this.state.sharedWorkMs,
    };
  }

  perceive(
    topic?: string,
    now = Date.now(),
    id: NpcId = cenyanId,
    peer?: ActorId,
  ) {
    const { player, cooldowns } = this.state;
    const cenyan = this.state.actors[id];
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
        interruptedPledge: cenyan.interruptedPledge,
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
        ...npcIds
          .filter((other) => other !== id)
          .map((other) => ({
            x: this.position(other).x,
            y: this.position(other).y,
            name: actorName(other),
            id: other,
          })),
        { ...player, id: valley.spawn.id, name: valley.spawn.name },
      ]
        .filter(near)
        .map(({ id, name, x, y }) => ({
          id,
          name,
          x: Math.round(x),
          y: Math.round(y),
        })),
      resources: resourceNodes.filter(near).map(({ id, item, x, y }) => ({
        id,
        item,
        x,
        y,
        available: (cooldowns[id] ?? 0) <= now,
      })),
      bridge: this.publicBridge(now),
      time: gameTime(this.state.gameSeconds),
      projects: localProjects.map((project) => {
        const row = this.state.projects[project.id];
        return {
          id: project.id,
          name: project.name,
          complete: row.complete,
          received: { wood: row.wood, food: row.food },
          required: project.required,
          missing: projectMissing(project, row),
          space: projectMissing(project, row, project.capacity),
          progressMs: row.progressMs,
          workMs: project.workMs,
        };
      }),
      discoveries: (this.state.discoveries[id] ?? []).map((key) => ({
        id: key,
        text: clueTargets.get(key)!.text,
        shared: (["player", ...npcIds] as const).some(
          (recipient) =>
            recipient !== id &&
            this.save.hasReceipt(clueShareReceipt(id, recipient, key)),
        ),
      })),
      gift:
        this.state.gift &&
        this.state.gift.expiresAt > now &&
        (this.state.gift.from === id || giftTarget(this.state.gift) === id)
          ? this.state.gift
          : null,
      invites: npcIds.filter((other) => this.canInvite(id, other, now)),
      relations: peer ? cenyan.relations[peer] : cenyan.relations,
      social: this.socialInbox(id, now, peer),
      memory: this.save.memories(
        topic ?? goalTopic(cenyan.goal, cenyan.goalTag),
        5,
        id,
      ),
    };
  }

  snapshot(now = Date.now(), paused = false): Snapshot {
    const status = (id: NpcId): ActorStatus => ({
      activity: paused ? "paused" : this.runtime[id].activity,
      memory: this.runtime[id].recentMemory,
    });
    return {
      type: "snapshot",
      now,
      state: structuredClone({
        ...this.state,
        cenyan: this.state.actors.cenyan,
      }),
      moving: this.moving,
      working: this.working,
      ...(this.working && { workTarget: this.playerProject }),
      cenyan: status(cenyanId),
      actors: {
        cenyan: status(cenyanId),
        ahe: status("ahe"),
        luozhou: status("luozhou"),
      },
      bubbles: this.bubbles.filter(
        (line) =>
          line.until > now &&
          distance(this.state.player, this.position(line.actor)) <= 135,
      ),
    };
  }

  accept(
    id: string,
    decision: Decision,
    now = Date.now(),
    claim?: string,
    npc: NpcId = cenyanId,
    autonomous = false,
  ): boolean {
    if (this.state.actors[npc].plan) return false;
    return (
      this.recordActionReply(
        id,
        claim,
        decision,
        now,
        npc,
        undefined,
        autonomous ? "model" : undefined,
      ) === "accepted"
    );
  }

  private activatePlan(
    next: SaveState,
    plan: NonNullable<ActorState["pending"]>,
    now: number,
    records: Memory[],
    npc: NpcId,
  ) {
    const actor = next.actors[npc];
    if (actor.goal !== plan.goal)
      records.push(
        this.memory(
          plan.id,
          goalTopic(plan.goal, plan.goalTag),
          "改为目标：" + goalName(plan.goal),
          now,
          "fact",
          "rules",
          npc,
        ),
      );
    actor.goal = plan.goal;
    if (plan.goalTag) actor.goalTag = plan.goalTag;
    else delete actor.goalTag;
    const { id, steps, authorization, autonomous } = plan;
    actor.plan = {
      id,
      steps,
      index: 0,
      ...(authorization && { authorization }),
      ...(autonomous && { autonomous }),
    };
  }

  private updateResult(
    actor: ActorState,
    result: NonNullable<ActorState["last"]>,
  ) {
    actor.last = result;
    actor.results = [result, ...actor.results].slice(0, 3);
  }

  private exchange(
    id: string,
    claim: string,
    speech: string,
    now: number,
    npc: NpcId,
    peer: ActorId = "player",
  ): Memory[] {
    const entries = [
      this.memory(
        id,
        this.topic(claim, npc),
        claim,
        now,
        "claim",
        peer === "player" ? "traveler" : peer,
        npc,
      ),
    ];
    if (speech)
      entries.push(
        this.memory(
          id,
          this.topic(claim, npc),
          speech,
          now,
          "opinion",
          npc,
          npc,
        ),
      );
    return entries;
  }

  rememberExchange(
    id: string,
    claim: string,
    speech: string,
    now = Date.now(),
    npc: NpcId = cenyanId,
    peer: ActorId = "player",
  ) {
    const runtime = this.runtime[npc];
    if (
      peer === "player" &&
      (!/桥|材料|屋顶|木|石|遗迹|答应|计划|工坊/.test(claim) ||
        (runtime.lastChatterAt !== undefined &&
          now - runtime.lastChatterAt < 2000))
    )
      return;
    this.commit(
      this.state,
      undefined,
      this.exchange(id, claim, speech, now, npc, peer),
    );
    if (peer === "player") runtime.lastChatterAt = now;
  }

  topic(text: string, npc: NpcId = cenyanId) {
    return /桥|施工|渡口/.test(text)
      ? bridge.id
      : /木|屋顶/.test(text)
        ? "stock-wood"
        : /遗迹/.test(text)
          ? valley.ruin.id
          : goalTopic(
              this.state.actors[npc].goal,
              this.state.actors[npc].goalTag,
            );
  }

  recordActionReply(
    id: string,
    claim: string | undefined,
    reply: ActionReply,
    now = Date.now(),
    npc: NpcId = cenyanId,
    peer?: ActorId,
    source?: "model" | "continuation",
    authorization?: string,
  ) {
    const receipt = `plan:${id}`;
    if (this.save.hasReceipt(receipt)) return "rejected";
    const next = structuredClone(this.state);
    const actor = next.actors[npc];
    const policy = reply.plan_policy ?? (reply.plan ? "replace" : "reject");
    const goalTag = reply.goal_tag ?? legacyGoalTag(reply.goal);
    const records = claim
      ? this.exchange(id, claim, reply.speech, now, npc, peer)
      : [];
    let status: PlanDecision["status"] =
      policy === "continue" ? "continued" : "rejected";
    const companion = peer ?? (claim !== undefined ? "player" : undefined);
    const permittedPlan =
      reply.plan &&
      reply.plan.every((step) => {
        if (step.type === "follow")
          return (
            step.target_id === companion &&
            !this.followCycle(npc, step.target_id, next)
          );
        if (step.type === "talk" || step.type === "give_item")
          return step.target_id !== npc;
        return true;
      });
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
        ...(authorization && { authorization }),
        ...(source === "model" && { autonomous: true as const }),
      };
      if (policy === "defer" && actor.plan) {
        if (!actor.pending) {
          actor.pending = proposed;
          actor.generation++;
          status = "deferred";
        }
      } else {
        const previous = actor.plan;
        if (previous?.authorization)
          actor.interruptedPledge = previous.authorization;
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
        this.activatePlan(next, proposed, now, records, npc);
        status = "accepted";
      }
    }
    actor.decision = {
      id,
      policy,
      goal: reply.goal,
      speech: reply.speech,
      status,
      ...(source === "continuation" && { source }),
      ...(goalTag && { goalTag }),
      ...(reply.plan && { steps: reply.plan }),
    };
    this.commit(next, receipt, records);
    if (status === "accepted") {
      this.haltActor(npc);
      if (source === "model" && reply.speech && this.near(npc, "player"))
        this.showSpeech(id, npc, reply.speech, now);
      this.trigger("goal-changed", undefined, [npc]);
    }
    return status;
  }

  proposePlayerGift(
    id: string,
    amount: MaterialAmount,
    now = Date.now(),
    npc: NpcId = cenyanId,
  ) {
    const receipt = `gift-offer:${id}`;
    if (this.save.hasReceipt(receipt))
      return this.giftResult(
        id,
        false,
        "DUPLICATE",
        "这次赠送提议已处理。",
        npc,
      );
    const next = structuredClone(this.state);
    const result = this.offerGift(next, id, "player", npc, amount, now);
    if (result.ok) this.commit(next, receipt, [], result);
    return result;
  }

  discardPlayerGift(id: string) {
    if (this.state.gift?.id !== id || this.state.gift.from !== "player") return;
    const next = structuredClone(this.state);
    const receiver = giftTarget(next.gift!) as NpcId;
    next.gift = null;
    const text = "旅人的赠送提议已取消，材料留在原背包。";
    this.updateResult(next.actors[receiver], {
      id: `gift-cancel:${id}`,
      type: "give_item",
      status: "cancelled",
      code: "GIFT_CANCELLED",
      text,
    });
    this.commit(next, undefined, [
      this.memory(
        `gift:${id}`,
        bridge.id,
        text,
        Date.now(),
        "fact",
        "rules",
        receiver,
      ),
    ]);
  }

  private giftResult(
    id: string,
    ok: boolean,
    code: string,
    text: string,
    target: ActorId | undefined,
  ): Result {
    return { type: "result", id, ok, code, text, target };
  }

  private offerGift(
    next: SaveState,
    id: string,
    from: Contributor,
    to: Contributor,
    amount: MaterialAmount,
    now: number,
  ): Result {
    const result = (ok: boolean, code: string, text: string) => ({
      ...this.giftResult(id, ok, code, text, from === "player" ? to : from),
      offerId: id,
      actor: from,
    });
    if (!this.near(from, to))
      return result(false, "TOO_FAR", "请走近后再提议赠送。");
    if (next.gift && next.gift.expiresAt > now)
      return result(false, "GIFT_BUSY", "请先处理现有的赠送提议。");
    const source = this.bag(next, from);
    if ((source[amount.item] ?? 0) < amount.qty)
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
      ...((from === "player" && to === cenyanId) ||
      (from === cenyanId && to === "player")
        ? {}
        : { to }),
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
      ...this.giftResult(
        id,
        ok,
        code,
        text,
        receiver === "player" ? offer?.from : receiver,
      ),
      code,
      offerId,
      actor: offer?.from,
    });
    if (!offer || offer.id !== offerId || giftTarget(offer) !== receiver)
      return result(false, "GIFT_UNKNOWN", "没有可由你处理的赠送提议。");
    if (offer.expiresAt > now && !this.near(offer.from, receiver))
      return result(false, "TOO_FAR", "请走近后再处理赠送提议。");
    const { item, qty } = offer;
    const source = this.bag(next, offer.from);
    const destination = this.bag(next, receiver);
    const giverName = actorName(offer.from);
    const receiverName = actorName(receiver);
    let outcome: Result & { code: GiftDecision["code"] };
    if (offer.expiresAt <= now)
      outcome = result(false, "GIFT_EXPIRED", "赠送提议已过期。");
    else if (choice === "reject")
      outcome = result(
        true,
        "GIFT_REJECTED",
        `${receiverName}拒绝了${giverName}的赠送，材料留在原背包。`,
      );
    else if ((source[item] ?? 0) < qty)
      outcome = result(false, "GIFT_NO_STOCK", "赠送者现在没有足够的材料。");
    else if ((destination[item] ?? 0) + qty > inventoryLimit)
      outcome = result(
        false,
        "GIFT_CAPACITY",
        "接收方背包空间不足，材料留在原背包。",
      );
    else {
      source[item] = (source[item] ?? 0) - qty;
      destination[item] = (destination[item] ?? 0) + qty;
      outcome = result(
        true,
        "GIFT_TRANSFERRED",
        `${giverName}赠给${receiverName}${items[item]} ×${qty}。`,
      );
      outcome.materials = {
        wood: item === "wood" ? qty : 0,
        stone: item === "stone" ? qty : 0,
        ...(item !== "wood" && item !== "stone" && { [item]: qty }),
      };
    }
    next.gift = null;
    if (receiver !== "player" && modelReply) {
      const goalTag = modelReply.goal_tag ?? legacyGoalTag(modelReply.goal);
      next.actors[receiver].decision = {
        id,
        goal: modelReply.goal,
        ...(goalTag && { goalTag }),
        speech: modelReply.speech,
        giftResponse: { offer_id: offerId, decision: choice },
        status: outcome.ok ? "resolved" : "failed",
        code: outcome.code,
      };
    }
    const records: Memory[] = [];
    for (const actor of [offer.from, receiver]) {
      if (actor === "player") continue;
      this.updateResult(next.actors[actor], {
        id: receipt,
        type: "give_item",
        status: outcome.ok ? "ok" : "failed",
        code: outcome.code,
        text: outcome.text,
        change: { ...outcome.materials, actor: offer.from },
      });
      records.push(
        this.memory(
          `gift:${offer.id}`,
          bridge.id,
          outcome.text,
          now,
          "fact",
          "rules",
          actor,
        ),
      );
    }
    if (outcome.code === "GIFT_TRANSFERRED") {
      adjustTrust(next, receiver, offer.from, 1, "收到材料赠送");
      this.publicEvent(next, receipt, "handoff", outcome.text, now);
    }
    this.commit(next, receipt, records, outcome, `gift-resolution:${offer.id}`);
    return outcome;
  }

  private cancelAction(action: Action, now: number, npc: NpcId): Result {
    const step = this.currentStep(npc);
    const waiting =
      action.verb === "stop-wait" &&
      step?.type === "wait_until" &&
      this.canTalkTo(npc);
    const following =
      action.verb === "stop-follow" &&
      step?.type === "follow" &&
      step.target_id === "player";
    const outcome: Result = {
      type: "result",
      id: action.id,
      target: npc,
      ok: waiting || following,
      code: waiting
        ? "WAIT_CANCELLED"
        : following
          ? "FOLLOW_CANCELLED"
          : action.verb === "stop-follow"
            ? "NOT_FOLLOWING"
            : "NOT_WAITING",
      text: waiting
        ? "已取消条件等待。"
        : following
          ? "旅人结束了同行。"
          : "当前没有可结束的行动。",
    };
    if (outcome.ok)
      this.finishStep(
        structuredClone(this.state),
        false,
        outcome.code,
        outcome.text,
        bridge.id,
        now,
        { receipt: action.id, result: outcome },
        npc,
      );
    return outcome;
  }

  private currentStep(id: NpcId) {
    const plan = this.state.actors[id].plan;
    return plan?.steps[plan.index];
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

  tick(
    clock: number,
    elapsed: number,
    now = Date.now(),
    hold: boolean | NpcId = false,
    allowContinuations = true,
  ) {
    const stepMs = Math.min(tickMs, Math.max(0, elapsed));
    this.gameRemainder += stepMs;
    if (this.gameRemainder >= 1000) {
      this.gameRemainder -= 1000;
      this.state = { ...this.state, gameSeconds: this.state.gameSeconds + 1 };
      this.dirty = true;
    }
    const { dx, dy } =
      this.intent.expires > clock ? this.intent : { dx: 0, dy: 0 };
    const player = this.state.player;
    this.moving = false;
    if (dx || dy) {
      const step = (speed * stepMs) / 1000 / Math.hypot(dx, dy);
      const clear = (from: Point, to: Point) =>
        isPassable(to.x, to.y, this.state.bridge.repaired) &&
        npcIds.every((id) => canApproach(from, to, this.state.actors[id]));
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
    if (this.moving) this.checkPlayerArrival(player, now);
    this.playerContact =
      typeof hold === "string" ? hold : hold ? cenyanId : undefined;
    this.checkConversations(now);
    if (now >= this.nextSocialExpiry) this.expireSocial(now);
    for (const npc of npcIds) {
      if (hold === npc || (hold === true && npc === cenyanId))
        this.haltActor(npc);
      else if (this.conversationFor(npc)) {
        this.runtime[npc].working = false;
        this.runtime[npc].activity = "talking";
      } else if (stepMs > 0)
        this.tickActor(npc, clock, stepMs, now, allowContinuations);
    }
    if (stepMs > 0 && this.activity.working) {
      this.advanceWork(stepMs, now);
      for (const project of localProjects)
        if (project.workMs) this.advanceLocalProject(project, stepMs, now);
    }
    if (this.dirty && clock - this.positionSavedAt >= 5000) {
      this.flush();
      this.positionSavedAt = clock;
    }
  }

  private checkPlayerArrival(before: Point, now: number) {
    const pledge = this.state.pledges.find(
      (entry) =>
        entry.from === "player" &&
        entry.status === "accepted" &&
        entry.expiresAt > now &&
        entry.condition.kind === "arrive",
    );
    if (pledge?.condition.kind !== "arrive") return;
    const target = known.get(pledge.condition.destination)!;
    if (
      distance(before, target) <= target.range ||
      distance(this.state.player, target) > target.range
    )
      return;
    const next = structuredClone(this.state);
    const records: Memory[] = [];
    this.fulfillAction(
      next,
      "player",
      "ARRIVED",
      target.id,
      undefined,
      now,
      records,
    );
    this.commit(next, undefined, records);
  }

  private finishCondition(
    npc: NpcId,
    ok: boolean,
    code: string,
    text: string,
    now: number,
  ) {
    this.finishStep(
      structuredClone(this.state),
      ok,
      code,
      text,
      bridge.id,
      now,
      undefined,
      npc,
    );
  }

  private tickCondition(
    npc: NpcId,
    step: Extract<Step, { type: "wait_until" }>,
    elapsed: number,
    now: number,
  ) {
    const { condition } = step;
    const plan = this.state.actors[npc].plan!;
    let ready = false;
    if (condition.kind === "materials-ready") {
      if (this.state.bridge.repaired)
        return this.finishCondition(
          npc,
          false,
          "WAIT_INVALID",
          "旧桥已经完工。",
          now,
        );
      ready = !this.checkWork(this.state);
    } else if (condition.kind === "arrived") {
      const target = known.get(condition.destination)!;
      ready = distance(this.position(condition.actor), target) <= target.range;
    } else {
      const id =
        condition.offerId ??
        this.state.actors[npc].results.find((result) => result.change?.offerId)
          ?.change?.offerId;
      const receipt = id && this.save.receipt(`gift-resolution:${id}`);
      const deal = this.state.deals.find(
        (entry) => entry.id === id && entry.from === npc,
      );
      const gift = this.state.gift;
      ready = Boolean(
        (receipt &&
          receipt.actor === npc &&
          (receipt.code === "GIFT_TRANSFERRED" ||
            receipt.code === "GIFT_REJECTED")) ||
        deal?.status === "fulfilled" ||
        deal?.cancellation === "declined",
      );
      const pending =
        (gift?.id === id && gift?.from === npc && gift.expiresAt > now) ||
        (deal && activeAgreement(deal) && deal.expiresAt > now);
      if (!ready && !pending)
        return this.finishCondition(
          npc,
          false,
          "WAIT_INVALID",
          "交接提议已失效。",
          now,
        );
    }
    if (ready)
      return this.finishCondition(
        npc,
        true,
        "WAIT_READY",
        "条件已满足，继续后续行动。",
        now,
      );
    const remaining = (plan.remainingMs ?? step.seconds * 1000) - elapsed;
    if (remaining <= 0)
      return this.finishCondition(
        npc,
        false,
        "WAIT_TIMEOUT",
        "等待条件超时。",
        now,
      );
    plan.remainingMs = remaining;
    this.runtime[npc].activity = "waiting";
    this.dirty = true;
  }

  conversationFor(id: NpcId) {
    return [...this.conversations.values()].find(
      (entry) => entry.from === id || entry.to === id,
    );
  }

  canInvite(from: NpcId, to: NpcId, now: number) {
    return (
      from !== to &&
      this.playerContact !== to &&
      !this.conversationFor(from) &&
      !this.conversationFor(to) &&
      (this.state.talkCooldowns[pairKey(from, to)] ?? 0) <= now
    );
  }

  private tickTalk(
    npc: NpcId,
    step: Extract<Step, { type: "talk" }>,
    clock: number,
    elapsed: number,
    now: number,
  ) {
    const peer = step.target_id;
    const remaining =
      (this.state.actors[npc].plan!.remainingMs ?? talkMs) - elapsed;
    if (remaining <= 0)
      return this.finishCondition(
        npc,
        false,
        "TALK_TIMEOUT",
        "邀谈已超时。",
        now,
      );
    if (!this.canInvite(npc, peer, now))
      return this.finishCondition(
        npc,
        false,
        "TALK_UNAVAILABLE",
        "对方暂时不便交谈。",
        now,
      );
    this.state.actors[npc].plan!.remainingMs = remaining;
    this.dirty = true;
    if (!this.near(npc, peer)) {
      const range = Math.min(
        residents.get(npc)!.range,
        residents.get(peer)!.range,
      );
      this.walk(
        npc,
        {
          ...this.position(peer),
          id: peer,
          name: actorName(peer),
          range: range - 2,
        },
        clock,
        elapsed,
        now,
        true,
      );
      return;
    }
    const id = randomUUID();
    const next = structuredClone(this.state);
    next.talkCooldowns[pairKey(npc, peer)] = now + pairCooldown;
    this.commit(next);
    this.conversations.set(id, {
      id,
      from: npc,
      to: peer,
      topic: step.topic,
      expires: now + talkMs,
      lines: 0,
    });
    for (const actor of [npc, peer]) {
      this.haltActor(actor);
      this.runtime[actor].activity = "talking";
    }
  }

  socialTurn(id: string) {
    const turn = this.conversations.get(id);
    if (!turn) return;
    return { ...turn, actor: turn.lines % 2 === 0 ? turn.from : turn.to };
  }

  delaySocialTurn(id: string, until: number) {
    const turn = this.conversations.get(id);
    if (turn) turn.retryAt = until;
  }

  speak(
    id: string,
    actor: NpcId,
    speech: string,
    now = Date.now(),
    keepTalking?: boolean,
  ) {
    const turn = this.socialTurn(id);
    if (
      !turn ||
      turn.actor !== actor ||
      turn.expires <= now ||
      !this.near(turn.from, turn.to) ||
      turn.lines >= 4
    )
      return false;
    const current = this.conversations.get(id)!;
    current.lines++;
    this.observe?.({ kind: "speech", actor, session: id });
    current.last = speech;
    this.showSpeech(`${id}:${current.lines}`, actor, speech, now);
    if (
      current.lines === 4 ||
      keepTalking === false ||
      (keepTalking !== true && current.lines >= 2)
    )
      this.endConversation(id, true, now);
    return true;
  }

  private showSpeech(id: string, actor: NpcId, text: string, now: number) {
    this.bubbles = [
      ...this.bubbles.filter((line) => line.actor !== actor && line.until > now),
      { id, actor, text, until: now + 7000 },
    ];
  }

  endConversation(id: string, ok: boolean, now = Date.now()) {
    const turn = this.conversations.get(id);
    if (!turn) return;
    this.conversations.delete(id);
    this.observe?.({ kind: "conversation", session: id, ok });
    for (const actor of [turn.from, turn.to]) this.haltActor(actor);
    if (this.currentStep(turn.from)?.type === "talk")
      this.finishCondition(
        turn.from,
        ok,
        ok ? "TALK_ENDED" : "TALK_INTERRUPTED",
        ok
          ? `与${actorName(turn.to)}谈过了。`
          : "交流已结束，双方可以继续行动。",
        now,
      );
  }

  interruptConversation(id: NpcId) {
    const current = this.conversationFor(id);
    if (current) this.endConversation(current.id, false);
  }

  private checkConversations(now: number) {
    for (const turn of this.conversations.values())
      if (turn.expires <= now || !this.near(turn.from, turn.to))
        this.endConversation(turn.id, false, now);
  }

  socialInbox(id: ActorId, now = Date.now(), peer?: ActorId) {
    const relevant = (
      entry: SaveState["deals"][number] | SaveState["pledges"][number],
    ) =>
      activeAgreement(entry) &&
      entry.expiresAt > now &&
      (entry.from === id || entry.to === id) &&
      (!peer || entry.from === peer || entry.to === peer);
    return {
      deals: this.state.deals.filter(relevant),
      pledges: this.state.pledges.filter(relevant),
    };
  }

  applySocial(
    id: string,
    actor: ActorId,
    command: SocialCommand,
    now = Date.now(),
  ): Result {
    const receipt = `social:${id}`;
    const previous = this.save.receipt(receipt);
    if (previous) return previous;
    const next = structuredClone(this.state);
    const { result, effect } = socialAction(
      next,
      id,
      actor,
      command,
      now,
      (a, b) => this.near(a, b),
    );
    if (effect?.handoff)
      this.publicEvent(next, receipt, "handoff", result.text, now);
    const records = effect?.people
      .filter((who): who is NpcId => who !== "player")
      .map((who) =>
        this.memory(
          receipt,
          bridge.id,
          result.text,
          now,
          result.code === "PLEDGE_PROPOSED" || result.code === "PLEDGE_ACCEPTED"
            ? "commitment"
            : "fact",
          "rules",
          who,
        ),
      );
    this.commit(next, receipt, records, result);
    this.observe?.({ kind: "action", actor, code: result.code, ok: result.ok });
    if (effect && (command.kind === "offer" || command.kind === "pledge"))
      this.trigger(
        "social-invitation",
        bridge.id,
        effect.people.filter(
          (id): id is NpcId => id !== "player" && id !== actor,
        ),
      );
    if (result.code === "HANDOFF_DONE" || result.code === "PLEDGE_ACCEPTED")
      this.trigger(
        "commitment",
        bridge.id,
        effect?.people.filter((id): id is NpcId => id !== "player"),
      );
    return result;
  }

  private expireSocial(now: number) {
    this.nextSocialExpiry = now + 1000;
    const impossible = (
      state: SaveState,
      entry: SaveState["deals"][number] | SaveState["pledges"][number],
    ) =>
      "condition" in entry &&
      !projectPledgeCanFinish(state, entry.condition, entry.progress);
    const expired = [...this.state.deals, ...this.state.pledges].some(
      (entry) =>
        activeAgreement(entry) &&
        (entry.expiresAt <= now || impossible(this.state, entry)),
    );
    const gift = this.state.gift;
    if (gift && gift.expiresAt <= now)
      this.resolveGift(randomUUID(), gift.id, giftTarget(gift), "reject", now);
    if (!expired) return;
    const next = structuredClone(this.state);
    const records: Memory[] = [];
    for (const entry of [...next.deals, ...next.pledges]) {
      const noFault = impossible(next, entry);
      if (!activeAgreement(entry) || (entry.expiresAt > now && !noFault))
        continue;
      const effect = cancelAgreement(next, entry, !noFault, noFault);
      for (const id of effect.people)
        if (id !== "player")
          records.push(
            this.memory(
              entry.id,
              bridge.id,
              effect.text,
              now,
              "fact",
              "rules",
              id,
            ),
          );
    }
    this.commit(next, undefined, records);
  }

  private publicEvent(
    next: SaveState,
    id: string,
    kind: PublicEvent["kind"],
    text: string,
    at: number,
  ) {
    next.events = [{ id, kind, text, at }, ...next.events].slice(0, 12);
  }

  private fulfillAction(
    next: SaveState,
    from: ActorId,
    code: string,
    target: string,
    materials: Partial<Stock> | undefined,
    now: number,
    records: Memory[],
  ) {
    for (const pledge of next.pledges) {
      if (
        pledge.from !== from ||
        pledge.status !== "accepted" ||
        pledge.expiresAt <= now
      )
        continue;
      const { condition } = pledge;
      const arrived =
        (code === "ARRIVED" || code === "FOLLOW_ARRIVED") &&
        condition.kind === "arrive" &&
        condition.destination === target;
      const worked =
        (code === "BRIDGE_REPAIRED" || code === "PROJECT_COMPLETED") &&
        condition.kind === "work" &&
        (condition.project ?? bridge.id) === target &&
        pledge.progress > 0;
      if (
        code === "DELIVERED" &&
        condition.kind === "deliver" &&
        (condition.project ?? bridge.id) === target
      )
        pledge.progress = Math.min(
          condition.qty,
          pledge.progress + (materials?.[condition.item] ?? 0),
        );
      if (
        !arrived &&
        !worked &&
        !(condition.kind === "deliver" && pledge.progress >= condition.qty)
      )
        continue;
      fulfillPledge(next, pledge);
      for (const id of [pledge.from, pledge.to])
        if (id !== "player")
          records.push(
            this.memory(
              pledge.id,
              bridge.id,
              `${actorName(from)}履行约定：${agreementText(pledge)}。`,
              now,
              "fact",
              "rules",
              id,
            ),
          );
    }
  }

  private tickActor(
    npc: NpcId,
    clock: number,
    elapsed: number,
    now: number,
    allowContinuations: boolean,
  ) {
    const runtime = this.runtime[npc];
    if (clock < runtime.displayUntil) return;
    runtime.displayUntil = 0;
    const actor = this.state.actors[npc];
    const plan = actor.plan;
    const step = plan?.steps[plan.index];
    if (!plan || !step) {
      runtime.activity = "idle";
      return;
    }
    if (plan.authorization) {
      const pledge = this.state.pledges.find(
        (entry) => entry.id === plan.authorization,
      );
      if (
        !allowContinuations ||
        pledge?.from !== npc ||
        pledge.status !== "accepted" ||
        pledge.expiresAt <= now ||
        (step.type === "deliver" &&
          pledge.condition.kind === "deliver" &&
          (step.qty ?? Infinity) > pledge.condition.qty - pledge.progress)
      ) {
        this.finishCondition(
          npc,
          false,
          "AUTHORIZATION_CANCELLED",
          "贡献约定已失效，停止后续行动。",
          now,
        );
        return;
      }
    }
    if (step.type === "wait" || step.type === "rest") {
      runtime.activity = step.type === "wait" ? "waiting" : "resting";
      const remainingMs = Math.max(
        0,
        (plan.remainingMs ?? step.seconds * 1000) - elapsed,
      );
      if (remainingMs > 0) {
        this.state = {
          ...this.state,
          actors: {
            ...this.state.actors,
            [npc]: { ...actor, plan: { ...plan, remainingMs } },
          },
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
          undefined,
          npc,
        );
      }
      return;
    }
    if (step.type === "wait_until") {
      this.tickCondition(npc, step, elapsed, now);
      return;
    }
    if (step.type === "share_clue") {
      const known = this.state.discoveries[npc]?.includes(step.clue_id);
      const receipt = clueShareReceipt(npc, step.target_id, step.clue_id);
      if (known && this.save.hasReceipt(receipt)) {
        this.finishStep(
          structuredClone(this.state),
          true,
          "CLUE_ALREADY_SHARED",
          `已经向${actorName(step.target_id)}分享过这条线索。`,
          step.clue_id,
          now,
          undefined,
          npc,
        );
        return;
      }
      if (
        plan.autonomous &&
        known &&
        step.target_id !== npc &&
        !this.near(npc, step.target_id) &&
        (plan.remainingMs ?? talkMs) > elapsed
      ) {
        plan.remainingMs = (plan.remainingMs ?? talkMs) - elapsed;
        const range = Math.min(
          residents.get(npc)!.range,
          residents.get(step.target_id)?.range ?? Infinity,
        );
        this.walk(
          npc,
          {
            ...this.position(step.target_id),
            id: step.target_id,
            name: actorName(step.target_id),
            range: range - 2,
          },
          clock,
          elapsed,
          now,
          true,
        );
        return;
      }
      const next = structuredClone(this.state);
      const shared =
        this.near(npc, step.target_id) && step.target_id !== npc && known;
      const clue = clueTargets.get(step.clue_id)!;
      const text = shared
        ? `${actorName(npc)}分享${clue.name}的发现。${clue.text}`
        : "只能向附近的其他角色分享亲自发现的线索。";
      const event = `clue:${plan.id}:${plan.index}`;
      const records =
        shared && step.target_id !== "player"
          ? [
              this.memory(
                event,
                clue.id,
                text,
                now,
                "fact",
                npc,
                step.target_id,
              ),
            ]
          : [];
      if (shared && step.target_id === "player")
        this.publicEvent(next, event, "cooperation", text, now);
      this.finishStep(
        next,
        !!shared,
        shared ? "CLUE_SHARED" : "CLUE_UNAVAILABLE",
        text,
        clue.id,
        now,
        { memories: records, ...(shared && { receipt }) },
        npc,
      );
      return;
    }
    if (step.type === "talk") {
      this.tickTalk(npc, step, clock, elapsed, now);
      return;
    }
    if (step.type === "social") {
      const result = this.applySocial(
        `npc-social:${plan.id}:${plan.index}`,
        npc,
        step.command,
        now,
      );
      this.finishStep(
        structuredClone(this.state),
        result.ok,
        result.code,
        result.text,
        bridge.id,
        now,
        { change: { offerId: result.offerId } },
        npc,
      );
      return;
    }
    if (step.type === "follow") {
      this.followActor(npc, step, clock, elapsed, now);
      return;
    }
    if (step.type === "give_item") {
      const next = structuredClone(this.state);
      if (step.target_id !== "player") {
        const result = this.applySocial(
          `npc-social:${plan.id}:${plan.index}`,
          npc,
          {
            kind: "offer",
            target: step.target_id,
            terms: { kind: "gift", give: { item: step.item, qty: step.qty } },
          },
          now,
        );
        this.finishStep(
          structuredClone(this.state),
          result.ok,
          result.code,
          result.text,
          bridge.id,
          now,
          { change: { offerId: result.offerId } },
          npc,
        );
        return;
      }
      const result = this.offerGift(
        next,
        randomUUID(),
        npc,
        step.target_id,
        step,
        now,
      );
      this.finishStep(
        next,
        result.ok,
        result.code,
        result.text,
        bridge.id,
        now,
        { change: { offerId: result.offerId } },
        npc,
      );
      return;
    }
    if (step.type === "move_to") {
      this.walkTo(npc, known.get(step.target_id)!, clock, elapsed, now);
      return;
    }
    const target = known.get(step.target_id)!;
    if (distance(actor, target) > target.range) {
      if (
        plan.autonomous &&
        (step.type === "deliver" ||
          step.type === "work" ||
          step.type === "explore")
      ) {
        this.walk(npc, target, clock, elapsed, now);
        return;
      }
      this.finishStep(
        structuredClone(this.state),
        false,
        "TOO_FAR",
        "行动对象超出交互距离。",
        target.id,
        now,
        undefined,
        npc,
      );
      return;
    }
    if (step.type === "explore") {
      this.finishExploration(npc, target.id, now);
      return;
    }
    const project = projects.get(target.id);
    if (step.type === "work") {
      const failure = this.checkWork(this.state, project);
      if (failure) {
        this.finishStep(
          structuredClone(this.state),
          false,
          failure.code,
          failure.text,
          target.id,
          now,
          undefined,
          npc,
        );
        return;
      }
      runtime.working = true;
      runtime.activity = "working";
      return;
    }
    const next = structuredClone(this.state);
    let result =
      step.type === "collect"
        ? this.collect(next, next.actors[npc].bag, step.target_id, now)
        : this.deliver(next, npc, step.item, step.qty, project);
    const following = plan.steps[plan.index + 1];
    if (
      step.type === "deliver" &&
      !result.ok &&
      following?.type === "work" &&
      following.target_id === step.target_id &&
      !this.checkWork(next, project)
    )
      result = {
        ok: true,
        code: "MATERIALS_READY",
        text: "工程材料已经齐备，继续已选择的施工。",
      };
    if (result.ok) {
      runtime.activity = step.type === "collect" ? "collecting" : "delivering";
      runtime.displayUntil = clock + 450;
    }
    this.finishStep(
      next,
      result.ok,
      result.code,
      result.text,
      target.id,
      now,
      result.materials
        ? { change: { ...result.materials, actor: npc } }
        : undefined,
      npc,
    );
  }

  private followCycle(npc: NpcId, target: ActorId, state = this.state) {
    const seen = new Set<ActorId>([npc]);
    while (target !== "player") {
      if (seen.has(target)) return true;
      seen.add(target);
      const plan = state.actors[target].plan;
      const step = plan?.steps[plan.index];
      if (step?.type !== "follow") break;
      target = step.target_id;
    }
    return false;
  }

  private followActor(
    npc: NpcId,
    step: Extract<Step, { type: "follow" }>,
    clock: number,
    elapsed: number,
    now: number,
  ) {
    const actor = this.state.actors[npc];
    const plan = actor.plan!;
    const peer = step.target_id;
    const leader = this.position(peer);
    const destination = known.get(step.destination_id ?? bridge.id)!;
    if (plan.solo) {
      this.walkTo(npc, destination, clock, elapsed, now);
      return;
    }
    const finish = (ok: boolean, code: string, text: string) =>
      this.finishStep(
        structuredClone(this.state),
        ok,
        code,
        text,
        destination.id,
        now,
        { change: { traveled: plan.followed } },
        npc,
      );
    if (this.followCycle(npc, peer)) {
      finish(false, "FOLLOW_CYCLE", "无法相互跟随。");
      return;
    }
    if (plan.remainingMs === undefined && !this.near(npc, peer)) {
      finish(false, "TOO_FAR", "开始同行前，双方需要在交谈范围。");
      return;
    }
    const atDestination = distance(actor, destination) <= destination.range;
    const leaderThere = distance(leader, destination) <= destination.range;
    if (atDestination && leaderThere && this.near(npc, peer)) {
      finish(
        true,
        "FOLLOW_ARRIVED",
        `${actorName(npc)}和${actorName(peer)}${plan.followed ? "同行抵达" : "已在"}${
          destination.id === valley.bridge.id ? "旧桥" : destination.name
        }边。`,
      );
      return;
    }
    // A resident can pursue their chosen destination when the other resident
    // has no matching journey. Only paired arrivals count as cooperation.
    const leaderPlan = peer === "player" ? null : this.state.actors[peer].plan;
    const leaderWillGo = leaderPlan?.steps.slice(leaderPlan.index).some(
      (action) =>
        (action.type === "move_to" || action.type === "explore") &&
        action.target_id === destination.id,
    );
    if (
      plan.autonomous &&
      peer !== "player" &&
      step.destination_id &&
      !leaderThere &&
      !leaderWillGo
    ) {
      plan.solo = true;
      this.dirty = true;
      this.walkTo(npc, destination, clock, elapsed, now);
      return;
    }
    const remainingMs = (plan.remainingMs ?? followMs) - elapsed;
    if (remainingMs <= 0) {
      finish(false, "FOLLOW_TIMEOUT", "同行时间已到。");
      return;
    }
    const target =
      leaderThere &&
      !atDestination &&
      distance(actor, leader) <= destination.range * 2
        ? destination
        : {
            id: peer,
            name: actorName(peer),
            x: leader.x,
            y: leader.y,
            range: followGap,
          };
    const followed = this.walk(npc, target, clock, elapsed, now, true);
    const current = this.state.actors[npc];
    if (current.plan?.id === plan.id && current.plan.index === plan.index) {
      current.plan = {
        ...plan,
        remainingMs,
        followed: plan.followed || followed,
      };
      this.dirty = true;
    }
  }

  private walkTo(
    npc: NpcId,
    target: Target,
    clock: number,
    elapsed: number,
    now: number,
  ) {
    if (distance(this.state.actors[npc], target) <= target.range) {
      const plan = this.state.actors[npc].plan!;
      const nextStep = plan.steps[plan.index + 1];
      if (
        plan.autonomous &&
        this.state.bridge.repaired &&
        clueTargets.has(target.id) &&
        !this.state.discoveries[npc]?.includes(target.id) &&
        !(nextStep?.type === "explore" && nextStep.target_id === target.id)
      ) {
        this.finishExploration(npc, target.id, now);
        return;
      }
      this.finishStep(
        structuredClone(this.state),
        true,
        "ARRIVED",
        `抵达${target.name}附近。`,
        target.id,
        now,
        { change: { traveled: this.state.actors[npc].plan?.traveled } },
        npc,
      );
      return;
    }
    this.walk(npc, target, clock, elapsed, now);
  }

  private walk(
    npc: NpcId,
    target: Target,
    clock: number,
    elapsed: number,
    now: number,
    following = false,
  ) {
    const runtime = this.runtime[npc];
    const actor = this.state.actors[npc];
    if (distance(actor, target) <= target.range) {
      this.clearRoute(npc);
      runtime.activity = "waiting";
      return false;
    }
    if (clock < runtime.retryPathAt) return false;
    if (
      following &&
      clock >= runtime.refreshPathAt &&
      (!runtime.routeTarget ||
        distance(runtime.routeTarget, target) >= 10 ||
        !runtime.route?.length)
    ) {
      runtime.route = undefined;
      runtime.refreshPathAt = clock + 275;
    }
    const occupants = [
      this.state.player,
      ...npcIds.filter((id) => id !== npc).map((id) => this.position(id)),
    ];
    if (!runtime.route) {
      const destination =
        following &&
        (target.id === "player" || npcSchema.safeParse(target.id).success)
          ? { ...target, range: 13 }
          : target;
      runtime.route = findPath(
        actor,
        destination,
        this.state.bridge.repaired,
        occupants,
      );
      runtime.routeTarget = { x: target.x, y: target.y };
    }
    if (following && runtime.route?.length === 0) {
      runtime.activity = "waiting";
      return false;
    }
    let current: Point = actor;
    let direction = actor.facing;
    let budget = (speed * elapsed) / 1000;
    while (runtime.route?.length && budget > 0) {
      const point = runtime.route[0];
      const length = distance(current, point);
      if (length < 0.001) {
        runtime.route.shift();
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
        runtime.route = undefined;
        runtime.retryPathAt = clock + (following ? 500 : 750);
        break;
      }
      current = next;
      direction = facing(dx, dy);
      budget -= step;
      if (step === length) runtime.route.shift();
      if (following && distance(current, target) <= target.range) break;
    }
    if (current !== actor) {
      this.state = {
        ...this.state,
        actors: {
          ...this.state.actors,
          [npc]: {
            ...actor,
            ...current,
            facing: direction,
            plan: actor.plan && { ...actor.plan, traveled: true },
          },
        },
      };
      this.dirty = true;
      runtime.activity = "moving";
      runtime.blockedSince = undefined;
      return true;
    }
    if (
      runtime.blockedSince !== undefined &&
      clock - runtime.blockedSince >= 3000
    ) {
      this.finishStep(
        structuredClone(this.state),
        false,
        "NO_PATH",
        `无法走到${target.name}，路线受阻。`,
        following ? bridge.id : target.id,
        now,
        undefined,
        npc,
      );
      return false;
    }
    runtime.activity = "waiting";
    runtime.blockedSince ??= clock;
    runtime.retryPathAt = clock + 750;
    return false;
  }

  private clearRoute(npc: NpcId) {
    const runtime = this.runtime[npc];
    runtime.route = undefined;
    runtime.routeTarget = undefined;
    runtime.blockedSince = undefined;
    runtime.retryPathAt = 0;
    runtime.refreshPathAt = 0;
  }

  private memory(
    event: string,
    topic: string,
    content: string,
    at: number,
    kind: Memory["kind"] = "fact",
    source: Memory["source"] = "rules",
    npc: NpcId = cenyanId,
  ): Memory {
    return {
      id: randomUUID(),
      actor: npc,
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
      change?: NonNullable<ActorState["last"]>["change"];
      result?: Result;
      memories?: Memory[];
    } = {},
    npc: NpcId = cenyanId,
  ) {
    const { event, records } = this.prepareStep(
      next,
      npc,
      ok,
      code,
      text,
      topic,
      now,
      details,
    );
    this.commit(next, details.receipt ?? event, records, details.result);
    this.afterStep(npc, ok, code, topic);
  }

  private prepareStep(
    next: SaveState,
    npc: NpcId,
    ok: boolean,
    code: string,
    text: string,
    topic: string,
    now: number,
    details: {
      change?: NonNullable<ActorState["last"]>["change"];
      memories?: Memory[];
    } = {},
  ) {
    const actor = next.actors[npc];
    const plan = actor.plan!;
    const type = plan.steps[plan.index].type;
    const event = `npc:${plan.id}:${plan.index}`;
    this.updateResult(actor, {
      id: event,
      type,
      status: ok ? "ok" : code.endsWith("_CANCELLED") ? "cancelled" : "failed",
      code,
      text,
      change: { target: topic, ...details.change },
    });
    const memoryEvent =
      code === "FOLLOW_ARRIVED" && plan.followed
        ? `cooperation:${event}`
        : event;
    const records = [
      this.memory(memoryEvent, topic, text, now, "fact", "rules", npc),
      ...(details.memories ?? []),
    ];
    actor.generation++;
    if (actor.pending) {
      if (plan.authorization) actor.interruptedPledge = plan.authorization;
      const pending = actor.pending;
      actor.pending = null;
      this.activatePlan(next, pending, now, records, npc);
    } else {
      actor.plan =
        ok && plan.index + 1 < plan.steps.length
          ? {
              id: plan.id,
              steps: plan.steps,
              index: plan.index + 1,
              ...(plan.authorization && { authorization: plan.authorization }),
              ...(plan.autonomous && { autonomous: plan.autonomous }),
            }
          : null;
    }
    if (ok) {
      if (
        code === "DELIVERED" &&
        topic === "valley-camp" &&
        next.projects[topic].complete &&
        !this.state.projects[topic].complete
      ) {
        const project = projects.get(topic)!;
        for (const id of npcIds.filter(
          (id) => id === "ahe" || next.projects[topic].contributions[id],
        ))
          records.push(
            this.memory(event, topic, project.done, now, "fact", "rules", id),
          );
      }
      this.fulfillAction(
        next,
        npc,
        details.change?.traveled ||
          (code !== "ARRIVED" && code !== "FOLLOW_ARRIVED")
          ? code
          : "",
        topic,
        details.change,
        now,
        records,
      );
      if (code === "DELIVERED" || code === "DISCOVERED")
        this.publicEvent(next, event, "project", text, now);
    }
    return { event, records };
  }

  private afterStep(npc: NpcId, ok: boolean, code: string, topic: string) {
    const runtime = this.runtime[npc];
    const change = this.state.actors[npc].last?.change;
    this.observe?.({
      kind: "action",
      actor: npc,
      code,
      ok,
      materials: change && {
        wood: change.wood,
        stone: change.stone,
        food: change.food,
        toolbox: change.toolbox,
      },
    });
    this.clearRoute(npc);
    runtime.working = false;
    if (!runtime.displayUntil) runtime.activity = "idle";
    if (!this.state.actors[npc].plan || !ok)
      this.trigger(
        ok
          ? "plan-complete"
          : code === "COOLDOWN"
            ? "step-retry"
            : "step-failed",
        topic,
        [npc],
      );
    if (ok && code === "DELIVERED" && topic === bridge.id)
      this.trigger(
        "bridge-materials",
        bridge.id,
        npcIds.filter((id) => id !== npc),
      );
  }

  private advanceWork(elapsed: number, now: number) {
    const next = structuredClone(this.state);
    const workers: ActorId[] = [];
    if (
      this.working &&
      this.playerProject === bridge.id &&
      distance(next.player, bridge) <= bridge.range
    )
      workers.push("player");
    for (const id of npcIds) {
      if (
        this.runtime[id].working &&
        this.currentStep(id)?.type === "work" &&
        this.workTarget(id) === bridge.id &&
        distance(next.actors[id], bridge) <= bridge.range
      )
        workers.push(id);
    }
    if (!workers.length || next.bridge.repaired) return;
    const remaining = bridge.workMs - next.bridge.progressMs;
    const { applied, shares } = distributeWork(
      remaining,
      elapsed,
      workers.map((id) => ({
        id,
        toolbox: this.bag(next, id).toolbox,
      })),
    );
    for (const [id, share] of shares) next.contributions[id].workMs += share;
    for (const pledge of next.pledges)
      if (
        pledge.condition.kind === "work" &&
        (pledge.condition.project ?? bridge.id) === bridge.id &&
        pledge.status === "accepted" &&
        pledge.expiresAt > now &&
        workers.includes(pledge.from)
      )
        pledge.progress = 1;
    if (workers.length > 1) {
      next.sharedWorkMs += Math.min(
        ...shares.map(([, share]) => share),
        elapsed,
      );
      for (let index = 0; index < workers.length; index++)
        for (const other of workers.slice(index + 1)) {
          const pair = pairKey(workers[index], other);
          if (!next.workPairs.includes(pair)) next.workPairs.push(pair);
        }
    }
    next.bridge.progressMs += applied;
    next.bridge.repaired = applied === remaining;
    if (!next.bridge.repaired) {
      this.commit(next);
      return;
    }

    next.bridge.progressMs = bridge.workMs;
    const contributors = (["player", ...npcIds] as const).filter(
      (id) => next.contributions[id].workMs > 0,
    );
    const coWork = next.workPairs.length > 0;
    const text = coWork
      ? `${contributors.map(actorName).join(contributors.length === 2 ? "与" : "、")}合力修通旧桥。实际施工：${contributors
          .map(
            (id) =>
              `${actorName(id)} ${(next.contributions[id].workMs / 1000).toFixed(2)} 秒`,
          )
          .join("，")}。`
      : "公共告示：旧桥已修通。";
    const event = `${coWork ? "cooperation:" : ""}bridge:${this.playerWorkEvent ?? randomUUID()}`;
    const records = npcIds
      .filter(
        (id) =>
          contributors.includes(id) ||
          distance(this.position(id), bridge) <= 120,
      )
      .map((id) =>
        this.memory(event, bridge.id, text, now, "fact", "rules", id),
      );
    for (const pair of next.workPairs) {
      const [a, b] = pair.split(":") as [ActorId, ActorId];
      adjustTrust(next, a, b, 1, "共同施工并修通旧桥");
      adjustTrust(next, b, a, 1, "共同施工并修通旧桥");
    }
    this.publicEvent(
      next,
      event,
      coWork ? "cooperation" : "project",
      text,
      now,
    );
    for (const id of contributors)
      this.fulfillAction(
        next,
        id,
        "BRIDGE_REPAIRED",
        bridge.id,
        undefined,
        now,
        records,
      );
    const finished = workers.filter((id): id is NpcId => id !== "player");
    for (const id of finished)
      records.push(
        ...this.prepareStep(
          next,
          id,
          true,
          "BRIDGE_REPAIRED",
          `${actorName(id)}完成施工，旧桥已修通。`,
          bridge.id,
          now,
          {
            change: {
              actor: id,
              workMs: next.contributions[id].workMs,
              sharedWorkMs: next.sharedWorkMs,
            },
          },
        ).records,
      );
    this.commit(next, event, records);
    for (const id of finished)
      this.afterStep(id, true, "BRIDGE_REPAIRED", bridge.id);
    if (this.playerProject === bridge.id) {
      this.working = false;
      this.playerWorkEvent = undefined;
    }
    this.trigger("bridge-repaired", bridge.id);
  }

  private discover(next: SaveState, actor: ActorId, target: string) {
    if (!next.bridge.repaired)
      return this.outcome(false, "BRIDGE_CLOSED", "先修好旧桥。");
    const clue = clueTargets.get(target)!;
    const found = (next.discoveries[actor] ??= []);
    if (found.includes(target))
      return this.outcome(true, "CLUE_KNOWN", clue.text);
    found.push(target);
    if (actor === "player" && target === valley.ruin.id) next.explored = true;
    return this.outcome(true, "DISCOVERED", clue.text);
  }

  private finishExploration(npc: NpcId, target: string, now: number) {
    const next = structuredClone(this.state);
    const found = this.discover(next, npc, target);
    this.finishStep(
      next, found.ok, found.code, found.text, target, now, undefined, npc,
    );
  }

  private deliverLocal(
    next: SaveState,
    who: ActorId,
    project: Project,
    item?: Item,
    quantity?: number,
  ) {
    const row = next.projects[project.id];
    const bag = this.bag(next, who);
    const amounts = deliveryAmounts(project, row, bag, item, quantity);
    const text = materialText(amounts);
    if (!text)
      return this.outcome(
        false,
        "PROJECT_NO_DELIVERY",
        this.checkWork(next, project)
          ? "工程无法接收本次交料，请核对工程剩余容量和背包。"
          : `${project.name}材料已交齐，已经可以施工。`,
      );
    const wasComplete = row.complete;
    transferToProject(bag, amounts);
    const credit = contribution(row, who);
    for (const kind of ["wood", "food"] as const) {
      row[kind] += amounts[kind] ?? 0;
      credit[kind] += amounts[kind] ?? 0;
    }
    if (!project.workMs)
      row.complete = !Object.values(projectMissing(project, row)).some(Boolean);
    return {
      ...this.outcome(
        true,
        "DELIVERED",
        `${actorName(who)}向${project.name}交付${text}。${!wasComplete && row.complete ? project.done : ""}`,
      ),
      materials: amounts,
    };
  }

  private workTarget(npc: NpcId) {
    const step = this.currentStep(npc);
    return step?.type === "work" ? step.target_id : undefined;
  }

  private advanceLocalProject(project: Project, elapsed: number, now: number) {
    const workers: ActorId[] = npcIds.filter(
      (id) =>
        this.runtime[id].working &&
        this.workTarget(id) === project.id &&
        distance(this.position(id), project) <= project.range,
    );
    if (
      this.working &&
      this.playerProject === project.id &&
      distance(this.state.player, project) <= project.range
    )
      workers.push("player");
    if (!workers.length) return;
    const next = structuredClone(this.state);
    const row = next.projects[project.id];
    if (row.complete) return;
    const remaining = project.workMs - row.progressMs;
    const { applied, shares } = distributeWork(
      remaining,
      elapsed,
      workers.map((id) => ({
        id,
        toolbox: this.bag(next, id).toolbox,
      })),
    );
    for (const [id, share] of shares) contribution(row, id).workMs += share;
    for (const pledge of next.pledges)
      if (
        pledge.status === "accepted" &&
        pledge.expiresAt > now &&
        pledge.condition.kind === "work" &&
        pledge.condition.project === project.id &&
        workers.includes(pledge.from)
      )
        pledge.progress = 1;
    row.progressMs += applied;
    if (applied < remaining) {
      this.commit(next);
      return;
    }
    row.progressMs = project.workMs;
    row.complete = true;
    const event = `project:${project.id}`;
    const records: Memory[] = [];
    const participants = Object.keys(row.contributions) as ActorId[];
    const name = `${project.name}完工`;
    this.publicEvent(
      next,
      event,
      participants.length > 1 ? "cooperation" : "project",
      project.done,
      now,
    );
    for (const id of participants) {
      if (id !== "player")
        records.push(
          this.memory(
            event,
            project.id,
            project.done,
            now,
            "fact",
            "rules",
            id,
          ),
        );
      this.fulfillAction(
        next,
        id,
        "PROJECT_COMPLETED",
        project.id,
        undefined,
        now,
        records,
      );
    }
    if (project.id === "carpenter-roof" && !participants.includes("cenyan"))
      records.push(
        this.memory(
          event,
          project.id,
          project.done,
          now,
          "fact",
          "rules",
          "cenyan",
        ),
      );
    for (const id of workers) {
      if (id === "player") continue;
      records.push(
        ...this.prepareStep(
          next,
          id,
          true,
          "PROJECT_COMPLETED",
          name,
          project.id,
          now,
        ).records,
      );
    }
    this.commit(next, undefined, records);
    for (const id of workers) {
      if (id !== "player")
        this.afterStep(id, true, "PROJECT_COMPLETED", project.id);
    }
    if (this.playerProject === project.id) {
      this.working = false;
      this.playerWorkEvent = undefined;
    }
    this.trigger("project-completed", project.id);
  }

  private performLocalProject(
    action: Action,
    next: SaveState,
    project: Project,
    now: number,
  ): Result {
    const reply = (ok: boolean, code: string, text: string) => ({
      type: "result" as const,
      id: action.id,
      target: project.id,
      ok,
      code,
      text,
    });
    const row = next.projects[project.id];
    if (action.verb === "inspect")
      return reply(
        true,
        "PROJECT",
        row.complete
          ? project.done
          : `尚缺${materialText(projectMissing(project, row)) || "施工"}。`,
      );
    if (action.verb === "deliver") {
      const result = this.deliver(
        next,
        "player",
        action.item,
        action.qty,
        project,
      );
      const outcome = {
        ...reply(result.ok, result.code, result.text),
        materials: result.materials,
      };
      if (result.ok) {
        const records: Memory[] = [];
        this.fulfillAction(
          next,
          "player",
          result.code,
          project.id,
          result.materials,
          now,
          records,
        );
        this.publicEvent(next, action.id, "project", result.text, now);
        if (
          row.complete &&
          !this.state.projects[project.id].complete &&
          project.id === "valley-camp"
        )
          for (const id of npcIds.filter(
            (id) => id === "ahe" || row.contributions[id],
          ))
            records.push(
              this.memory(
                action.id,
                project.id,
                project.done,
                now,
                "fact",
                "rules",
                id,
              ),
            );
        this.commit(next, action.id, records, outcome);
        this.trigger(
          row.complete ? "project-completed" : "project-materials",
          project.id,
        );
      }
      return outcome;
    }
    if (action.verb === "work") {
      const failure = this.checkWork(next, project);
      if (failure) return reply(false, failure.code, failure.text);
      if (this.working || this.moving)
        return reply(false, "MOVING", "站稳并结束当前施工后再开始。");
      this.haltPlayer();
      this.working = true;
      this.playerProject = project.id;
      this.playerWorkEvent = action.id;
      const outcome = reply(
        true,
        "WORK_STARTED",
        `开始在${project.name}施工。`,
      );
      this.commit(next, action.id, [], outcome);
      return outcome;
    }
    if (
      action.verb === "stop" &&
      this.working &&
      this.playerProject === project.id
    ) {
      this.haltPlayer();
      const outcome = reply(true, "WORK_STOPPED", "已暂停施工，进度已保存。");
      this.commit(next, action.id, [], outcome);
      return outcome;
    }
    return reply(false, "INVALID_ACTION", "这里无法执行该行动。");
  }

  private outcome(ok: boolean, code: string, text: string) {
    return { ok, code, text };
  }

  private collect(
    next: SaveState,
    bag: ActorState["bag"],
    id: string,
    now: number,
  ): Pick<Result, "ok" | "code" | "text" | "materials"> {
    const resource = resources.get(id)!;
    const remaining = (next.cooldowns[id] ?? 0) - now;
    if (remaining > 0)
      return this.outcome(
        false,
        "COOLDOWN",
        resource.item === "toolbox"
          ? "备用工具已领用，可向持有者借用。"
          : `采集点还需 ${Math.ceil(remaining / 1000)} 秒恢复。`,
      );
    if ((bag[resource.item] ?? 0) + resource.yieldCount > inventoryLimit)
      return this.outcome(false, "BAG_FULL", "背包里这一类材料已满。");
    bag[resource.item] = (bag[resource.item] ?? 0) + resource.yieldCount;
    next.cooldowns[id] = Math.min(
      Number.MAX_SAFE_INTEGER,
      now + resource.cooldownMs,
    );
    return {
      ...this.outcome(
        true,
        "COLLECTED",
        `从${resource.name}获得 ${items[resource.item]} ×${resource.yieldCount}，已放入背包。`,
      ),
      materials: {
        wood: resource.item === "wood" ? resource.yieldCount : 0,
        stone: resource.item === "stone" ? resource.yieldCount : 0,
        ...(resource.item !== "wood" &&
          resource.item !== "stone" && {
            [resource.item]: resource.yieldCount,
          }),
      },
    };
  }

  private deliver(
    next: SaveState,
    who: Contributor,
    item?: Item,
    qty?: number,
    project = projects.get(bridge.id)!,
  ): Pick<Result, "ok" | "code" | "text" | "materials"> {
    if (project.id !== bridge.id)
      return this.deliverLocal(next, who, project, item, qty);
    if (next.bridge.repaired)
      return this.outcome(false, "BRIDGE_DONE", "旧桥已经修好。");
    const { missing, materialsReady } = bridgeMaterialStatus(next.bridge);
    if (materialsReady)
      return this.outcome(false, "MATERIALS_READY", "材料已交齐，可以施工。");
    const bag = this.bag(next, who);
    const delivered = deliveryAmounts(project, next.bridge, bag, item, qty);
    if (!delivered.wood && !delivered.stone)
      return this.outcome(
        false,
        "MATERIALS_MISSING",
        `材料不足，没有可交付项。工程尚缺木材 ×${missing.wood}、石材 ×${missing.stone}。`,
      );
    transferToProject(bag, delivered);
    for (const material of materials) {
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
      qty !== undefined && item && (delivered[item] ?? 0) < qty
        ? "超出的数量留在背包或未持有。"
        : "";
    return {
      ...this.outcome(
        true,
        "DELIVERED",
        `${actorName(who)}交付${detail}。${clipped}${gap}`,
      ),
      materials: delivered,
    };
  }

  private checkWork(next: SaveState, project = projects.get(bridge.id)!) {
    if (project.id !== bridge.id) {
      const row = next.projects[project.id];
      if (!project.workMs || row.complete)
        return this.outcome(false, "PROJECT_DONE", "此工程当前无需施工。");
      if (Object.values(projectMissing(project, row)).some(Boolean))
        return this.outcome(
          false,
          "MATERIALS_MISSING",
          "先把材料交到工程现场。",
        );
      return;
    }
    if (next.bridge.repaired)
      return this.outcome(false, "BRIDGE_DONE", "旧桥已经修好。");
    if (!bridgeMaterialStatus(next.bridge).materialsReady)
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
    const npc = npcSchema.safeParse(action.target).data;
    if (npc && (action.verb === "stop-follow" || action.verb === "stop-wait"))
      return this.cancelAction(action, now, npc);
    if (
      npc &&
      action.verb === "gift-response" &&
      action.offerId &&
      action.choice
    )
      return this.state.gift?.from !== npc
        ? this.giftResult(
            action.id,
            false,
            "GIFT_UNKNOWN",
            "没有可由你处理的赠送提议。",
            npc,
          )
        : this.resolveGift(
            action.id,
            action.offerId,
            "player",
            action.choice,
            now,
          );
    const other = residents.get(action.target);
    const resource = resources.get(action.target);
    const target = npc
      ? { ...other!, ...this.state.actors[npc] }
      : (other ??
        resource ??
        projects.get(action.target) ??
        clueTargets.get(action.target));
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
          const records = npcIds
            .filter((id) => distance(this.position(id), bridge) <= 120)
            .map((id) =>
              this.memory(
                action.id,
                bridge.id,
                result.text,
                now,
                "fact",
                "rules",
                id,
              ),
            );
          this.fulfillAction(
            next,
            "player",
            "DELIVERED",
            bridge.id,
            result.materials,
            now,
            records,
          );
          this.publicEvent(next, action.id, "project", result.text, now);
          this.commit(next, action.id, records, outcome);
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
        this.playerProject = bridge.id;
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
    const project = projects.get(target.id);
    if (project && project.id !== bridge.id)
      return this.performLocalProject(action, next, project, now);
    if (
      clueTargets.has(target.id) &&
      (action.verb === "explore" || action.verb === "inspect")
    ) {
      if (!next.bridge.repaired)
        return reply(false, "BRIDGE_CLOSED", "先修好旧桥。");
      const found = this.discover(next, "player", target.id);
      const result = reply(
        found.ok,
        target.id === valley.ruin.id ? "RUIN" : found.code,
        found.text,
      );
      if (found.code === "DISCOVERED") {
        this.publicEvent(
          next,
          action.id,
          "project",
          `旅人发现了${target.name}的线索。`,
          now,
        );
        this.commit(next, action.id, [], result);
        this.trigger("clue-discovered", target.id);
      }
      return result;
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
    this.gameRemainder = 0;
    this.save.write(next, action.id, [], true);
    this.state = next;
    for (const id of npcIds) {
      this.runtime[id].recentMemory = [];
      this.runtime[id].lastChatterAt = undefined;
    }
    this.bubbles = [];
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
    this.conversations.clear();
    this.bubbles = [];
    for (const id of npcIds) this.haltActor(id);
  }

  private haltActor(id: NpcId) {
    const runtime = this.runtime[id];
    runtime.working = false;
    runtime.activity = "idle";
    runtime.displayUntil = 0;
    this.clearRoute(id);
  }

  flush() {
    if (this.dirty) this.commit(this.state);
  }

  private commit(
    next: SaveState,
    receipt?: string,
    memories: Memory[] = [],
    result?: Result,
    secondaryReceipt?: string,
  ) {
    next.cenyan = next.actors.cenyan;
    this.save.write(next, receipt, memories, false, result, secondaryReceipt);
    this.state = next;
    this.dirty = false;
    for (const id of npcIds) {
      const own = memories.filter((m) => m.actor === id);
      const runtime = this.runtime[id];
      if (own.length)
        runtime.recentMemory = [
          ...own.reverse(),
          ...runtime.recentMemory,
        ].slice(0, 6);
    }
  }
}
