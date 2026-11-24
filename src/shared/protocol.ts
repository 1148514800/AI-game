import { z } from "zod";
export const pingSchema = z
  .object({ type: z.literal("ping"), sequence: z.number().int().min(0) })
  .strict();
export const WORLD = {
  width: 320,
  height: 224,
  tile: 16,
  playerId: "traveler-01",
  npcId: "preview-resident-01",
} as const;
export function clampPosition(x: number, y: number) {
  return {
    x: Math.max(8, Math.min(WORLD.width - 8, x)),
    y: Math.max(16, Math.min(WORLD.height - 4, y)),
  };
}
