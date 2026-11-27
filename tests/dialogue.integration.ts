import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { createApp } from "../src/server/app.js";
import { readDialogueConfig } from "../src/server/dialogue/config.js";
import { DialogueFailure, generate } from "../src/server/dialogue/provider.js";
import { distance, isPassable, valley } from "../src/shared/world.js";
import type {
  ClientMessage,
  DialogueEvent,
  ServerMessage,
  Snapshot,
} from "../src/shared/protocol.js";

const key = "phase2-local-http-dummy-sentinel";
const id = () => crypto.randomUUID();
const textReply = (text: string, usage?: object) =>
  JSON.stringify({
    choices: [
      { message: { content: text, tool_calls: [] }, finish_reason: "stop" },
    ],
    usage,
  });

async function waitFor<T>(
  read: () => T | undefined,
  label: string,
  timeout = 4500,
): Promise<T> {
  const until = performance.now() + timeout;
  while (performance.now() < until) {
    const value = read();
    if (value !== undefined) return value;
    await delay(10);
  }
  throw Error(`Timed out waiting for ${label}`);
}

type ProviderBody = Record<string, unknown> & {
  messages: { role: string; content: string }[];
};

async function localProvider(
  t: TestContext,
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    body: ProviderBody,
  ) => void,
) {
  const server = createServer((request, response) => {
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => handler(request, response, JSON.parse(body)));
  });
  t.after(() => {
    if (!server.listening) return;
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    LLM_ENABLED: "true",
    LLM_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    LLM_API_KEY: key,
    LLM_MODEL: "local-http-fixture",
    LLM_MAX_REQUESTS_PER_MINUTE: "20",
    LLM_MAX_TOTAL_USD: "1",
    LLM_INPUT_USD_PER_MILLION: "0",
    LLM_OUTPUT_USD_PER_MILLION: "0",
  };
}

test("real local HTTP adapter supports both token fields, usage, sanitized errors, timeout and abort", async (t) => {
  let status = 200;
  let body = "";
  let hold = false;
  let last: { path?: string; auth?: string; body: Record<string, unknown> };
  const env = await localProvider(t, (request, response, requestBody) => {
    last = {
      path: request.url,
      auth: request.headers.authorization,
      body: requestBody,
    };
    if (!hold) response.writeHead(status).end(body);
  });
  const request = (
    tokenField: string,
    signal = new AbortController().signal,
    timeout = "1000",
    thinking?: string,
    responseFormat?: Parameters<typeof generate>[4],
  ) =>
    generate(
      readDialogueConfig({
        ...env,
        LLM_TOKEN_FIELD: tokenField,
        LLM_TIMEOUT_MS: timeout,
        LLM_ENABLE_THINKING: thinking,
      }),
      [{ role: "user", content: "雾灯谷" }],
      () => assert.fail("mock fallback"),
      signal,
      responseFormat,
    );
  for (const field of ["max_tokens", "max_completion_tokens"]) {
    body = textReply("收到 " + key, {
      prompt_tokens: 10,
      completion_tokens: 8,
      total_tokens: 18,
      completion_tokens_details: { reasoning_tokens: 3 },
    });
    const reply = await request(field);
    assert.equal(reply.text, "收到 [已隐藏]");
    assert.equal(reply.usage?.completion_tokens_details?.reasoning_tokens, 3);
    assert.equal(last!.path, "/v1/chat/completions");
    assert.equal(last!.auth, `Bearer ${key}`);
    assert.deepEqual(
      Object.keys(last!.body).sort(),
      [field, "messages", "model", "stream"].sort(),
    );
    assert.equal(JSON.stringify(last!.body).includes(key), false);
  }
  await request("max_tokens", undefined, undefined, "false", true);
  assert.equal(last!.body.enable_thinking, false);
  assert.deepEqual(last!.body.response_format, { type: "json_object" });
  body = textReply("有回复，缺用量");
  assert.equal((await request("max_tokens")).usage, undefined);
  const zeroUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  body = textReply("这条有回复，计数仍未确认", zeroUsage);
  assert.deepEqual((await request("max_tokens")).usage, zeroUsage);
  for (const [http, code] of [
    [401, "auth"],
    [403, "auth"],
    [404, "model"],
    [400, "model"],
    [429, "rate-limit"],
    [503, "provider"],
  ] as const) {
    status = http;
    body = key + " RAW_RESPONSE";
    await assert.rejects(request("max_tokens"), (error) => {
      assert.ok(error instanceof DialogueFailure);
      assert.equal(error.message, code);
      assert.ok(!String(error.stack).includes(key));
      assert.ok(!String(error.stack).includes("RAW_RESPONSE"));
      return true;
    });
  }
  status = 200;
  for (const [payload, code] of [
    [textReply(" "), "empty"],
    ["unparseable", "invalid"],
    [
      JSON.stringify({
        choices: [{ message: { content: "{}" }, finish_reason: "length" }],
      }),
      "truncated",
    ],
    [
      JSON.stringify({
        choices: [{ message: { content: "请执行", tool_calls: [{}] } }],
      }),
      "invalid",
    ],
  ] as const) {
    body = payload;
    await assert.rejects(
      request("max_tokens"),
      (error) => error instanceof DialogueFailure && error.code === code,
    );
  }
  hold = true;
  await assert.rejects(request("max_tokens", undefined, "100"), {
    message: "timeout",
  });
  const abort = new AbortController();
  const pending = request("max_tokens", abort.signal);
  abort.abort();
  await assert.rejects(pending, { message: "cancelled" });
  const network = generate(
    readDialogueConfig({ ...env, LLM_BASE_URL: "http://127.0.0.1:1/v1" }),
    [],
    () => "",
    new AbortController().signal,
  );
  await assert.rejects(network, { message: "network" });
});

type DialogEvent<K extends DialogueEvent["event"]> = Extract<
  DialogueEvent,
  { event: K }
>;
async function connect(url: string) {
  const socket = new WebSocket(url.replace("http:", "ws:") + "/ws");
  const events: ServerMessage[] = [];
  let state: Snapshot | undefined;
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as ServerMessage;
    if (message.type === "snapshot") state = message;
    else events.push(message);
  });
  await once(socket, "open");
  await waitFor(() => state, "world snapshot");
  return {
    socket,
    events,
    state: () => state!,
    send: (msg: ClientMessage) => socket.send(JSON.stringify(msg)),
    dialogue<K extends DialogueEvent["event"]>(
      kind: K,
      match: (ev: DialogEvent<K>) => boolean,
    ) {
      return waitFor(
        () =>
          events.find(
            (event): event is DialogEvent<K> =>
              event.type === "dialogue" &&
              event.event === kind &&
              match(event as DialogEvent<K>),
          ),
        kind,
      );
    },
  };
}

type Player = Awaited<ReturnType<typeof connect>>;
async function nearCenyan(player: Player, y = 321) {
  for (const [axis, target] of [
    ["x", 247],
    ["y", y],
  ] as const) {
    const move = {
      type: "move",
      dx: axis === "x" ? 1 : 0,
      dy: axis === "y" ? -1 : 0,
    } as const;
    const reached = () =>
      axis === "x"
        ? player.state().state.player.x >= target
        : player.state().state.player.y <= target;
    const until = performance.now() + 3800;
    while (!reached() && performance.now() < until) {
      player.send(move);
      await delay(35);
    }
    player.send({ type: "move", dx: 0, dy: 0 });
    assert.ok(reached(), "player reached the waypoint by normal movement");
    await waitFor(
      () => (player.state().moving ? undefined : true),
      "player stopped",
    );
  }
}

function open(player: Player, npc = "cenyan") {
  const requestId = id();
  player.send({ type: "dialogue-open", id: requestId, npc });
  return requestId;
}
async function opened(player: Player) {
  const requestId = open(player);
  return (
    await player.dialogue("opened", (event) => event.requestId === requestId)
  ).dialogId;
}
function submit(player: Player, dialogId: string, text: string) {
  const requestId = id();
  const request = {
    type: "dialogue-send",
    id: requestId,
    dialogId,
    text,
  } as const;
  player.send(request);
  return request;
}

test(
  "real WS and HTTP fixture enforce distance, continuity, no world effects, cancellation and durable budget",
  { timeout: 60_000 },
  async (t) => {
    const calls: {
      body: { messages: { role: string; content: string }[] };
      aborted: boolean;
    }[] = [];
    const env = await localProvider(t, (_request, response, body) => {
      const call = { body, aborted: false };
      calls.push(call);
      const content = call.body.messages.at(-1)!.content;
      if (content.includes("慢回复")) {
        response.on("close", () => {
          call.aborted = !response.writableEnded;
        });
        return;
      }
      if (content.includes("制造故障")) {
        response.writeHead(429).end(key + " RAW_RESPONSE");
        return;
      }
      response.end(
        textReply("<img onerror=alert(1)> 已经替你改了桥（测试桩） " + key, {
          prompt_tokens: 40,
          completion_tokens: 8,
          total_tokens: 48,
        }),
      );
    });
    const root = mkdtempSync(join(tmpdir(), "mistsea-offline-dialogue-"));
    const savePath = join(root, "isolated.sqlite");
    let app: ReturnType<typeof createApp> | undefined;
    t.after(async () => {
      await app?.close();
      rmSync(root, { recursive: true, force: true });
    });
    async function start() {
      app = createApp({
        savePath,
        dialogueEnv: {
          ...env,
          LLM_MAX_TOTAL_REQUESTS: "9",
          LLM_TIMEOUT_MS: "3000",
        },
      });
      return app.listen({ port: 0, host: "127.0.0.1" });
    }
    let url = await start();
    let player = await connect(url);
    const distance = open(player);
    assert.equal(
      (await player.dialogue("error", (event) => event.requestId === distance))
        .code,
      "distance",
    );
    const wrong = open(player, "unknown-npc");
    assert.equal(
      (await player.dialogue("error", (event) => event.requestId === wrong))
        .code,
      "npc",
    );
    await nearCenyan(player);
    let dialog = await opened(player);
    const initial = structuredClone(player.state().state);
    const tooLong = submit(player, dialog, "试".repeat(481));
    assert.equal(
      (
        await player.dialogue(
          "error",
          (event) => event.requestId === tooLong.id,
        )
      ).code,
      "invalid_input",
    );
    const first = submit(player, dialog, "我说桥已经修好了");
    const visible = await player.dialogue(
      "reply",
      (event) => event.requestId === first.id,
    );
    assert.ok(visible.text.includes("[已隐藏]"));
    assert.ok(!JSON.stringify(visible).includes(key));
    assert.deepEqual(player.state().state, initial);
    assert.match(calls[0].body.messages[0].content, /旧桥未修通/);
    assert.ok(
      !JSON.stringify(calls[0].body).match(
        /inventory|cooldowns|toolbox|schemaVersion/,
      ),
    );
    const failed = submit(player, dialog, "制造故障");
    const failure = await player.dialogue(
      "error",
      (e) => e.requestId === failed.id,
    );
    assert.equal(failure.code, "rate-limit");
    assert.ok(!JSON.stringify(failure).includes(key));
    assert.ok(!JSON.stringify(failure).includes("RAW_RESPONSE"));
    const second = submit(player, dialog, "接着说");
    await player.dialogue("reply", (e) => e.requestId === second.id);
    const supplied = JSON.stringify(calls[2].body.messages);
    assert.match(supplied, /我说桥已经修好了/);
    assert.doesNotMatch(supplied, /制造故障/);

    async function slow() {
      const previous = calls.length;
      const request = submit(player, dialog, "慢回复");
      await player.dialogue(
        "pending",
        (event) => event.requestId === request.id,
      );
      const call = await waitFor(() => calls[previous], "provider request");
      return { call, request };
    }
    async function aborted(
      attempt: Awaited<ReturnType<typeof slow>>,
      owner = player,
    ) {
      await waitFor(
        () => (attempt.call.aborted ? true : undefined),
        "upstream abort",
      );
      assert.equal(
        owner.events.some(
          (e) =>
            e.type === "dialogue" &&
            e.event === "reply" &&
            e.requestId === attempt.request.id,
        ),
        false,
      );
    }

    const close = await slow();
    const callsBeforeDuplicate = calls.length;
    player.send(close.request);
    const busy = submit(player, dialog, "第二条并发");
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === busy.id)).code,
      "busy",
    );
    assert.equal(calls.length, callsBeforeDuplicate);
    const owner = player;
    player.send({ type: "dialogue-close", dialogId: dialog });
    await aborted(close, owner);
    dialog = await opened(player);
    const stale = submit(player, close.request.dialogId, "旧对话发送");
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === stale.id)).code,
      "stale",
    );

    const pause = await slow();
    player.send({ type: "pause", paused: true });
    await player.dialogue("closed", (e) => e.dialogId === dialog);
    await aborted(pause);
    const paused = open(player);
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === paused)).code,
      "inactive",
    );
    player.send({ type: "pause", paused: false });
    dialog = await opened(player);

    const disconnected = await slow();
    player.socket.close();
    await aborted(disconnected);
    player = await connect(url);
    dialog = await opened(player);

    const takeover = await slow();
    const replaced = player;
    player = await connect(url);
    await aborted(takeover, replaced);
    dialog = await opened(player);

    const left = await slow();
    const moveUntil = performance.now() + 2000;
    while (
      !player.events.some(
        (e) =>
          e.type === "dialogue" &&
          e.event === "closed" &&
          e.dialogId === dialog,
      ) &&
      performance.now() < moveUntil
    ) {
      player.send({ type: "move", dx: 0, dy: 1 });
      await delay(100);
    }
    await player.dialogue("closed", (e) => e.dialogId === dialog);
    player.send({ type: "move", dx: 0, dy: 0 });
    await aborted(left);
    await nearCenyan(player);
    dialog = await opened(player);

    const reset = await slow();
    const resetId = id();
    player.send({ type: "reset", id: resetId, confirm: true });
    await waitFor(
      () =>
        player.events.some(
          (e) => e.type === "result" && e.id === resetId && e.ok,
        )
          ? true
          : undefined,
      "reset",
    );
    await aborted(reset);
    await nearCenyan(player);
    dialog = await opened(player);
    const spent = submit(player, dialog, "额度已经用完了吗");
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === spent.id)).code,
      "budget",
    );
    assert.equal(calls.length, 9);

    await app!.close();
    url = await start();
    player = await connect(url);
    dialog = await opened(player);
    const restart = submit(player, dialog, "重启之后还是要限额");
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === restart.id)).code,
      "budget",
    );
    assert.equal(calls.length, 9);
    const ledger = new DatabaseSync(savePath + ".llm.sqlite");
    try {
      assert.deepEqual(
        ledger
          .prepare(
            "SELECT status, count(*) AS n FROM calls GROUP BY status ORDER BY status",
          )
          .all()
          .map((row) => [row.status, row.n]),
        [
          ["cancelled", 6],
          ["ok", 2],
          ["rate-limit", 1],
        ],
      );
    } finally {
      ledger.close();
    }
  },
);

test(
  "local HTTP dialogue accepts a natural request, validates optional plans and holds a walking Cenyan until close",
  { timeout: 25_000 },
  async (t) => {
    const resource = valley.resources[2];
    const request = "劳驾到北坡捡点木头";
    const smallTalk = "今天雾大吗？";
    const invalid = "未知地点测试";
    const malformed = "截断计划测试";
    const decision = {
      goal: "stock-wood",
      speech: "我先去找木料。",
      plan: [
        { type: "move_to", target_id: resource.id },
        { type: "collect", target_id: resource.id },
      ],
    };
    const calls: ProviderBody[] = [];
    const aborted: number[] = [];
    const env = await localProvider(t, (_request, response, body) => {
      const index = calls.push(body) - 1;
      const input = body.messages.at(-1)!.content;
      let content = JSON.stringify(decision);
      if (index === 3)
        content = JSON.stringify({
          speech: decision.speech,
          plan: decision.plan,
        });
      if (index === 4)
        content = JSON.stringify({ ...decision, goal_tag: "invented-tag" });
      if (input.endsWith(smallTalk))
        content = JSON.stringify({ speech: "今天雾重，走路当心。" });
      if (input.endsWith(invalid))
        content = JSON.stringify({
          ...decision,
          plan: [{ type: "move_to", target_id: "unknown-place" }],
        });
      if (input.endsWith(malformed)) content = content.slice(0, -1);
      const payload = textReply(content, {
        prompt_tokens: 60,
        completion_tokens: 50,
      });
      if (index === 0 || input.endsWith(smallTalk)) {
        const timer = setTimeout(() => response.end(payload), 1200);
        response.on("close", () => {
          clearTimeout(timer);
          if (!response.writableEnded) aborted.push(index);
        });
      } else response.end(payload);
    });
    const dir = mkdtempSync(join(tmpdir(), "mistsea-phase3-action-http-"));
    const savePath = join(dir, "world.sqlite");
    let app: ReturnType<typeof createApp>;
    async function start() {
      app = createApp({
        savePath,
        dialogueEnv: {
          ...env,
          LLM_AUTONOMY_ENABLED: "false",
          LLM_JSON_MODE: "true",
          LLM_MAX_REQUESTS_PER_MINUTE: "9",
        },
      });
      return app.listen({ port: 0, host: "127.0.0.1" });
    }
    t.after(async () => {
      await app?.close();
      rmSync(dir, { recursive: true, force: true });
    });
    let url = await start();
    let player = await connect(url);
    await nearCenyan(player, 312);
    let dialog = await opened(player);
    const stale = submit(player, dialog, request);
    await waitFor(() => calls[0], "first local HTTP action request");
    player.send({ type: "dialogue-close", dialogId: dialog });
    await waitFor(() => aborted.length || undefined, "upstream abort");
    assert.equal(player.state().state.cenyan.plan, null);
    assert.ok(
      !player.events.some(
        (e) =>
          e.type === "dialogue" &&
          e.event === "reply" &&
          e.requestId === stale.id,
      ),
    );

    dialog = await opened(player);
    const invalidTarget = submit(player, dialog, invalid);
    assert.equal(
      (await player.dialogue("error", (e) => e.requestId === invalidTarget.id))
        .code,
      "invalid",
    );
    assert.equal(player.state().state.cenyan.plan, null);
    const active = submit(player, dialog, request);
    const accepted = await player.dialogue(
      "reply",
      (e) => e.requestId === active.id,
    );
    assert.equal(accepted.action, "accepted");
    player.send({ type: "dialogue-close", dialogId: dialog });

    await waitFor(
      () => player.state().cenyan.activity === "moving" || undefined,
      "Cenyan starts walking",
    );
    dialog = await opened(player);
    const held = await waitFor(
      () =>
        player.state().cenyan.activity === "idle"
          ? player.state().state.cenyan
          : undefined,
      "walking Cenyan holds position",
    );
    assert.equal(held.plan?.id, active.id);
    const chat = submit(player, dialog, smallTalk);
    const ordinaryReply = await player.dialogue(
      "reply",
      (e) => e.requestId === chat.id,
    );
    assert.equal(ordinaryReply.text, "今天雾重，走路当心。");
    assert.equal(ordinaryReply.action, undefined);
    assert.deepEqual(player.state().state.cenyan, held);
    for (const expectedCalls of [8, 9]) {
      const rejected = submit(player, dialog, malformed);
      assert.equal(
        (await player.dialogue("error", (e) => e.requestId === rejected.id))
          .code,
        "invalid",
      );
      assert.deepEqual(player.state().state.cenyan, held);
      assert.equal(
        calls.length,
        expectedCalls,
        "retry respects the request budget",
      );
    }
    player.send({ type: "dialogue-close", dialogId: dialog });
    await waitFor(
      () => player.state().state.cenyan.bag.wood === 1 || undefined,
      "Cenyan harvested",
    );
    const result = player.state();
    assert.equal(result.state.inventory.wood, 0);
    assert.ok(result.state.cooldowns[resource.id] > result.now);
    assert.ok(calls[3].messages[0].content.includes(resource.id));
    assert.ok(calls[3].messages[0].content.includes("附近人物"));
    assert.match(calls[3].messages[0].content, /根据旅人话语的含义/);
    assert.match(calls[3].messages[0].content, /普通问答只给对白/);
    for (const call of calls)
      assert.deepEqual(call.response_format, { type: "json_object" });
    assert.match(calls[4].messages[0].content, /上一份回复没有通过格式校验/);
    assert.deepEqual(calls[3].messages.at(-1), calls[4].messages.at(-1));

    await app!.close();
    const ledger = new DatabaseSync(savePath + ".llm.sqlite", {
      readOnly: true,
    });
    try {
      assert.deepEqual(
        ledger
          .prepare(
            "SELECT status, count(*) AS n FROM calls GROUP BY status ORDER BY status",
          )
          .all()
          .map((row) => [row.status, row.n]),
        [
          ["cancelled", 1],
          ["invalid", 6],
          ["ok", 2],
        ],
      );
    } finally {
      ledger.close();
    }
    url = await start();
    player = await connect(url);
    const restarted = player.state();
    assert.deepEqual(restarted.state.cenyan, result.state.cenyan);
    assert.deepEqual(restarted.cenyan.memory, result.cenyan.memory);
    assert.ok(
      restarted.cenyan.memory.some(
        (m) => m.kind === "claim" && m.event === active.id,
      ),
    );
    assert.ok(
      restarted.cenyan.memory.some(
        (m) =>
          m.kind === "fact" &&
          m.event.includes(active.id) &&
          /获得 木材/.test(m.content),
      ),
    );
  },
);

test(
  "real WS clearly marked Mock starts without dialogue and walks, harvests, delivers and works a fresh bridge",
  { timeout: 120_000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "mistsea-phase3-autonomy-ws-"));
    const savePath = join(dir, "world.sqlite");
    const app = createApp({
      savePath,
      dialogueEnv: {
        // Three NPCs share the ledger; the old single-actor minute cap starves delivery.
        LLM_ENABLED: "false",
        LLM_MOCK_AUTONOMY_ENABLED: "true",
        LLM_MOCK_DELAY_MS: "120",
        LLM_AUTONOMY_REQUESTS_PER_MINUTE: "60",
        LLM_MAX_REQUESTS_PER_MINUTE: "90",
        LLM_AUTONOMY_REQUESTS_PER_SESSION: "90",
        LLM_MAX_REQUESTS_PER_SESSION: "120",
      },
    });
    t.after(async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const player = await connect(url);
    const start = player.state().state.cenyan;
    await waitFor(
      () => player.state().cenyan.activity === "moving" || undefined,
      "moving Mock actor",
    );
    const moved = player.state();
    assert.ok(distance(moved.state.cenyan, start) > 0);
    assert.equal(moved.cenyan.model?.mode, "mock");
    assert.ok(isPassable(moved.state.cenyan.x, moved.state.cenyan.y, false));
    await waitFor(
      () => player.state().state.cenyan.bag.wood > 0 || undefined,
      "harvest",
      25_000,
    );
    await waitFor(
      () => player.state().state.bridge.wood === 6 || undefined,
      "NPC delivery",
      80_000,
    );
    const delivery = player.state().state;
    assert.equal(delivery.bridge.stone, 2);
    assert.deepEqual(delivery.cenyan.bag, { wood: 0, stone: 0 });
    await waitFor(
      () => player.state().state.bridge.progressMs > 0 || undefined,
      "start work",
    );
    const workingAt = performance.now();
    await waitFor(
      () => player.state().state.bridge.repaired || undefined,
      "finish work",
      22_000,
    );
    const repaired = player.state();
    const workers = (["cenyan", "ahe", "luozhou"] as const).filter(
      (id) => repaired.state.contributions[id].workMs > 0,
    ).length;
    assert.ok(workers >= 1);
    assert.ok(
      performance.now() - workingAt >= valley.bridge.workMs / workers - 750,
    );
    assert.equal(repaired.state.bridge.progressMs, valley.bridge.workMs);
    assert.deepEqual(repaired.state.inventory, {
      wood: 0,
      stone: 0,
      food: 0,
      toolbox: 0,
    });
    assert.ok(
      repaired.cenyan.memory.some(
        (m) => m.kind === "fact" && /已修通/.test(m.content),
      ),
    );
    const ledger = new DatabaseSync(savePath + ".llm.sqlite", {
      readOnly: true,
    });
    try {
      const calls = ledger
        .prepare("SELECT DISTINCT mode, purpose FROM calls")
        .all();
      assert.deepEqual(
        calls.map((row) => [row.mode, row.purpose]),
        [["mock", "autonomy"]],
      );
    } finally {
      ledger.close();
    }
  },
);
