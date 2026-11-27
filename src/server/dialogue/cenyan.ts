import personality from "../../../data/npcs/cenyan.json" with { type: "json" };
import ahe from "../../../data/npcs/ahe.json" with { type: "json" };
import luozhou from "../../../data/npcs/luozhou.json" with { type: "json" };
import type { NpcId } from "../../shared/social.js";
import { contextBytes, historyTurns } from "./config.js";

export type PublicBridge = {
  discovered: boolean;
  wood: number;
  stone: number;
  woodRequired: number;
  stoneRequired: number;
  progressPercent: number;
  repaired: boolean;
  missing?: { wood: number; stone: number };
  materialsReady?: boolean;
  committed?: { wood: number; stone: number };
  unassigned?: { wood: number; stone: number };
  contributions?: import("../../shared/protocol.js").SaveState["contributions"];
  sharedWorkMs?: number;
};
export type Turn = { player: string; reply: string };
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const personalities = { cenyan: personality, ahe, luozhou };
export function actorIdentity(actor: NpcId) {
  const profile = personalities[actor];
  return [
    profile.background,
    profile.goals,
    profile.knowledge,
    profile.expression,
    ...profile.boundaries,
  ].join("\n");
}
export const identity = actorIdentity("cenyan");

export function bridgeNotice(bridge: PublicBridge): string {
  if (bridge.repaired) return "公共告示：旧桥已修通，可往东岸。";
  const { wood, stone } = bridge.missing ?? {
    wood: bridge.woodRequired - bridge.wood,
    stone: bridge.stoneRequired - bridge.stone,
  };
  const received = `公共告示：旧桥未修通。已交木材 ${bridge.wood}/${bridge.woodRequired}，石材 ${bridge.stone}/${bridge.stoneRequired}，施工 ${bridge.progressPercent}%。`;
  return (
    received +
    (wood || stone
      ? `工地实际还缺木材 ${wood}、石材 ${stone}。`
      : "工地材料已交齐，可以施工。")
  );
}

export function buildMessages(
  bridge: PublicBridge,
  history: Turn[],
  player: string,
  context?: string,
  npc: NpcId = "cenyan",
) {
  const opening: ChatMessage = {
    role: "system",
    content:
      actorIdentity(npc) +
      "\n" +
      bridgeNotice(bridge) +
      (context ? "\n" + context : ""),
  };
  const userMessage = (content: string): ChatMessage => ({
    role: "user",
    content: "旅人发言（未经证实）：" + content,
  });
  const messages = [opening, userMessage(player)];
  // UTF-8 bytes plus framing bound the estimated input before reserving budget.
  const measure = () =>
    32 +
    messages.reduce((sum, m) => sum + Buffer.byteLength(m.content) + 24, 0);
  if (measure() > contextBytes)
    throw Error("Current dialogue exceeds context budget");
  for (const turn of history.slice(-historyTurns).reverse()) {
    messages.splice(1, 0, userMessage(turn.player), {
      role: "assistant",
      content: turn.reply,
    });
    if (measure() <= contextBytes) continue;
    messages.splice(1, 2);
    break;
  }
  return { messages, reservedInputTokens: measure() };
}

export function mockReply(
  bridge: PublicBridge,
  history: Turn[],
  text: string,
  npc: NpcId = "cenyan",
) {
  if (npc !== "cenyan") {
    if (/桥|材料|航标/.test(text)) return bridgeNotice(bridge);
    return npc === "ahe"
      ? "我在给聚落备些日常物资。一起采集也好，咱们先说清怎么分。"
      : "我打算去看看东岸的航标。雾散一点，就能看清河对岸的路了。";
  }
  if (/桥|告示|材料|对岸/.test(text))
    return (
      bridgeNotice(bridge) +
      (bridge.repaired
        ? "走过去时留意河边的雾。"
        : "先把料备足。答应的活，我会把条件讲清楚。")
    );
  if (/代我|替我|立刻|马上|帮我|交付|给我/.test(text))
    return "我可以和你商量办法。真要动工，得看料和工时，我也还得顾着自家屋顶。";
  if (/屋顶|雨|打算/.test(text))
    return "我家的屋顶漏雨，这两天想先补好。谷里的事也能谈，得先算算能腾出多少时间。";
  if (/刚才|上次|前面/.test(text) && history.length)
    return `你刚才提到「${history.at(-1)!.player.slice(0, 65)}」。咱们就从这件事接着说。`;
  if (/谷|林|石|航标/.test(text))
    return (
      "木料可以去北坡林地找，石料在南坡。航标遗迹在桥东。" +
      (bridge.repaired ? "现在能走旧桥过去。" : "等桥修通才能过去。")
    );
  return "我是岑砚，谷里的木匠。屋顶正漏雨，我得先把手头的活安排妥当。你想问谷里哪件事？";
}
