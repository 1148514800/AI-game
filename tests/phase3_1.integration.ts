import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { createApp } from "../src/server/app.js";
import type {
  ClientMessage,
  DialogueEvent,
  Result,
  ServerMessage,
  Snapshot,
} from "../src/shared/protocol.js";
import { distance, speed, valley, type Point } from "../src/shared/world.js";
import { route } from "./paths.js";

const waitFor = async <T>(
  read: () => T | undefined,
  label: string,
  timeout = 4500,
) => {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await delay(15);
  }
  throw Error(`Timed out waiting for ${label}`);
};
const id = randomUUID;

test(
  "Phase3.1 real local HTTP and WS authenticate each direction of consent, reject a wrong offer and replay one commit",
  { timeout: 40_000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "mistsea-phase31-http-"));
    const evidence = process.env.MISTSEA_EVIDENCE ?? "evidence/phase4";
    mkdirSync(evidence, { recursive: true });
    const capture = (label: string, value: unknown) =>
      appendFileSync(
        join(evidence, "phase31-integration.jsonl"),
        JSON.stringify({ label, value }) + "\n",
      );
    let giftAnswer: "wrong-offer" | "accept" = "wrong-offer";
    const bodies: { messages: { content: string }[] }[] = [];
    let app: ReturnType<typeof createApp> | undefined;
    let socket: WebSocket | undefined;
    const provider = createServer(async (request, response) => {
      try {
        request.setEncoding("utf8");
        let raw = "";
        for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw) as (typeof bodies)[number];
        bodies.push(body);
        const text = body.messages.at(-1)!.content;
        const offerId = text.match(/编号 ([0-9a-f-]{36})/)?.[1];
        const content = offerId
          ? {
              goal: "决定是否收木材",
              speech: "我愿意收下一份。",
              gift_response: {
                offer_id: giftAnswer === "wrong-offer" ? id() : offerId,
                decision: "accept",
              },
            }
          : {
              goal: "把木材赠回旅人",
              speech: "这份木材要不要由你决定。",
              plan_policy: "replace",
              plan: [
                {
                  type: "give_item",
                  target_id: "player",
                  item: "wood",
                  qty: 1,
                },
              ],
            };
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            choices: [
              {
                message: { content: JSON.stringify(content) },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 38,
              completion_tokens: 21,
              total_tokens: 59,
            },
          }),
        );
      } catch {
        response.end();
      }
    });
    t.after(async () => {
      socket?.terminate();
      try {
        await app?.close();
      } finally {
        if (provider.listening) {
          provider.closeAllConnections();
          await new Promise<void>((resolve) => provider.close(() => resolve()));
        }
        rmSync(dir, { recursive: true, force: true });
      }
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    app = createApp({
      savePath: join(dir, "valley.sqlite"),
      dialogueEnv: {
        LLM_ENABLED: "true",
        LLM_AUTONOMY_ENABLED: "false",
        LLM_BASE_URL: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`,
        LLM_API_KEY: "phase31-local-http-dummy",
        LLM_MODEL: "phase31-local-fixture",
        LLM_INPUT_USD_PER_MILLION: "0",
        LLM_OUTPUT_USD_PER_MILLION: "0",
        LLM_MAX_TOTAL_USD: "1",
        LLM_ENABLE_THINKING: "false",
      },
    });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const player = new WebSocket(url.replace(/^http/, "ws") + "/ws");
    socket = player;
    const events: (DialogueEvent | Result)[] = [];
    let latest: Snapshot | undefined;
    player.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as ServerMessage;
      if (message.type === "snapshot") latest = message;
      if (message.type === "dialogue" || message.type === "result")
        events.push(message);
    });
    await once(player, "open");
    const send = (message: ClientMessage) =>
      player.send(JSON.stringify(message));
    const dialogue = <K extends DialogueEvent["event"]>(
      kind: K,
      requestId: string,
    ) =>
      waitFor(
        () =>
          events.find(
            (event): event is Extract<DialogueEvent, { event: K }> =>
              event.type === "dialogue" &&
              event.event === kind &&
              "requestId" in event &&
              event.requestId === requestId,
          ),
        kind,
      );
    const result = (requestId: string) =>
      waitFor(
        () =>
          events.find(
            (event): event is Result =>
              event.type === "result" && event.id === requestId,
          ),
        "result",
      );

    await waitFor(() => latest, "fresh snapshot");
    const node = valley.resources[2];
    const walk = async (goal: (p: Point) => boolean) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { player, cenyan } = latest!.state;
        if (goal(player)) return;
        for (const { axis, ...target } of route(player, goal, false, [
          cenyan,
        ])) {
          const diff = target[axis] - latest!.state.player[axis];
          const sign = Math.sign(diff) as -1 | 0 | 1;
          const until =
            performance.now() + 2000 + (Math.abs(diff) * 1000) / speed;
          while (
            (target[axis] - latest!.state.player[axis]) * sign > 1.75 &&
            performance.now() < until
          ) {
            send({
              type: "move",
              dx: axis === "x" ? sign : 0,
              dy: axis === "y" ? sign : 0,
            });
            await delay(55);
          }
          send({ type: "move", dx: 0, dy: 0 });
          await waitFor(
            () => (latest!.moving ? undefined : true),
            "movement stopped",
          );
        }
      }
      assert.ok(goal(latest!.state.player));
    };
    await walk((point) => distance(point, node) <= node.range - 5);
    const collected = id();
    send({ type: "action", id: collected, target: node.id, verb: "collect" });
    assert.equal((await result(collected)).code, "COLLECTED");
    await walk((point) => distance(point, latest!.state.cenyan) <= 24);
    const open = id();
    send({ type: "dialogue-open", id: open, npc: "cenyan" });
    const { dialogId } = await dialogue("opened", open);

    const wrong = id();
    send({
      type: "dialogue-gift",
      id: wrong,
      dialogId,
      gift: { item: "wood", qty: 1 },
    });
    assert.equal((await dialogue("error", wrong)).code, "gift");
    assert.equal(latest!.state.inventory.wood, 1);
    assert.equal(latest!.state.cenyan.bag.wood, 0);
    giftAnswer = "accept";
    const accepted = id();
    send({
      type: "dialogue-gift",
      id: accepted,
      dialogId,
      gift: { item: "wood", qty: 1 },
    });
    const transfer = await dialogue("reply", accepted);
    assert.equal(transfer.gift?.code, "GIFT_TRANSFERRED");
    assert.ok(bodies[1].messages[0].content.includes(accepted));
    await waitFor(
      () => (latest!.state.cenyan.bag.wood === 1 ? latest : undefined),
      "gift in NPC bag",
    );

    const offerRequest = id();
    send({
      type: "dialogue-send",
      id: offerRequest,
      dialogId,
      text: "你愿意给我一份木料吗？",
    });
    assert.equal((await dialogue("reply", offerRequest)).action, "accepted");
    send({ type: "dialogue-close", dialogId });
    const offer = await waitFor(
      () => latest?.state.gift ?? undefined,
      "NPC gift offer",
    );
    assert.equal(offer.from, "cenyan");
    assert.equal(latest!.state.inventory.wood, 0);
    const consent: ClientMessage = {
      type: "action",
      id: id(),
      target: "cenyan",
      verb: "gift-response",
      offerId: offer.id,
      choice: "accept",
    };
    send(consent);
    send(consent);
    const replays = await waitFor(() => {
      const matching = events.filter(
        (event) => event.type === "result" && event.id === consent.id,
      );
      return matching.length === 2 ? matching : undefined;
    }, "two receipt responses");
    assert.deepEqual(replays[0], replays[1]);
    assert.equal((replays[0] as Result).code, "GIFT_TRANSFERRED");
    assert.equal(latest!.state.inventory.wood, 1);
    assert.equal(latest!.state.cenyan.bag.wood, 0);
    assert.equal(bodies.length, 3);
    assert.deepEqual(latest!.cenyan.model?.sharedUsage, {
      requests: 3,
      tokens: 177,
      chargedUsd: 0,
    });
    capture("gift-requests-and-outcomes", {
      events,
      model: latest!.cenyan.model,
      bag: latest!.state.inventory,
      cenyanBag: latest!.state.cenyan.bag,
    });
  },
);
