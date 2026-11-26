import { appendFileSync } from "node:fs";
import { createApp } from "../../src/server/app.js";
import type { Step } from "../../src/shared/cenyan.js";
import { valley } from "../../src/shared/world.js";

const { MISTSEA_SAVE, MISTSEA_CONTEXT_CAPTURE, PORT } = process.env;
if (
  !MISTSEA_SAVE ||
  !MISTSEA_CONTEXT_CAPTURE ||
  process.env.LLM_ENABLED !== "false"
)
  throw Error(
    "This Playwright fixture requires its own save, capture path and Mock mode.",
  );

const { bridge, resources } = valley;
const move = (target_id: string): Step => ({ type: "move_to", target_id });
const collect = (target_id: string): Step => ({ type: "collect", target_id });
const reply = (
  goal: string,
  speech: string,
  plan_policy: "replace" | "defer",
  ...steps: Step[]
) => JSON.stringify({ goal, speech, plan_policy, plan: steps });
const [wood5, wood6, stone1, stone2] = resources
  .slice(4, 8)
  .map((node) => node.id);

const app = createApp({
  savePath: MISTSEA_SAVE,
  dialogueEnv: {
    LLM_ENABLED: "false",
    LLM_MOCK_AUTONOMY_ENABLED: "false",
    LLM_MOCK_DELAY_MS: "95",
    LLM_MAX_REQUESTS_PER_MINUTE: "40",
  },
  mockDialogue(view, text, messages) {
    appendFileSync(
      MISTSEA_CONTEXT_CAPTURE,
      JSON.stringify({ pid: process.pid, text, messages }) + "\n",
    );
    if (text.startsWith("旅人的正式赠送提议") && view.gift?.from === "player") {
      const accept = view.gift.qty === 1;
      return JSON.stringify({
        goal: view.self.goal,
        speech: accept ? "我收下一份，多谢。" : "两份就不用了，你留着吧。",
        gift_response: {
          offer_id: view.gift.id,
          decision: accept ? "accept" : "reject",
        },
      });
    }
    switch (text) {
      case "你能送我一份木材吗？":
        return reply("赠木给旅人", "我提议送你一份木材。", "replace", {
          type: "give_item",
          target_id: "player",
          item: "wood",
          qty: 1,
        });
      case "请先去林地找些木材。":
        return reply(
          "从西侧林地找木材",
          "我先去林地。",
          "replace",
          move(wood6),
          collect(wood6),
        );
      case "能改去靠东的倒木吗？":
        return reply(
          "改去靠东的倒木",
          "行，改走东侧。",
          "replace",
          move(wood5),
        );
      case "到了以后，能把这两处倒木都采一点吗？":
        return reply(
          "抵达后采两处倒木",
          "路走完再采两处。",
          "defer",
          collect(wood5),
          move(wood6),
          collect(wood6),
        );
      case "要不现在先回工坊？":
        return JSON.stringify({
          goal: "回工坊",
          speech: "先不回，我想把林地的活做完。",
          plan_policy: "reject",
        });
      case "请到南坡采第一份石料。":
        return reply(
          "采第一份石料",
          "我去南坡。",
          "replace",
          move(stone1),
          collect(stone1),
        );
      case "再从另一处采一份石料吧。":
        return reply(
          "采第二份石料",
          "我换个岩簇再采一份。",
          "replace",
          move(stone2),
          collect(stone2),
        );
      case "我们一起去桥边吧。":
        return reply("跟旅人走到桥边", "好，我跟你到桥边。", "replace", {
          type: "follow",
          target_id: "player",
        });
      case "请把你这次采的木石交到工地。":
        return reply("交自己的木石", "我把手里的木石交到工地。", "replace", {
          type: "deliver",
          target_id: bridge.id,
        });
      case "我们一起铺桥板吧。":
        return reply("和旅人一起铺桥板", "好，我来铺另一边。", "replace", {
          type: "work",
          target_id: bridge.id,
        });
      case "还记得我们一起修桥的经过吗？":
        return (
          view.memory.find(
            (entry) =>
              entry.kind === "fact" && entry.content.includes("合力修通"),
          )?.content ?? "我没有找到那段施工记忆。"
        );
      default:
        return undefined;
    }
  },
});

try {
  console.log(
    await app.listen({ port: Number(PORT ?? 3003), host: "127.0.0.1" }),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(
      signal,
      () =>
        void app.close().catch((error) => {
          console.error(error);
          process.exitCode = 1;
        }),
    );
} catch (error) {
  console.error(error);
  await app.close();
  process.exitCode = 1;
}
