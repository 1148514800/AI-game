import { z } from "zod";
import { inventoryLimit, valley } from "./world.js";

import {
  actorIdSchema,
  npcSchema,
  homes,
  destinations,
  destinationId,
  materialAmount,
  waitCondition,
  socialCommand,
  conversationSchema,
  relationsSchema,
  type NpcId,
  type ActorId,
} from "./social.js";

export {
  destinations,
  materialSchema,
  quantitySchema,
  materialAmount,
  type MaterialAmount,
} from "./social.js";
export const cenyanId = "cenyan";
export const home = homes[0];
export const destinationNames = new Map(
  destinations.map(({ id, name }) => [id, name]),
);

export const goals = {
  "repair-bridge": "修复旧桥",
  "stock-wood": "储备屋顶木料",
  rest: "休整",
} as const;

export type GoalTag = keyof typeof goals;
const goalTag = z.enum(Object.keys(goals) as GoalTag[]);
export const legacyGoalTag = (goal: string): GoalTag | undefined =>
  Object.hasOwn(goals, goal) ? (goal as GoalTag) : undefined;
export const goalSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\x00-\x1f\x7f]+$/);
export function goalName(goal: string) {
  const tag = legacyGoalTag(goal);
  return tag ? goals[tag] : goal;
}
export const giftChoice = z.enum(["accept", "reject"]);
export const giftOffer = materialAmount.extend({
  id: z.uuid(),
  from: actorIdSchema,
  to: actorIdSchema.optional(),
  expiresAt: z.int().positive(),
});
export type GiftOffer = z.infer<typeof giftOffer>;
const policy = z.enum(["continue", "replace", "defer", "reject"]);
const giftResponse = z.strictObject({
  offer_id: z.uuid(),
  decision: giftChoice,
});
const resourceId = z.enum(valley.resources.map(({ id }) => id));
const moveId = destinationId;
export const capabilities = {
  move_to: {
    description: "走到地点的交互范围",
    params: "必填 target_id，取下列地点 ID",
    examples: [{ type: "move_to", target_id: home.id }],
    targets: destinations.map((d) => d.id),
    preconditions: "路线可达",
    execution: "服务端寻路移动",
    results: "抵达或受阻",
    schema: z.strictObject({ type: z.literal("move_to"), target_id: moveId }),
  },
  follow: {
    description: "动态跟随另一角色前往指定地点",
    params: "target_id 为对象 ID，destination_id 为地点 ID（省略则去旧桥）",
    examples: [{ type: "follow", target_id: "player" }],
    targets: ["player"],
    preconditions: "对方邀请或同意，起步在交谈范围，无互跟",
    execution: "避让同行，抵达、取消、超时或受阻时结束",
    results: "同行抵达或失败原因",
    schema: z.strictObject({
      type: z.literal("follow"),
      target_id: actorIdSchema,
      destination_id: destinationId.optional(),
    }),
  },
  collect: {
    description: "采集材料",
    params: "必填 target_id，取下列资源 ID",
    examples: [{ type: "collect", target_id: valley.resources[0].id }],
    targets: valley.resources.map((r) => r.id),
    preconditions: "在采集范围且资源已恢复、背包有空间",
    execution: "材料入自己的背包",
    results: "实际材料或失败原因",
    schema: z.strictObject({
      type: z.literal("collect"),
      target_id: resourceId,
    }),
  },
  give_item: {
    description: "提议把自己的材料赠给对方",
    params: `必填 target_id（角色 ID）、item（"wood" 或 "stone"）、qty（1–${inventoryLimit} 整数）`,
    examples: [
      { type: "give_item", target_id: "player", item: "stone", qty: 1 },
    ],
    targets: ["player"],
    preconditions: "双方在交谈范围，拥有所提议的数量",
    execution: "创建有时限的提议，接收者明确接受后再检查并转移",
    results: "提议、同意、拒绝或失败原因",
    schema: materialAmount.extend({
      type: z.literal("give_item"),
      target_id: actorIdSchema,
    }),
  },
  deliver: {
    description: "分批交付自己的工程材料",
    params: `必填 target_id（旧桥 ID）。item（"wood" 或 "stone"）和 qty（1–${inventoryLimit} 整数）必须成对给出；全部省略则交当前全部有效材料`,
    examples: [
      { type: "deliver", target_id: valley.bridge.id, item: "wood", qty: 2 },
      { type: "deliver", target_id: valley.bridge.id },
    ],
    targets: [valley.bridge.id],
    preconditions: "在桥边，有工程尚缺的材料",
    execution: "按拥有数量与工程缺口截断",
    results: "实际交付数量与缺口或失败原因",
    schema: z
      .strictObject({
        type: z.literal("deliver"),
        target_id: z.literal(valley.bridge.id),
        ...materialAmount.partial().shape,
      })
      .refine((step) => (step.item === undefined) === (step.qty === undefined)),
  },
  work: {
    description: "参加旧桥施工",
    params: "必填 target_id，固定为旧桥 ID",
    examples: [{ type: "work", target_id: valley.bridge.id }],
    targets: [valley.bridge.id],
    preconditions: "在桥边且材料齐备",
    execution: "自己主动施工可与其他角色叠加",
    results: "工时和完工或失败原因",
    schema: z.strictObject({
      type: z.literal("work"),
      target_id: z.literal(valley.bridge.id),
    }),
  },
  wait: {
    examples: [{ type: "wait", seconds: 3 }],
    description: "留在原处等待",
    params: "必填 seconds，1–30 的整数",
    targets: [],
    preconditions: "无",
    execution: "按活动时间计时",
    results: "等待结束",
    schema: z.strictObject({
      type: z.literal("wait"),
      seconds: z.int().min(1).max(30),
    }),
  },
  wait_until: {
    description: "等待有限规则条件，然后继续后续步骤",
    params:
      "condition.kind 为 materials-ready、arrived（actor、destination）或 gift-response（offerId 可省略，等待本人最近的交接提议）。seconds 为 1–60",
    examples: [
      {
        type: "wait_until",
        condition: { kind: "materials-ready" },
        seconds: 50,
      },
    ],
    preconditions: "条件有效",
    schema: z.strictObject({
      type: z.literal("wait_until"),
      condition: waitCondition,
      seconds: z.int().min(1).max(60),
    }),
  },
  talk: {
    description: "找另一名居民交谈",
    params: "target_id 为 NPC ID，topic 为简短话题",
    examples: [{ type: "talk", target_id: "ahe", topic: "商量旧桥分工" }],
    preconditions: "双方可交谈，同一角色对冷却约三分钟",
    schema: z.strictObject({
      type: z.literal("talk"),
      target_id: npcSchema,
      topic: conversationSchema.shape.topic,
    }),
  },
  social: {
    description: "正式提出或处理交接及承诺",
    params: "command.kind 为 offer、pledge、respond、cancel 或 return",
    examples: [
      {
        type: "social",
        command: {
          kind: "offer",
          target: "ahe",
          terms: { kind: "request", take: { item: "wood", qty: 1 } },
        },
      },
    ],
    preconditions: "正式提议与确认绑定双方，成交需在交谈距离内",
    schema: z.strictObject({
      type: z.literal("social"),
      command: socialCommand,
    }),
  },
  rest: {
    examples: [{ type: "rest", seconds: 3 }],
    description: "留在原处休息",
    params: "必填 seconds，1–30 的整数",
    targets: [],
    preconditions: "无",
    execution: "按活动时间计时",
    results: "休息结束",
    schema: z.strictObject({
      type: z.literal("rest"),
      seconds: z.int().min(1).max(30),
    }),
  },
};
const { move_to, follow, collect, give_item, deliver, work, wait, rest } =
  capabilities;
export const stepSchema = z.discriminatedUnion("type", [
  move_to.schema,
  follow.schema,
  collect.schema,
  give_item.schema,
  deliver.schema,
  work.schema,
  wait.schema,
  rest.schema,
  capabilities.wait_until.schema,
  capabilities.talk.schema,
  capabilities.social.schema,
]);
export const planSteps = z.array(stepSchema).min(1).max(3);
const speech = z
  .string()
  .trim()
  .max(300)
  .regex(/^[^\x00-\x08\x0e-\x1f]*$/);
const decisionFields = {
  goal: goalSchema,
  goal_tag: goalTag.optional(),
  speech,
};
export const speechReplySchema = z.strictObject({ speech: speech.min(1) });
export const decisionSchema = z.strictObject({
  ...decisionFields,
  plan: planSteps,
  plan_policy: z.literal("replace").optional(),
});
export const actionReplySchema = z
  .strictObject({
    ...decisionFields,
    speech: decisionFields.speech.min(1),
    plan: planSteps.optional(),
    plan_policy: policy.optional(),
    gift_response: giftResponse.optional(),
    social_response: giftResponse.optional(),
  })
  .refine((reply) => {
    if (reply.gift_response || reply.social_response)
      return (
        !(reply.gift_response && reply.social_response) &&
        !reply.plan &&
        !reply.plan_policy
      );
    const selected = reply.plan_policy ?? (reply.plan ? "replace" : "reject");
    return (selected === "replace" || selected === "defer") === !!reply.plan;
  });

export type Step = z.infer<typeof stepSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type ActionReply = z.infer<typeof actionReplySchema>;
export const actionOutcome = z.strictObject({
  code: z.string().max(40),
  text: z.string().max(240),
  type: z.string().max(24).optional(),
  status: z.enum(["ok", "failed", "cancelled"]).optional(),
  id: z.string().max(90).optional(),
  change: z
    .strictObject({
      wood: z.int().optional(),
      stone: z.int().optional(),
      target: z.string().optional(),
      offerId: z.uuid().optional(),
      traveled: z.boolean().optional(),
      workMs: z.number().optional(),
      sharedWorkMs: z.number().optional(),
      actor: actorIdSchema.optional(),
    })
    .optional(),
});

const decisionRecord = {
  id: z.uuid(),
  goal: goalSchema,
  goalTag: goalTag.optional(),
};
const planDecision = z.strictObject({
  ...decisionRecord,
  speech: speech.optional(),
  policy,
  steps: planSteps.optional(),
  status: z.enum(["accepted", "deferred", "rejected", "continued"]),
});
export type PlanDecision = z.infer<typeof planDecision>;
const giftDecision = z.strictObject({
  ...decisionRecord,
  speech: speech.min(1),
  giftResponse,
  status: z.enum(["resolved", "failed"]),
  code: z.enum([
    "GIFT_TRANSFERRED",
    "GIFT_REJECTED",
    "GIFT_EXPIRED",
    "GIFT_NO_STOCK",
    "GIFT_CAPACITY",
  ]),
});
export type GiftDecision = z.infer<typeof giftDecision>;

export const actorSchema = z.strictObject({
  id: npcSchema,
  relations: relationsSchema.default({}),
  x: z.number(),
  y: z.number(),
  facing: z.enum(["down", "up", "left", "right"]),
  bag: z.strictObject({
    wood: z.int().min(0).max(inventoryLimit),
    stone: z.int().min(0).max(inventoryLimit),
  }),
  goal: goalSchema,
  goalTag: goalTag.optional(),
  generation: z.int().min(0),
  plan: z
    .strictObject({
      id: z.uuid(),
      steps: planSteps,
      index: z.int().min(0).max(2),
      remainingMs: z.number().min(0).max(60_000).optional(),
      followed: z.boolean().optional(),
      traveled: z.boolean().optional(),
    })
    .nullable(),
  pending: z
    .strictObject({
      id: z.uuid(),
      goal: goalSchema,
      goalTag: goalTag.optional(),
      steps: planSteps,
    })
    .nullable()
    .default(null),
  decision: z.union([planDecision, giftDecision]).nullable().default(null),
  last: actionOutcome.nullable(),
  results: z.array(actionOutcome).max(3).default([]),
});

export type ActorState = z.infer<typeof actorSchema>;
export type Actor = ActorState;
export type Memory = {
  id: string;
  actor: NpcId;
  at: number;
  kind: "fact" | "claim" | "opinion" | "commitment";
  source: "rules" | "traveler" | ActorId;
  event: string;
  topic: string;
  content: string;
};
export type ModelStatus = {
  kind: "disabled" | "idle" | "pending" | "backoff" | "blocked";
  mode?: "mock" | "live";
  trigger?: string;
  result?: string;
  elapsedMs?: number;
  tokens?: number;
  estimatedUsd?: number;
  sharedUsage?: { requests: number; tokens: number; chargedUsd?: number };
};
export type ActorStatus = {
  activity:
    | "idle"
    | "moving"
    | "collecting"
    | "delivering"
    | "working"
    | "waiting"
    | "resting"
    | "talking"
    | "paused";
  memory: Memory[];
  model?: ModelStatus;
};
