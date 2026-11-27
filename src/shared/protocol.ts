import { z } from "zod";
import { inventoryLimit, valley } from "./world.js";

import {
  actorSchema,
  giftChoice,
  giftOffer,
  materialAmount,
  materialSchema,
  quantitySchema,
  type ActorStatus,
} from "./cenyan.js";

import {
  dealSchema,
  pledgeSchema,
  publicEventSchema,
  socialCommand,
  actorIdSchema,
  type NpcId,
  type SpeechBubble,
} from "./social.js";

export const schemaVersion = 4;
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
      npc?: NpcId;
    }
  | { type: "dialogue"; event: "pending"; requestId: string; dialogId: string }
  | {
      type: "dialogue";
      event: "reply";
      requestId: string;
      dialogId: string;
      text: string;
      action?: "accepted" | "deferred" | "rejected" | "continued";
      gift?: Result;
      agreement?: Result;
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

export const clientMessage = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("move"), dx: axis, dy: axis }),
    z.strictObject({ type: z.literal("pause"), paused: z.boolean() }),
    z.strictObject({ type: z.literal("dialogue-open"), id: actionId, npc: id }),
    z.strictObject({
      type: z.literal("dialogue-send"),
      id: actionId,
      dialogId: actionId,
      text: z.string().max(4096),
    }),
    z.strictObject({
      type: z.literal("dialogue-gift"),
      id: actionId,
      dialogId: actionId,
      gift: materialAmount,
    }),
    z.strictObject({
      type: z.literal("dialogue-agreement"),
      id: actionId,
      dialogId: actionId,
      offerId: actionId,
    }),
    z.strictObject({ type: z.literal("dialogue-close"), dialogId: actionId }),
    z.strictObject({
      type: z.literal("social"),
      id: actionId,
      command: socialCommand,
    }),
    z.strictObject({
      type: z.literal("action"),
      id: actionId,
      target: id,
      verb: z.enum([
        "inspect",
        "collect",
        "deliver",
        "work",
        "stop",
        "stop-follow",
        "stop-wait",
        "gift-response",
      ]),
      item: materialSchema.optional(),
      qty: quantitySchema.optional(),
      offerId: actionId.optional(),
      choice: giftChoice.optional(),
    }),
    z.strictObject({
      type: z.literal("reset"),
      id: actionId,
      confirm: z.literal(true),
    }),
  ])
  .refine((msg) => {
    if (msg.type !== "action") return true;
    if (msg.verb === "gift-response")
      return (
        !!msg.offerId &&
        !!msg.choice &&
        msg.item === undefined &&
        msg.qty === undefined
      );
    return (
      msg.offerId === undefined &&
      msg.choice === undefined &&
      (msg.verb === "deliver"
        ? (msg.item === undefined) === (msg.qty === undefined)
        : msg.item === undefined && msg.qty === undefined)
    );
  });
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
const contribution = z.strictObject({
  wood: z.int().min(0).max(material.wood),
  stone: z.int().min(0).max(material.stone),
  workMs: z.number().min(0).max(valley.bridge.workMs),
});
export const v2SaveSchema = legacySaveSchema.extend({
  schemaVersion: z.literal(2),
  cenyan: actorSchema,
});
export const v3SaveSchema = legacySaveSchema.extend({
  schemaVersion: z.literal(3),
  cenyan: actorSchema,
  gift: giftOffer.nullable(),
  contributions: z.strictObject({
    player: contribution,
    cenyan: contribution,
    legacy: contribution,
  }),
  sharedWorkMs: z
    .number()
    .min(0)
    .max(valley.bridge.workMs / 2),
});
export const saveSchema = v3SaveSchema.omit({ cenyan: true }).extend({
  schemaVersion: z.literal(schemaVersion),
  actors: z.strictObject({
    cenyan: actorSchema,
    ahe: actorSchema,
    luozhou: actorSchema,
  }),
  contributions: v3SaveSchema.shape.contributions.extend({
    ahe: contribution,
    luozhou: contribution,
  }),
  workPairs: z.array(z.string()).max(6),
  talkCooldowns: z.record(z.string(), z.int()),
  deals: z.array(dealSchema).max(48),
  pledges: z.array(pledgeSchema).max(48),
  events: z.array(publicEventSchema).max(12),
});
export type StoredState = z.infer<typeof saveSchema>;
// Transitional projection used by existing clients and Phase 0–3.1 regression fixtures.
export type SaveState = StoredState & {
  cenyan: StoredState["actors"]["cenyan"];
};

export type Snapshot = {
  type: "snapshot";
  now: number;
  state: SaveState;
  moving: boolean;
  working: boolean;
  cenyan: ActorStatus;
  actors: Record<NpcId, ActorStatus>;
  bubbles: SpeechBubble[];
};
export type Result = {
  type: "result";
  id: string;
  ok: boolean;
  code: string;
  text: string;
  target?: string;
  materials?: { wood: number; stone: number };
  actor?: z.infer<typeof actorIdSchema>;
  offerId?: string;
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
