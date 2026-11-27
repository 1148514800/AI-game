import { z } from "zod";
import { inventoryLimit, items, residents, valley } from "./world.js";

export const npcIds = ["cenyan", "ahe", "luozhou"] as const;
export const npcSchema = z.enum(npcIds);
export type NpcId = z.infer<typeof npcSchema>;
export const actorIdSchema = z.enum(["player", ...npcIds]);
export type ActorId = z.infer<typeof actorIdSchema>;
export const actorName = (id: ActorId) =>
  id === "player" ? valley.spawn.name : residents.get(id)!.name;

export const homes = npcIds.map((id) => ({
  ...residents.get(id)!,
  id: id + "-home",
  name: id === "cenyan" ? "木匠工坊" : actorName(id) + "的休息处",
  range: 12,
}));
export const destinations = [
  ...homes,
  valley.bridge,
  valley.ruin,
  ...valley.resources,
];
export const destinationId = z.enum(destinations.map(({ id }) => id));
export const materialSchema = z.enum(["wood", "stone"]);
export const quantitySchema = z.int().min(1).max(inventoryLimit);
export const materialAmount = z.strictObject({
  item: materialSchema,
  qty: quantitySchema,
});
export type MaterialAmount = z.infer<typeof materialAmount>;

export const waitCondition = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("materials-ready") }),
  z.strictObject({
    kind: z.literal("arrived"),
    actor: actorIdSchema,
    destination: destinationId,
  }),
  z.strictObject({
    kind: z.literal("gift-response"),
    offerId: z.uuid().optional(),
  }),
]);
export const commitmentCondition = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("deliver"), ...materialAmount.shape }),
  z.strictObject({ kind: z.literal("arrive"), destination: destinationId }),
  z.strictObject({ kind: z.literal("work") }),
]);
const terms = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("gift"), give: materialAmount }),
  z.strictObject({ kind: z.literal("request"), take: materialAmount }),
  z.strictObject({
    kind: z.literal("exchange"),
    give: materialAmount,
    take: materialAmount,
  }),
  z.strictObject({ kind: z.literal("loan"), give: materialAmount }),
]);
export const socialCommand = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("offer"), target: actorIdSchema, terms }),
  z.strictObject({
    kind: z.literal("pledge"),
    target: actorIdSchema,
    condition: commitmentCondition,
  }),
  z.strictObject({
    kind: z.literal("respond"),
    offerId: z.uuid(),
    choice: z.enum(["accept", "reject"]),
  }),
  z.strictObject({ kind: z.literal("cancel"), offerId: z.uuid() }),
  z.strictObject({ kind: z.literal("return"), offerId: z.uuid() }),
]);
export type SocialCommand = z.infer<typeof socialCommand>;

const participants = {
  id: z.uuid(),
  from: actorIdSchema,
  to: actorIdSchema,
  expiresAt: z.int().positive(),
  status: z.enum(["proposed", "accepted", "fulfilled", "cancelled"]),
};
export const dealSchema = z.strictObject({
  ...participants,
  terms,
  cancellation: z
    .enum(["declined", "expired", "cancelled", "unavailable"])
    .optional(),
});
export type Deal = z.infer<typeof dealSchema>;
export const pledgeSchema = z.strictObject({
  ...participants,
  condition: z.union([
    commitmentCondition,
    z.strictObject({ kind: z.literal("return"), ...materialAmount.shape }),
  ]),
  progress: z.int().min(0).max(inventoryLimit).default(0),
});
export type Pledge = z.infer<typeof pledgeSchema>;
const trust = z.strictObject({
  level: z.int().min(-2).max(2),
  reason: z.string().max(100),
});
export const relationsSchema = z.partialRecord(actorIdSchema, trust);
export const trustLabels = ["不信任", "有所保留", "普通", "信任", "高度信任"];

export const publicEventSchema = z.strictObject({
  id: z.string().max(100),
  at: z.int(),
  text: z.string().max(240),
  kind: z.enum(["project", "handoff", "cooperation"]),
});
export type PublicEvent = z.infer<typeof publicEventSchema>;
export const conversationSchema = z.strictObject({
  id: z.uuid(),
  from: npcSchema,
  to: npcSchema,
  topic: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\x00-\x1f\x7f]+$/),
});
export type Conversation = z.infer<typeof conversationSchema>;
export type SpeechBubble = {
  id: string;
  actor: NpcId;
  text: string;
  until: number;
};

const amountText = ({ item, qty }: MaterialAmount) => `${items[item]} ×${qty}`;
export function agreementText(entry: Deal | Pledge) {
  if ("terms" in entry) {
    const parts = {
      gift: "赠送",
      request: "请求",
      exchange: "交换",
      loan: "出借",
    };
    const terms = entry.terms;
    return (
      parts[terms.kind] +
      " " +
      ("give" in terms ? amountText(terms.give) : amountText(terms.take)) +
      (terms.kind === "exchange" ? " 换 " + amountText(terms.take) : "")
    );
  }
  switch (entry.condition.kind) {
    case "deliver":
      return "交付 " + amountText(entry.condition);
    case "arrive":
      return "抵达 " + entry.condition.destination;
    case "work":
      return "参加旧桥完工";
    case "return":
      return "归还 " + amountText(entry.condition);
  }
}
