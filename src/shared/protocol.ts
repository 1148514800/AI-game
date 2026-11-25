import { z } from "zod";
import { inventoryLimit, valley } from "./world.js";

import { actorSchema, type CenyanStatus } from "./cenyan.js";

export const schemaVersion = 2;
const directions = z.enum(["down", "up", "left", "right"]);
const axis = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
const id = z.string().regex(/^[a-z0-9-]{1,64}$/);
const count = z.int().min(0).max(inventoryLimit);
const material = valley.bridge.required;
const actionId = z.uuid();
export const dialogueInputLimit = 480;
export type DialogueMode = "mock" | "live";
export type DialogueEvent =
  | {
      type: "dialogue";
      event: "opened";
      requestId: string;
      dialogId: string;
      mode: DialogueMode;
    }
  | { type: "dialogue"; event: "pending"; requestId: string; dialogId: string }
  | {
      type: "dialogue";
      event: "reply";
      requestId: string;
      dialogId: string;
      text: string;
      action?: "accepted" | "deferred" | "rejected";
    }
  | {
      type: "dialogue";
      event: "error";
      requestId: string;
      dialogId?: string;
      code: string;
      text: string;
    }
  | { type: "dialogue"; event: "closed"; dialogId: string; text: string };

export const clientMessage = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("move"), dx: axis, dy: axis }),
  z.strictObject({ type: z.literal("pause"), paused: z.boolean() }),
  z.strictObject({ type: z.literal("dialogue-open"), id: actionId, npc: id }),
  z.strictObject({
    type: z.literal("dialogue-send"),
    id: actionId,
    dialogId: actionId,
    text: z.string().max(4096),
  }),
  z.strictObject({ type: z.literal("dialogue-close"), dialogId: actionId }),
  z.strictObject({
    type: z.literal("action"),
    id: actionId,
    target: id,
    verb: z.enum(["inspect", "collect", "deliver", "work", "stop"]),
  }),
  z.strictObject({
    type: z.literal("reset"),
    id: actionId,
    confirm: z.literal(true),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;
export type Action = Extract<ClientMessage, { type: "action" }>;

export const legacySaveSchema = z.strictObject({
  schemaVersion: z.literal(1),
  contentVersion: z.literal(valley.contentVersion),
  worldId: z.literal(valley.id),
  player: z.strictObject({ x: z.number(), y: z.number(), facing: directions }),
  inventory: z.strictObject({
    wood: count,
    stone: count,
    food: count,
    toolbox: count,
  }),
  cooldowns: z.record(id, z.int().min(0)),
  bridge: z.strictObject({
    discovered: z.boolean(),
    wood: count.max(material.wood),
    stone: count.max(material.stone),
    progressMs: z.number().min(0).max(valley.bridge.workMs),
    repaired: z.boolean(),
  }),
  explored: z.boolean(),
});
export const saveSchema = legacySaveSchema.extend({
  schemaVersion: z.literal(schemaVersion),
  cenyan: actorSchema,
});
export type SaveState = z.infer<typeof saveSchema>;

export type Snapshot = {
  type: "snapshot";
  now: number;
  state: SaveState;
  moving: boolean;
  working: boolean;
  cenyan: CenyanStatus;
};
export type Result = {
  type: "result";
  id: string;
  ok: boolean;
  code: string;
  text: string;
  target?: string;
};
export type ServerMessage =
  | Snapshot
  | Result
  | DialogueEvent
  | {
      type: "error";
      code: string;
      text: string;
    };
