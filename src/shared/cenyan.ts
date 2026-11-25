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

const goal = z.enum(["repair-bridge", "stock-wood", "rest"]);
const resourceId = z.enum(valley.resources.map(({ id }) => id));
const moveId = z.enum(destinations.map(({ id }) => id));
export const stepSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("move_to"), target_id: moveId }),
  z.strictObject({ type: z.literal("collect"), target_id: resourceId }),
  z.strictObject({
    type: z.literal("deliver"),
    target_id: z.literal(valley.bridge.id),
  }),
  z.strictObject({
    type: z.literal("work"),
    target_id: z.literal(valley.bridge.id),
  }),
  z.strictObject({ type: z.literal("wait"), seconds: z.int().min(1).max(30) }),
  z.strictObject({ type: z.literal("rest"), seconds: z.int().min(1).max(30) }),
]);
export const planSteps = z.array(stepSchema).min(1).max(3);
const decisionFields = {
  goal,
  speech: z
    .string()
    .trim()
    .max(300)
    .regex(/^[^\x00-\x08\x0e-\x1f]*$/),
};
export const decisionSchema = z.strictObject({
  ...decisionFields,
  plan: planSteps,
});
export const actionReplySchema = z.strictObject({
  ...decisionFields,
  speech: decisionFields.speech.min(1),
  plan: planSteps.optional(),
});

export type Step = z.infer<typeof stepSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type ActionReply = z.infer<typeof actionReplySchema>;
export type Goal = z.infer<typeof goal>;

export const actorSchema = z.strictObject({
  id: z.literal(cenyanId),
  x: z.number(),
  y: z.number(),
  facing: z.enum(["down", "up", "left", "right"]),
  bag: z.strictObject({
    wood: z.int().min(0).max(inventoryLimit),
    stone: z.int().min(0).max(inventoryLimit),
  }),
  goal,
  generation: z.int().min(0),
  plan: z
    .strictObject({
      id: z.uuid(),
      steps: planSteps,
      index: z.int().min(0).max(2),
      remainingMs: z.number().min(0).max(30_000).optional(),
    })
    .nullable(),
  last: z
    .strictObject({ code: z.string().max(40), text: z.string().max(240) })
    .nullable(),
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
