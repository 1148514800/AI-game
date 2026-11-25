import personality from "../../../data/npcs/cenyan.json" with { type: "json" };
import { contextBytes, historyTurns } from "./config.js";

export type PublicBridge = {
  discovered: boolean;
  wood: number;
  stone: number;
  woodRequired: number;
  stoneRequired: number;
  progressPercent: number;
  repaired: boolean;
};
export type Turn = { player: string; reply: string };
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const identity = [
  personality.background,
  personality.goals,
  personality.knowledge,
  personality.expression,
  ...personality.boundaries,
].join("\n");

export function bridgeNotice(bridge: PublicBridge): string {
  return bridge.repaired
    ? "公共告示：旧桥已修通，可往东岸。"
    : `公共告示：旧桥未修通。已交木材 ${bridge.wood}/${bridge.woodRequired}，石材 ${bridge.stone}/${bridge.stoneRequired}，施工 ${bridge.progressPercent}%。`;
}

export function buildMessages(
  bridge: PublicBridge,
  history: Turn[],
  player: string,
  context?: string,
) {
  const opening: ChatMessage = {
    role: "system",
    content:
      identity + "\n" + bridgeNotice(bridge) + (context ? "\n" + context : ""),
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

export function mockReply(bridge: PublicBridge, history: Turn[], text: string) {
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
