import { z } from "zod";
import { inventoryLimit, residents, valley } from "./world.js";

export const cenyanId = "cenyan";
export const home = {
  ...residents.get(cenyanId)!,
  id: "cenyan-home",
  name: "木匠工坊",
  range: 12,
};
export const destinations = [
  home,
  valley.bridge,
  valley.ruin,
  ...valley.resources,
];
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
export const materialSchema = z.enum(["wood", "stone"]);
export const quantitySchema = z.int().min(1).max(inventoryLimit);
export const materialAmount = z.strictObject({
  item: materialSchema,
  qty: quantitySchema,
});
export const giftChoice = z.enum(["accept", "reject"]);
export const giftOffer = materialAmount.extend({
  id: z.uuid(),
  from: z.enum(["player", "cenyan"]),
  expiresAt: z.int().positive(),
});
export type GiftOffer = z.infer<typeof giftOffer>;
export type MaterialAmount = z.infer<typeof materialAmount>;
const policy = z.enum(["continue", "replace", "defer", "reject"]);
const giftResponse = z.strictObject({
  offer_id: z.uuid(),
  decision: giftChoice,
});
const resourceId = z.enum(valley.resources.map(({ id }) => id));
const moveId = z.enum(destinations.map(({ id }) => id));
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
    description: "动态跟随旅人至旧桥边",
    params: '必填 target_id，固定为 "player"',
    examples: [{ type: "follow", target_id: "player" }],
    targets: ["player"],
    preconditions: "旅人主动邀请，起步时在交谈范围",
    execution: "避让同行，抵达、取消、超时或受阻时结束",
    results: "同行抵达或失败原因",
    schema: z.strictObject({
      type: z.literal("follow"),
      target_id: z.literal("player"),
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
    description: "提议把自己的材料赠给旅人",
    params: `必填 target_id（"player"）、item（"wood" 或 "stone"）、qty（1–${inventoryLimit} 整数）`,
    examples: [
      { type: "give_item", target_id: "player", item: "stone", qty: 1 },
    ],
    targets: ["player"],
    preconditions: "双方在交谈范围，拥有所提议的数量",
    execution: "创建有时限的提议，旅人明确接受后再检查并转移",
    results: "提议、同意、拒绝或失败原因",
    schema: materialAmount.extend({
      type: z.literal("give_item"),
      target_id: z.literal("player"),
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
    execution: "自己主动施工可与旅人叠加",
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
  })
  .refine((reply) => {
    if (reply.gift_response) return !reply.plan && !reply.plan_policy;
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
      workMs: z.number().optional(),
      sharedWorkMs: z.number().optional(),
      actor: z.enum(["player", "cenyan"]).optional(),
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
  id: z.literal(cenyanId),
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

export type Actor = z.infer<typeof actorSchema>;
export type Memory = {
  id: string;
  actor: typeof cenyanId;
  at: number;
  kind: "fact" | "claim" | "opinion";
  source: "rules" | "traveler" | "cenyan";
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
export type CenyanStatus = {
  activity:
    | "idle"
    | "moving"
    | "collecting"
    | "delivering"
    | "working"
    | "waiting"
    | "resting"
    | "paused";
  memory: Memory[];
  model?: ModelStatus;
};
