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
