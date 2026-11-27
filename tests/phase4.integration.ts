import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { createApp } from "../src/server/app.js";
import { SaveFile } from "../src/server/save.js";
import type {
  ClientMessage,
  ServerMessage,
  Snapshot,
} from "../src/shared/protocol.js";

test(
  "Phase 4 WS binds foreground consent to the selected NPC and keeps the ledger and loan across restart",
  { timeout: 15_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "mistsea-phase4-ws-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "world.sqlite");
    const save = new SaveFile(path);
    try {
      const state = structuredClone(save.initial);
      Object.assign(state.player, { x: 438, y: 368 });
      Object.assign(state.actors.ahe, { x: 421, y: 370 });
      Object.assign(state.actors.luozhou, { x: 425, y: 381 });
      state.inventory.wood = 2;
      save.write(state);
    } finally {
      save.close();
    }

    let app: ReturnType<typeof createApp> | undefined;
    let socket: WebSocket | undefined;
    let messages: ServerMessage[] = [];
    async function stop() {
      socket?.terminate();
      socket = undefined;
      await app?.close();
      app = undefined;
    }
    async function start() {
      app = createApp({
        savePath: path,
        dialogueEnv: { LLM_ENABLED: "false", LLM_MOCK_DELAY_MS: "16" },
      });
      const url = await app.listen({ host: "127.0.0.1", port: 0 });
      messages = [];
      socket = new WebSocket(url.replace("http:", "ws:") + "/ws");
      socket.on("message", (raw) =>
        messages.push(JSON.parse(raw.toString()) as ServerMessage),
      );
      await once(socket, "open");
      await find((message) => message.type === "snapshot");
    }
    const send = (message: ClientMessage) =>
      socket!.send(JSON.stringify(message));
    async function find<T extends ServerMessage>(
      predicate: (message: ServerMessage) => message is T,
    ): Promise<T>;
    async function find(
      predicate: (message: ServerMessage) => boolean,
    ): Promise<ServerMessage>;
    async function find(predicate: (message: ServerMessage) => boolean) {
      for (let i = 0; i < 100; i++) {
        const message = messages.find(predicate);
        if (message) return message;
        await delay(20);
      }
      assert.fail(JSON.stringify(messages.slice(-3)));
    }
    function snapshot() {
      return messages
        .slice()
        .reverse()
        .find((entry): entry is Snapshot => entry.type === "snapshot")!;
    }

    try {
      await start();
      const proposal = randomUUID();
      send({
        type: "social",
        id: proposal,
        command: {
          kind: "offer",
          target: "ahe",
          terms: { kind: "loan", give: { item: "wood", qty: 1 } },
        },
      });
      const offered = await find(
        (entry) => entry.type === "result" && entry.id === proposal,
      );
      assert.equal(offered.type, "result");
      assert.equal(offered.code, "OFFER_PROPOSED");
      assert.equal(snapshot().state.inventory.wood, 2);
      const open = async (npc: "ahe" | "luozhou") => {
        const requestId = randomUUID();
        send({ type: "dialogue-open", id: requestId, npc });
        const opened = await find(
          (entry) =>
            entry.type === "dialogue" &&
            entry.event === "opened" &&
            entry.requestId === requestId,
        );
        assert.equal(opened.type, "dialogue");
        assert.equal(opened.event, "opened");
        assert.equal(opened.npc, npc);
        return opened.dialogId;
      };
      const wrongDialog = await open("luozhou");
      const wrongId = randomUUID();
      send({
        type: "dialogue-agreement",
        id: wrongId,
        dialogId: wrongDialog,
        offerId: offered.offerId!,
      });
      const wrong = await find(
        (entry) =>
          entry.type === "dialogue" &&
          entry.event === "error" &&
          entry.requestId === wrongId,
      );
      assert.equal(wrong.type, "dialogue");
      assert.equal(wrong.event, "error");
      assert.equal(wrong.code, "stale");
      const dialogId = await open("ahe");
      const accept = randomUUID();
      send({
        type: "dialogue-agreement",
        id: accept,
        dialogId,
        offerId: offered.offerId!,
      });
      const reply = await find(
        (entry) =>
          entry.type === "dialogue" &&
          entry.event === "reply" &&
          entry.requestId === accept,
      );
      assert.equal(reply.type, "dialogue");
      assert.equal(reply.event, "reply");
      assert.equal(reply.agreement?.code, "HANDOFF_DONE");
      const updated = await find(
        (entry): entry is Snapshot =>
          entry.type === "snapshot" && entry.state.inventory.wood === 1,
      );
      const pledge = updated.state.pledges.at(-1)!;
      assert.equal(pledge.from, "ahe");
      assert.equal(pledge.status, "accepted");
      await stop();
      await start();
      assert.equal(snapshot().state.pledges.at(-1)?.id, pledge.id);
      assert.equal(snapshot().state.actors.ahe.bag.wood, 1);
      assert.equal(snapshot().actors.ahe.model?.sharedUsage?.requests, 1);

      const reopened = randomUUID();
      send({ type: "dialogue-open", id: reopened, npc: "ahe" });
      const opened = await find(
        (entry) =>
          entry.type === "dialogue" &&
          entry.event === "opened" &&
          entry.requestId === reopened,
      );
      assert.equal(opened.type, "dialogue");
      assert.equal(opened.event, "opened");
      const id = randomUUID();
      send({
        type: "dialogue-send",
        id,
        dialogId: opened.dialogId,
        text: "请把借用的木材归还给我。",
      });
      const proposed = await find(
        (entry) =>
          entry.type === "dialogue" &&
          entry.event === "reply" &&
          entry.requestId === id,
      );
      assert.equal(proposed.type, "dialogue");
      assert.equal(proposed.event, "reply");
      assert.equal(proposed.action, "accepted");
      send({ type: "dialogue-close", dialogId: opened.dialogId });
      const returned = await find(
        (entry): entry is Snapshot =>
          entry.type === "snapshot" &&
          entry.state.pledges.some(
            (item) => item.id === pledge.id && item.status === "fulfilled",
          ),
      );
      assert.equal(returned.state.inventory.wood, 2);
      assert.equal(returned.state.actors.ahe.bag.wood, 0);
    } finally {
      await stop();
    }
  },
);

test(
  "Phase 5 local model fixture accepts a roof invitation and declines a separate request",
  { timeout: 12_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "mistsea-phase5-ws-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "world.sqlite");
    const save = new SaveFile(path);
    const state = structuredClone(save.initial);
    Object.assign(state.player, { x: 248, y: 287 });
    Object.assign(state.actors.cenyan, { x: 255, y: 299 });
    Object.assign(state.actors.ahe, { x: 235, y: 291 });
    state.actors.cenyan.bag.wood = 2;
    save.write(state);
    save.close();

    const requests: string[] = [];
    const { createServer } = await import("node:http");
    const provider = createServer(async (request, response) => {
      let data = "";
      for await (const chunk of request) data += chunk.toString();
      const messages = JSON.parse(data).messages as { content: string }[];
      const input = messages.at(-1)!.content;
      requests.push(messages[0].content);
      const content = input.includes("补给营地")
        ? {
            goal: "保留当前安排",
            speech: "我现在抽不开身。",
            plan_policy: "reject",
          }
        : requests.length === 1
          ? { speech: "可以。", plan: [] }
          : {
              goal: "修缮工坊屋顶",
              speech: "我来交木料并修屋顶。",
              plan_policy: "replace",
              plan: [
                { type: "move_to", target_id: "carpenter-roof" },
                {
                  type: "deliver",
                  target_id: "carpenter-roof",
                  item: "wood",
                  qty: 2,
                },
                { type: "work", target_id: "carpenter-roof" },
              ],
            };
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(content) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 60 },
        }),
      );
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    assert.ok(address && typeof address !== "string");
    const app = createApp({
      savePath: path,
      dialogueEnv: {
        LLM_ENABLED: "true",
        LLM_API_KEY: "phase5-test",
        LLM_MODEL: "fixture",
        LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        LLM_JSON_MODE: "true",
        LLM_MAX_TOTAL_USD: "1",
        LLM_INPUT_USD_PER_MILLION: "0",
        LLM_OUTPUT_USD_PER_MILLION: "0",
      },
    });
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(url.replace("http:", "ws:") + "/ws");
    const messages: ServerMessage[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    const send = (message: ClientMessage) =>
      socket.send(JSON.stringify(message));
    async function find(predicate: (entry: ServerMessage) => boolean) {
      for (let count = 0; count < 450; count++) {
        const message = messages.find(predicate);
        if (message) return message;
        await delay(20);
      }
      assert.fail("Timed out waiting for a Phase 5 result");
    }
    async function ask(npc: "cenyan" | "ahe", text: string) {
      const open = randomUUID();
      send({ type: "dialogue-open", npc, id: open });
      const opened = await find(
        (entry) =>
          entry.type === "dialogue" &&
          entry.event === "opened" &&
          entry.requestId === open,
      );
      assert.ok(opened.type === "dialogue" && opened.event === "opened");
      const id = randomUUID();
      send({ type: "dialogue-send", id, dialogId: opened.dialogId, text });
      const reply = await find(
        (entry) =>
          entry.type === "dialogue" &&
          entry.event === "reply" &&
          entry.requestId === id,
      );
      send({ type: "dialogue-close", dialogId: opened.dialogId });
      assert.ok(reply.type === "dialogue" && reply.event === "reply");
      return reply;
    }
    try {
      await once(socket, "open");
      assert.equal(
        (await ask("cenyan", "可以帮忙修缮工坊的屋顶吗？")).action,
        "accepted",
      );
      assert.equal(
        (await ask("ahe", "现在请帮我补给营地，好吗？")).action,
        "rejected",
      );
      const finished = await find(
        (entry) =>
          entry.type === "snapshot" &&
          entry.state.projects["carpenter-roof"].complete,
      );
      assert.ok(finished.type === "snapshot");
      assert.equal(
        finished.state.projects["carpenter-roof"].contributions.cenyan?.wood,
        2,
      );
      assert.equal(finished.state.projects["valley-camp"].food, 0);
      assert.equal(finished.state.actors.ahe.plan, null);
      assert.equal(requests.length, 3);
      assert.match(requests[1], /格式校验/);
      assert.match(requests[0], /carpenter-roof/);
      assert.match(requests[0], /item（wood、stone、food、toolbox）/);
      assert.match(requests[0], /give\/take 均由 item 和 qty 组成/);
    } finally {
      socket.terminate();
      await app.close();
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
    }
  },
);
